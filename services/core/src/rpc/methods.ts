import {
  AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE,
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  getPersonalRemoteAgentDefaultModelId,
  parseAgentControllerRef,
  peopleComputerContainsDevice,
  projectPeopleComputersToLegacyLocalRuntimes,
  type RuntimeLookupInput,
  resolveAgentWakeAvailability,
  resolveHostedAgentWakeAvailability,
} from "@openmeld/agent-runtime";
import {
  memberRoleHasOrganizationPermission,
  type OrganizationPermissionCheck,
} from "@openmeld/auth/organization-policy";
import {
  getPostgresDatabase,
  type PostgresDatabase,
  type QueryConfig,
} from "@openmeld/db/postgresql";
import { OPENMELD_SPACE_ADDRESSING_VERSION } from "@openmeld/gateway-contract";
import type {
  Profile,
  SignalEnvelope,
  SignalStatusData,
  SignalSystemNoticeData,
  SignalText,
  SpaceCreator,
  SpaceCursor,
  SpaceMeta,
} from "@openmeld/protocol";
import {
  buildCenterAgentContextMessageProjection,
  buildProfileDisplay,
  buildSpaceMessageEvidence,
  buildSpaceThreadEvidence,
  type CenterAgentContextMessageProjection,
  CenterAgentContextTokenBudgetTooSmallError,
  decodeCenterAgentContextCursor,
  MAX_TEXT_LENGTH,
  validateCenterAgentContextManifestResponse,
} from "@openmeld/protocol";
import {
  accountSpaceActiveWakeSummaryRpcInputSchema,
  addCenterAgentToSpaceBodySchema,
  addOrganizationDirectoryProfilesToSpaceBodySchema,
  agentDirectMessageSessionSelectorSchema,
  agentExecutionReadinessResponseOptionsSchema,
  agentExecutionReadinessRouteParamsSchema,
  agentProfileBindingRouteParamsSchema,
  agentProfileBindingTargetSchema,
  agentProfileExecutionModeResponseSchema,
  authRpcResolveUserDisplayNameResultSchema,
  buildAccountAvatarObjectKey,
  buildAccountAvatarPublicPath,
  buildAgentTaskKey,
  buildSpaceComposerPublishedFileId,
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileObjectKey,
  buildSpaceFileRevisionIdForMutation,
  buildSpaceFileRevisionIdFromDigest,
  CENTER_AGENT_ORGANIZATION_MEMBERS_LIST_DEFAULT_LIMIT,
  CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES,
  CENTER_AGENT_SLACK_SEARCH_MESSAGES_MAX,
  CENTER_AGENT_TURN_DIAGNOSTICS_DEFAULT_LIMIT,
  canonicalizeAgentControllerRef,
  centerAgentAddAgentProfilesToSpaceBodySchema,
  centerAgentAddAgentProfilesToSpaceResponseSchema,
  centerAgentAddMembersToSpaceBodySchema,
  centerAgentAddMembersToSpaceResponseSchema,
  centerAgentCheckAgentProfileReadinessBodySchema,
  centerAgentCheckAgentProfileReadinessResponseSchema,
  centerAgentConnectAgentProfileToLocalAgentBodySchema,
  centerAgentConnectAgentProfileToLocalAgentResponseSchema,
  centerAgentContinueTaskSummaryBodySchema,
  centerAgentContinueTaskSummaryResponseSchema,
  centerAgentCreateAgentProfileBodySchema,
  centerAgentCreateAgentProfileResponseSchema,
  centerAgentCreateSpaceBodySchema,
  centerAgentCreateSpaceResponseSchema,
  centerAgentEnableAgentProfileBodySchema,
  centerAgentEnableAgentProfileResponseSchema,
  centerAgentListAgentProfileCreationDefaultsBodySchema,
  centerAgentListAgentProfileCreationDefaultsResponseSchema,
  centerAgentListAgentTasksBodySchema,
  centerAgentListAgentTasksResponseSchema,
  centerAgentListComputersBodySchema,
  centerAgentListComputersResponseSchema,
  centerAgentListLocalAgentConnectionCandidatesBodySchema,
  centerAgentListLocalAgentConnectionCandidatesResponseSchema,
  centerAgentListLocalAgentInstallationsBodySchema,
  centerAgentListLocalAgentInstallationsResponseSchema,
  centerAgentListOrganizationMembersResponseSchema,
  centerAgentListOrganizationMembersToolRpcInputSchema,
  centerAgentListSlackChannelsBodySchema,
  centerAgentListSpaceFilesResponseSchema,
  centerAgentListSpaceFilesRpcInputSchema,
  centerAgentManageSpaceFilesResponseSchema,
  centerAgentManageSpaceFilesRpcInputSchema,
  centerAgentOrganizationMemoryPolicyResponseSchema,
  centerAgentPostSlackChannelMessageBodySchema,
  centerAgentPostSlackFileBodySchema,
  centerAgentPostSlackThreadMessageBodySchema,
  centerAgentPostSpaceMessageBodySchema,
  centerAgentPostSpaceMessageResponseSchema,
  centerAgentReadAuditJournalRpcInputSchema,
  centerAgentReadConnectorActionOperationBodySchema,
  centerAgentReadConnectorActionOperationResponseSchema,
  centerAgentReadDispatchHistoryBodySchema,
  centerAgentReadDispatchHistoryResponseSchema,
  centerAgentReadMemberComputersBodySchema,
  centerAgentReadMemberComputersResponseSchema,
  centerAgentReadMemberOpenMeldServiceStatusBodySchema,
  centerAgentReadMemberOpenMeldServiceStatusResponseSchema,
  centerAgentReadPeopleComputersBodySchema,
  centerAgentReadPeopleComputersResponseSchema,
  centerAgentReadSlackChannelHistoryBodySchema,
  centerAgentReadSlackChannelMembersBodySchema,
  centerAgentReadSlackFileBodySchema,
  centerAgentReadSlackFileResponseSchema,
  centerAgentReadSlackWorkspaceDirectoryBodySchema,
  centerAgentReadSpaceContextBodySchema,
  centerAgentReadSpaceContextResponseSchema,
  centerAgentReadSpaceFileResponseSchema,
  centerAgentReadSpaceFileRpcInputSchema,
  centerAgentReadTurnDiagnosticsResponseSchema,
  centerAgentReadTurnDiagnosticsRpcInputSchema,
  centerAgentRecordConnectorActionAuditBodySchema,
  centerAgentRecordConnectorActionAuditResponseSchema,
  centerAgentRecordConnectorActionOperationBodySchema,
  centerAgentRecordConnectorActionOperationResponseSchema,
  centerAgentRememberForOrganizationBodySchema,
  centerAgentRememberForOrganizationResponseSchema,
  centerAgentRemoveAgentProfilesFromSpaceBodySchema,
  centerAgentRemoveAgentProfilesFromSpaceResponseSchema,
  centerAgentRequestOpenMeldToolsUpdateBodySchema,
  centerAgentRequestOpenMeldToolsUpdateResponseSchema,
  centerAgentSaveSpaceFileResponseSchema,
  centerAgentSaveSpaceFileRpcInputSchema,
  centerAgentSearchSlackMessagesBodySchema,
  centerAgentSearchSlackMessagesResponseSchema,
  centerAgentSelectLocalAgentInstallationBodySchema,
  centerAgentSelectLocalAgentInstallationResponseSchema,
  centerAgentSessionSelectorSchema,
  centerAgentSetOpenMeldToolsMaintenanceBodySchema,
  centerAgentSetOpenMeldToolsMaintenanceResponseSchema,
  centerAgentSlackWorkspaceConnectBodySchema,
  centerAgentSlackWorkspaceConnectionResponseSchema,
  centerAgentSlackWorkspaceDisconnectResponseSchema,
  centerAgentSpaceAuthoringContractResponseSchema,
  centerAgentStartSelfMemberResearchToolRpcInputSchema,
  centerAgentToolSpeakerSchema,
  centerAgentUpdateAgentProfileRuntimeSettingsBodySchema,
  centerAgentUpdateAgentProfileRuntimeSettingsResponseSchema,
  centerAgentUpdateProfileBodySchema,
  centerAgentUpdateProfileResponseSchema,
  centerAgentUpdateSpaceSettingsBodySchema,
  centerAgentUpdateSpaceSettingsResponseSchema,
  centerAgentWakeAgentProfilesInSpaceBodySchema,
  centerAgentWakeAgentProfilesInSpaceResponseSchema,
  centerAgentWakeAgentProfilesInSpacesBodySchema,
  centerAgentWakeAgentProfilesInSpacesResponseSchema,
  centerAgentWatchAgentTaskBodySchema,
  centerAgentWatchAgentTaskResponseSchema,
  centerAgentWipeMemberMemoryResponseSchema,
  computerPowerResultSchema,
  computerPowerRpcInputSchema,
  connectorAppRequestListResponseSchema,
  connectorAppRequestResponseSchema,
  connectorConnectionNameSchema,
  connectorConnectionPreferenceSchema,
  connectorConnectionReconcileInputSchema,
  connectorServiceSchema,
  convertDirectMessageToSpaceBodySchema,
  convertDirectMessageToSpaceResponseSchema,
  createCenterAgentContextLoadReceiptBodySchema,
  createCenterAgentContextLoadReceiptResponseSchema,
  createCenterAgentContextManifestBodySchema,
  createCenterAgentSessionBodySchema,
  createConnectorAppRequestBodySchema,
  createSpaceDiagnosticReportBodySchema,
  createSpaceTaskBodySchema,
  currentAgentProfileSessionLookupQuerySchema,
  currentAgentProfileSessionLookupResponseSchema,
  currentDeviceTargetDeviceIdSchema,
  currentDeviceTargetResponseSchema,
  currentLocalAgentInstallationsResponseSchema,
  currentLocalAgentInstallationsRouteParamsSchema,
  currentLocalRuntimeReplyReadinessResponseSchema,
  type DeleteAgentDirectMessageSessionResponse,
  type DeleteConversationForMeInput,
  type DeleteConversationForMeResponse,
  daemonServiceLaneSchema,
  decodeSpaceFileText,
  deleteAgentDirectMessageSessionResponseSchema,
  deleteConversationForMeInputSchema,
  deleteSpaceAttachmentRecordInputSchema,
  deleteSpaceAttachmentRecordResultSchema,
  deriveCenterAgentDirectMessageSpaceProjection,
  designateCenterAgentBodySchema,
  designateCenterAgentResponseSchema,
  disableAgentProfilePrimaryBindingResponseSchema,
  ensureAgentProfilePrimaryBindingBodySchema,
  ensureAgentProfilePrimaryBindingResponseSchema,
  ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema,
  ensureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema,
  executeAgentProfileWorkRecoveryBodySchema,
  executeAgentProfileWorkRecoveryResponseSchema,
  firstWorkResponseSchema,
  forgetComputerResponseSchema,
  forgetComputerRouteParamsSchema,
  forgetCurrentComputerResponseSchema,
  getActiveSpaceWakeProgressInputSchema,
  getAgentExecutionReadinessBatchBodySchema,
  getAgentExecutionReadinessBatchResponseSchema,
  getAgentExecutionReadinessResponseSchema,
  getAgentProfileControllerChangeEligibilityResponseSchema,
  getAgentProfileCreationDefaultsResponseSchema,
  getAgentProfileFoldersResponseSchema,
  getAgentProfileFoldersRouteParamsSchema,
  getAgentProfilePrimaryBindingResponseSchema,
  getCenterAgentDesignationResponseSchema,
  getCenterAgentDirectMessageSpaceProjectionResponseSchema,
  getCenterAgentOperatingStateResponseSchema,
  getCurrentAgentProfileWorkspaceQuerySchema,
  getCurrentAgentProfileWorkspaceResponseSchema,
  type getCurrentOrganizationSpaceDirectoryRpcInputSchema,
  getLocalRuntimeExpectedRoutesQuerySchema,
  getPrepareReadinessQuerySchema,
  getPrepareReadinessResponseSchema,
  getSpaceBoardInputSchema,
  getSpaceConversationStateInputSchema,
  getSpaceDispatchLookupInputSchema,
  getSpaceDispatchResultInputSchema,
  getSpaceEntryResolutionInputSchema,
  getSpaceEntryResolutionResponseSchema,
  getSpaceMessageDetailsInputSchema,
  getSpaceMessageReactionsInputSchema,
  getSpaceStatusInputSchema,
  getSpaceUpdatesInputSchema,
  getSpaceWakeProgressInputSchema,
  getSpaceWakeTraceWaterfallInputSchema,
  githubAppInstallationStartResponseSchema,
  githubAppInstallationStateSchema,
  githubAppInstallationVerificationResponseSchema,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  isHostedAgentControllerRef,
  isSpaceFileTextEditable,
  isSpaceFileTextReadable,
  type ListAgentDirectMessageSessionsQuery,
  type ListAgentDirectMessageSessionsResponse,
  type ListCenterAgentSessionsQuery,
  type ListCenterAgentSessionsResponse,
  larkPlatformActiveRegistrationListResponseSchema,
  larkPlatformProviderSchema,
  larkPlatformRegistrationAttemptIdSchema,
  listAgentDirectMessageSessionsQuerySchema,
  listCenterAgentAuditJournalQuerySchema,
  listCenterAgentAuditJournalResponseSchema,
  listCenterAgentSessionsQuerySchema,
  listSpaceThreadSignalsQuerySchema,
  localAgentUpdateRequestSchema,
  localAgentUpdateStateSchema,
  localRuntimeEnrollmentBodySchema,
  localRuntimeEnrollmentResponseSchema,
  localRuntimesResponseSchema,
  MAX_SPACE_NAME_LENGTH,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  MEMBER_AGENTS_ENABLED,
  manageAgentProfileFoldersBodySchema,
  manageAgentProfileFoldersResponseSchema,
  messageChannelConnectionListResponseSchema,
  messageChannelIdentityLinkConsumeBodySchema,
  messageChannelIdentityLinkConsumeResponseSchema,
  messageChannelIdentityLinkIdSchema,
  messageChannelIdentityLinkPreviewBodySchema,
  messageChannelIdentityLinkPreviewResponseSchema,
  messageChannelSetupRequestBodySchema,
  messageChannelSetupRequestResponseSchema,
  mutateSpaceTaskBodySchema,
  normalizeSpaceCursorPatch,
  normalizeSpacePasswordText,
  notifyAgentProfileRouteCatalogChangedBodySchema,
  notifyAgentProfileRouteCatalogChangedResponseSchema,
  notifyAgentProfilesRouteCatalogChangedBodySchema,
  openCenterAgentDirectMessageSpaceResponseSchema,
  openDirectMessageSpaceBodySchema,
  openDirectMessageSpaceResponseSchema,
  openMeldRequestContextSchema,
  organizationAgentRuntimeOverviewResponseSchema,
  organizationComputersResponseSchema,
  organizationDirectoryResponseSchema,
  organizationInformationProtectionPolicyResponseSchema,
  organizationMemberOpenMeldServiceStatusesResponseSchema,
  organizationMemberPresenceBodySchema,
  organizationMemberPresenceResponseSchema,
  organizationMemberWebActivityResponseSchema,
  organizationProfileDirectoryResponseSchema,
  organizationSpaceDirectoryResponseSchema,
  organizationSpaceDirectoryWithMemberCountsResponseSchema,
  ownerComputerDiagnosticsSchema,
  type PluginConnectionContinuationBinding,
  parseAccountAvatarReferenceFromUrl,
  parseSlackThreadPublicationPermalink,
  patchSpaceContractBodySchema,
  patchSpaceMetaBodySchema,
  pendingGitHubAppInstallationSchema,
  peopleComputerFileAccessReadRpcInputSchema,
  peopleComputerFileAccessUpdateRpcInputSchema,
  peopleComputerFolderPickerRpcInputSchema,
  peopleComputerProjectDiscoveryRpcInputSchema,
  peopleComputersResponseSchema,
  peopleComputerTargetSchema,
  postSpaceWakeStopInputSchema,
  prepareReadinessRouteParamsSchema,
  profileFolderIdSchema,
  profileSpaceHistoryGatewayHostSchema,
  projectOwnerComputerLocalRuntimes,
  projectProviderConversationProofMethod,
  type ReadPluginConnectionContinuationBindingRequest,
  readPluginConnectionContinuationBindingResponseSchema,
  recordSpaceAttachmentPayloadSchema,
  refreshCurrentLocalAgentCatalogResponseSchema,
  requestCurrentOpenMeldToolsUpdateResponseSchema,
  resolvedSpaceMemberProfileSchema,
  resolveSpaceAttachmentForDownloadPayloadSchema,
  resolveSpaceComposerUploadScopeResponseSchema,
  resolveSpaceFileStreamMetadata,
  respondToSpaceAgentInteractionInputSchema,
  runtimeReportingRouteParamsSchema,
  runtimeTransportAgentProfileWorkLocalAttemptWithdrawalResponseSchema,
  runtimeTransportAgentProfileWorkRecoveryReadResponseSchema,
  SPACE_COMPOSER_UPLOAD_TTL_MS,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
  selectCurrentLocalAgentInstallationBodySchema,
  selectCurrentLocalAgentInstallationResponseSchema,
  setAgentProfileCreationDefaultsBodySchema,
  setAgentProfileCreationDefaultsResponseSchema,
  setCurrentAgentProfileWorkspaceBodySchema,
  setCurrentAgentProfileWorkspaceResponseSchema,
  setCurrentAgentProfileWorkspaceRouteParamsSchema,
  setCurrentLocalAgentEnabledBodySchema,
  setCurrentLocalAgentEnabledResponseSchema,
  setCurrentLocalAgentEnabledRouteParamsSchema,
  setCurrentOpenMeldToolsMaintenanceBodySchema,
  setCurrentOpenMeldToolsMaintenanceResponseSchema,
  setLocalRuntimeDisplayNameBodySchema,
  setSpaceMessageReactionInputSchema,
  slackChannelHistoryResponseSchema,
  slackChannelListResponseSchema,
  slackChannelMembersResponseSchema,
  slackIdentityLinkConsumeBodySchema,
  slackIdentityLinkConsumeResponseSchema,
  slackIdentityLinkPreviewBodySchema,
  slackIdentityLinkPreviewResponseSchema,
  slackOAuthIdentityLinkInputSchema,
  slackOAuthIdentityLinkResultSchema,
  slackOAuthInstallationInputSchema,
  slackOAuthInstallationResultSchema,
  slackOAuthStateConsumeResponseSchema,
  slackOAuthStateCreateResponseSchema,
  slackOAuthStateSchema,
  slackReadUnavailableResponseSchema,
  slackWorkspaceDirectoryResponseSchema,
  spaceAccessModeSchema,
  spaceAttachmentDescriptorSchema,
  spaceBoardResponseSchema,
  spaceComposerUploadIdSchema,
  spaceFileClientMutationIdSchema,
  spaceFileMimeTypeSchema,
  spaceFileNameSchema,
  spaceFileStreamOptionsSchema,
  spaceTaskDetailOptionsSchema,
  submitRuntimeAgentControllerReportsBodySchema,
  submitRuntimeAgentControllerReportsResponseSchema,
  submitRuntimeProviderConversationProofsBodySchema,
  submitRuntimeProviderConversationProofsResponseSchema,
  submitRuntimeRegistrationBodySchema,
  submitRuntimeRegistrationResponseSchema,
  summarizeComputerFileAccessPolicy,
  type UpdateAgentDirectMessageSessionBody,
  type UpdateAgentDirectMessageSessionResponse,
  updateAgentDirectMessageSessionBodySchema,
  updateAgentDirectMessageSessionResponseSchema,
  updateAgentProfileDefaultProjectRpcInputSchema,
  updateAgentProfileExecutionModeBodySchema,
  updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema,
  updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema,
  updateAgentProfilePrimaryBindingModelSelectionBodySchema,
  updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema,
  updateCenterAgentModelBodySchema,
  updateCenterAgentModelResponseSchema,
  updateCenterAgentOperatingStateBodySchema,
  updateCenterAgentOperatingStateResponseSchema,
  updateCenterAgentOrganizationMemoryPolicyBodySchema,
  updateFeedbackReportingPolicyBodySchema,
  updateOrganizationInformationProtectionPolicyBodySchema,
  writeCurrentDeviceObservedMetadataBodySchema,
} from "@openmeld/schemas";
import type {
  AccountSpaceActiveWakeSummaryResponse,
  AccountSpaceActiveWakeSummaryRpcInput,
  AccountSpaceIndexQuery,
  AccountSpaceIndexResponse,
  AddOrganizationDirectoryProfilesToSpaceBody,
  AgentActivitySessionInventoryRpcInput,
  AgentActivitySnapshotRpcInput,
  AgentActivityStatsRpcInput,
  AgentControllerCollaborationMode,
  AgentControllerPermissionMode,
  AgentExecutionReadinessResponseOptions,
  AgentExecutionReadinessTargetRuntime,
  AgentProfileBindingOpenCodePermission,
  AgentProfileBindingProjection,
  AgentProfileExecutionModeResponse,
  AgentStreamPart,
  AgentTaskCompletionCondition,
  AgentWorkloadSnapshot,
  ArchiveProjectRpcInput,
  CenterAgentAction,
  CenterAgentAddAgentProfilesToSpaceBody,
  CenterAgentAddAgentProfilesToSpaceResponse,
  CenterAgentAddMembersToSpaceBody,
  CenterAgentAddMembersToSpaceResponse,
  CenterAgentAddMembersToSpaceResult,
  CenterAgentAttribution,
  CenterAgentCheckAgentProfileReadinessBody,
  CenterAgentCheckAgentProfileReadinessResponse,
  CenterAgentConnectAgentProfileToLocalAgentBody,
  CenterAgentConnectAgentProfileToLocalAgentResponse,
  CenterAgentConnectorConnectionSelection,
  CenterAgentCreateAgentProfileBody,
  CenterAgentCreateAgentProfileResponse,
  CenterAgentCreateConfiguredAgentProfileBody,
  CenterAgentCreateSpaceBody,
  CenterAgentCreateSpaceResponse,
  CenterAgentDelegationCompletionMode,
  CenterAgentDirectMessageSpaceProjection,
  CenterAgentDispatchHistoryEntry,
  CenterAgentEnableAgentProfileBody,
  CenterAgentEnableAgentProfileResponse,
  CenterAgentListAgentActivitySessionsToolRpcInput,
  CenterAgentListAgentProfileCreationDefaultsBody,
  CenterAgentListAgentProfileCreationDefaultsResponse,
  CenterAgentListAgentTasksBody,
  CenterAgentListAgentTasksResponse,
  CenterAgentListComputersBody,
  CenterAgentListComputersResponse,
  CenterAgentListLocalAgentConnectionCandidatesBody,
  CenterAgentListLocalAgentConnectionCandidatesResponse,
  CenterAgentListLocalAgentInstallationsBody,
  CenterAgentListLocalAgentInstallationsResponse,
  CenterAgentListOpportunitiesToolRpcInput,
  CenterAgentListOrganizationMembersResponse,
  CenterAgentListOrganizationMembersToolRpcInput,
  CenterAgentListSlackChannelsBody,
  CenterAgentListSlackChannelsResponse,
  CenterAgentListSpaceFilesResponse,
  CenterAgentListSpaceFilesRpcInput,
  CenterAgentManageSpaceFilesResponse,
  CenterAgentManageSpaceFilesRpcInput,
  CenterAgentModelConfigurationResponse,
  CenterAgentOrganizationMemoryPolicyResponse,
  CenterAgentPostSlackChannelMessageBody,
  CenterAgentPostSlackChannelMessageResponse,
  CenterAgentPostSlackFileBody,
  CenterAgentPostSlackFileResponse,
  CenterAgentPostSlackThreadMessageBody,
  CenterAgentPostSpaceMessageBody,
  CenterAgentPostSpaceMessageResponse,
  CenterAgentReadAgentActivityToolRpcInput,
  CenterAgentReadAuditJournalRpcInput,
  CenterAgentReadChangelogToolRpcInput,
  CenterAgentReadConnectorActionOperationBody,
  CenterAgentReadConnectorActionOperationResponse,
  CenterAgentReadDispatchHistoryBody,
  CenterAgentReadDispatchHistoryResponse,
  CenterAgentReadMemberComputersBody,
  CenterAgentReadMemberComputersResponse,
  CenterAgentReadMemberOpenMeldServiceStatusBody,
  CenterAgentReadMemberOpenMeldServiceStatusResponse,
  CenterAgentReadPeopleComputersBody,
  CenterAgentReadPeopleComputersResponse,
  CenterAgentReadSlackChannelHistoryBody,
  CenterAgentReadSlackChannelHistoryResponse,
  CenterAgentReadSlackChannelMembersBody,
  CenterAgentReadSlackChannelMembersResponse,
  CenterAgentReadSlackFileBody,
  CenterAgentReadSlackFileResponse,
  CenterAgentReadSlackWorkspaceDirectoryBody,
  CenterAgentReadSlackWorkspaceDirectoryResponse,
  CenterAgentReadSpaceContextBody,
  CenterAgentReadSpaceContextResponse,
  CenterAgentReadSpaceFileResponse,
  CenterAgentReadSpaceFileRpcInput,
  CenterAgentReadTurnDiagnosticsResponse,
  CenterAgentReadTurnDiagnosticsRpcInput,
  CenterAgentRecommendOpportunityToolRpcInput,
  CenterAgentRecordConnectorActionAuditBody,
  CenterAgentRecordConnectorActionAuditResponse,
  CenterAgentRecordConnectorActionOperationBody,
  CenterAgentRecordConnectorActionOperationResponse,
  CenterAgentRememberForOrganizationBody,
  CenterAgentRememberForOrganizationResponse,
  CenterAgentRemoteRuntimeAvailability,
  CenterAgentRemoteRuntimeAvailabilityReasonCode,
  CenterAgentRemoveAgentProfilesFromSpaceBody,
  CenterAgentRemoveAgentProfilesFromSpaceResponse,
  CenterAgentRequestOpenMeldToolsUpdateBody,
  CenterAgentRequestOpenMeldToolsUpdateResponse,
  CenterAgentRespondToOpportunityToolRpcInput,
  CenterAgentSaveSpaceFileResponse,
  CenterAgentSaveSpaceFileRpcInput,
  CenterAgentSearchSlackMessagesBody,
  CenterAgentSearchSlackMessagesResponse,
  CenterAgentSelectLocalAgentInstallationBody,
  CenterAgentSelectLocalAgentInstallationResponse,
  CenterAgentSetOpenMeldToolsMaintenanceBody,
  CenterAgentSetOpenMeldToolsMaintenanceResponse,
  CenterAgentSlackWorkspaceConnectBody,
  CenterAgentSlackWorkspaceConnectionResponse,
  CenterAgentSlackWorkspaceDisconnectResponse,
  CenterAgentSpaceAuthoringContractResponse,
  CenterAgentStartSelfMemberResearchToolRpcInput,
  CenterAgentToolSpeaker,
  CenterAgentUpdateAgentProfileRuntimeSettingsBody,
  CenterAgentUpdateAgentProfileRuntimeSettingsResponse,
  CenterAgentUpdateProfileBody,
  CenterAgentUpdateProfileResponse,
  CenterAgentUpdateSpaceSettingsBody,
  CenterAgentUpdateSpaceSettingsResponse,
  CenterAgentWakeAgentProfilesInSpaceBody,
  CenterAgentWakeAgentProfilesInSpaceResponse,
  CenterAgentWakeAgentProfilesInSpacesBody,
  CenterAgentWakeAgentProfilesInSpacesResponse,
  CenterAgentWatchAgentTaskBody,
  CenterAgentWatchAgentTaskResponse,
  CenterAgentWipeMemberMemoryResponse,
  ChangelogQuery,
  ChangelogQueryResponse,
  CommitSpaceFileWriteInput,
  ComputerFileAccessPolicyResponse,
  ComputerFileAccessReadRpcInput,
  ComputerFileAccessUpdateRpcInput,
  ComputerPowerRpcInput,
  ConnectorAppRequestListResponse,
  ConnectorAppRequestResponse,
  ConnectorConnection,
  ConnectorConnectionListResponse,
  ConnectorConnectionName,
  ConnectorConnectionPreference,
  ConnectorService,
  ConvertDirectMessageToSpaceBody,
  ConvertDirectMessageToSpaceResponse,
  CreateCenterAgentContextLoadReceiptBody,
  CreateCenterAgentContextLoadReceiptResponse,
  CreateCenterAgentContextManifestBody,
  CreateCenterAgentContextManifestResponse,
  CreateConnectorAppRequestBody,
  CreateProjectRpcInput,
  CreateSpaceDiagnosticReportBody,
  CreateSpaceDiagnosticReportResponse,
  CreateSpaceFolderBody,
  CreateSpaceFolderResponse,
  CreateSpaceTaskBody,
  CurrentAgentProfileSessionLookupResponse,
  CurrentDeviceTargetResponse,
  CurrentLocalAgentInstallationsResponse,
  CurrentLocalRuntimeReplyReadinessResponse,
  DaemonServiceLane,
  DeleteSpaceAttachmentRecordInput as DeleteSpaceAttachmentRecordInputContract,
  DeleteSpaceAttachmentRecordResult as DeleteSpaceAttachmentRecordResultContract,
  DesignateCenterAgentBody,
  DesignateCenterAgentResponse,
  DisableAgentProfilePrimaryBindingResponse,
  DispatchResult,
  EnsureAgentProfilePrimaryBindingBody,
  EnsureAgentProfilePrimaryBindingResponse,
  ExecuteAgentProfileWorkRecoveryBody,
  ExecuteAgentProfileWorkRecoveryResponse,
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  FeedbackReportingPolicyResponse,
  ForgetComputerResponse,
  ForgetCurrentComputerResponse,
  GetActiveSpaceWakeProgressResponse,
  GetAgentExecutionReadinessBatchBody,
  GetAgentExecutionReadinessBatchResponse,
  GetAgentExecutionReadinessResponse,
  GetAgentProfileControllerChangeEligibilityResponse,
  GetAgentProfileCreationDefaultsResponse,
  GetAgentProfilePrimaryBindingResponse,
  GetCenterAgentDesignationResponse,
  GetCenterAgentDirectMessageSpaceProjectionResponse,
  GetCenterAgentOperatingStateResponse,
  GetLocalRuntimeExpectedRoutesResponse,
  GetPrepareReadinessQuery,
  GetPrepareReadinessResponse,
  GetSpaceConversationStateResponse,
  GetSpaceDispatchLookupResponse,
  GetSpaceDispatchResultResponse,
  GetSpaceEntryResolutionInput,
  GetSpaceEntryResolutionResponse,
  GetSpaceMessageDetailsResponse,
  GetSpaceMessageReactionsResponse,
  GetSpaceStatusResponse,
  GetSpaceThreadResponse,
  GetSpaceUpdatesResponse,
  GetSpaceWakeProgressResponse,
  GetSpaceWakeTraceWaterfallResponse,
  GitHubAppInstallationStartResponse,
  GitHubAppInstallationVerificationResponse,
  InspectExecutionRecoveryResponse,
  LarkPlatformActiveRegistrationListResponse,
  LarkPlatformProvider,
  LarkPlatformRegistrationBeginMode,
  LarkPlatformRegistrationResponse,
  LeaveSpaceResponse,
  ListAgentProfileCreationDefaultsResponse,
  ListCenterAgentAuditJournalQuery,
  ListCenterAgentAuditJournalResponse,
  ListProjectsRpcInput,
  ListSpaceFileRevisionsResponse,
  ListSpaceFilesQuery,
  ListSpaceFilesResponse,
  ListSpaceTasksResponse,
  ListSpaceThreadEventsResponse,
  ListSpaceThreadSignalsQuery,
  ListSpaceThreadSignalsResponse,
  ListSpaceThreadsResponse,
  LocalFolderPickerResult,
  LocalFolderPickerRpcInput,
  LocalProjectControlConnectCandidateRpcInput,
  LocalProjectControlConnectDeclaredPathRpcInput,
  LocalProjectControlDiscoverProjectsRpcInput,
  LocalProjectControlRemoveConnectionRpcInput,
  LocalProjectControlRemoveMissingConnectionsRpcInput,
  LocalProjectControlSetDefaultConnectionRpcInput,
  LocalRuntimeEnrollmentBody,
  LocalRuntimeEnrollmentResponse,
  LocalRuntimesQuery,
  LocalRuntimesResponse,
  MessageChannelConnectionListResponse,
  MessageChannelConnectionProjection,
  MessageChannelIdentityLinkConsumeBody,
  MessageChannelIdentityLinkConsumeResponse,
  MessageChannelIdentityLinkPreviewBody,
  MessageChannelIdentityLinkPreviewResponse,
  MessageChannelProvider,
  MessageChannelSetupRequestBody,
  MessageChannelSetupRequestResponse,
  MutateSpaceTaskBody,
  NotifyAgentProfileRouteCatalogChangedBody,
  NotifyAgentProfileRouteCatalogChangedResponse,
  NotifyAgentProfilesRouteCatalogChangedBody,
  ObservedDeviceMetadata,
  OpenCenterAgentDirectMessageSpaceResponse,
  OpenDirectMessageSpaceBody,
  OpenDirectMessageSpaceResponse,
  OpenMeldRequestContext,
  OpenMeldToolsControlRequest,
  OrganizationAgentRuntimeOverviewResponse,
  OrganizationComputersResponse,
  OrganizationDirectoryAgentProfileIdentity,
  OrganizationDirectoryResponse,
  OrganizationInformationProtectionPolicyResponse,
  OrganizationMemberOpenMeldServiceStatusesResponse,
  OrganizationMemberWebActivityResponse,
  OrganizationProfileDirectoryReadOptions,
  OrganizationProfileDirectoryResponse,
  OrganizationSpaceDirectoryResponse,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  OrganizationUsageOverviewRpcInput,
  OwnerComputerDiagnostics,
  PatchSpaceContractBody,
  PendingGitHubAppInstallation,
  PeopleComputerFileAccessReadRpcInput,
  PeopleComputerFileAccessUpdateRpcInput,
  PeopleComputerFolderPickerRpcInput,
  PeopleComputerProjectDiscoveryRpcInput,
  PeopleComputersResponse,
  PeopleComputerTarget,
  PostSpaceMembersResponse,
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  PrepareSpaceFileWriteResponse,
  PutSpaceContractBody,
  GetSpaceMessageReactionsInput as ReactionReadInput,
  SetSpaceMessageReactionInput as ReactionWriteInput,
  RecordSpaceAttachmentPayload,
  RefreshCurrentLocalAgentCatalogResponse,
  RemoveSpaceMembersResponse,
  RequestCurrentOpenMeldToolsUpdateResponse,
  ResolvedSpaceMemberProfile,
  ResolveSpaceAttachmentForDownloadPayload,
  ResolveSpaceFileContentInput,
  ResolveSpaceFileContentResponse,
  RespondToSpaceAgentInteractionBody,
  RespondToSpaceAgentInteractionResponse,
  RestoreSpaceFileEntryBody,
  RestoreSpaceFileEntryResponse,
  RestoreSpaceFileRevisionBody,
  SelectCurrentLocalAgentInstallationBody,
  SelectCurrentLocalAgentInstallationResponse,
  ServiceConnectionIncidentReportRpcInput,
  ServiceConnectionIncidentsReadRpcInput,
  SetAgentProfileCreationDefaultsBody,
  SetAgentProfileCreationDefaultsResponse,
  SetCurrentAgentProfileWorkspaceBody,
  SetCurrentAgentProfileWorkspaceResponse,
  SetCurrentLocalAgentEnabledBody,
  SetCurrentLocalAgentEnabledResponse,
  SetCurrentOpenMeldToolsMaintenanceBody,
  SetCurrentOpenMeldToolsMaintenanceResponse,
  SetLocalRuntimeDisplayNameBody,
  SlackIdentityLinkConsumeBody,
  SlackIdentityLinkConsumeResponse,
  SlackIdentityLinkPreviewBody,
  SlackIdentityLinkPreviewResponse,
  SlackOAuthIdentityLinkInput,
  SlackOAuthIdentityLinkResult,
  SlackOAuthInstallationInput,
  SlackOAuthInstallationResult,
  SlackOAuthStateConsumeResponse,
  SlackOAuthStateCreateResponse,
  SlackReadUnavailableResponse,
  SlackWorkspaceDirectoryMember,
  SlackWorkspaceMembership,
  SpaceAccessMode,
  SpaceAccessModeState,
  SpaceAgentStreamTerminal,
  SpaceAgentWorkloadInput,
  SpaceAttachmentDescriptor,
  SpaceBoardResponse,
  SpaceBoardRoomProjection,
  SpaceBootstrapResponse,
  SpaceComposerUploadDescriptor,
  SpaceContract,
  SpaceDispatchTraceResponse,
  SpaceDispatchTraceResponseContractVersion,
  SpaceEntryAccessResponse,
  SpaceFileAuditEvent,
  SpaceFileDescriptor,
  SpaceFilePinMutation,
  SpaceFilePinsResponse,
  SpaceFileStreamMetadata,
  SpaceFileStreamOptions,
  SpaceHistoryNavigation,
  SpaceHistoryNavigationQuery,
  SpaceIdentityDirectory,
  SpaceInputQueueMutation,
  SpaceInputQueueResponse,
  SpaceLinkJoinPolicy,
  SpaceMemberDirectory,
  SpaceMembersSnapshot,
  SpaceMessageAttachment,
  SpaceMessagePinMutation,
  SpaceMessagePinsResponse,
  SpaceSignalAuthoringPolicy,
  SpaceTaskDetailOptions,
  SpaceTaskMutationReceipt,
  SpaceTaskPhase,
  SpaceTaskResponse,
  SpaceThreadContext,
  SpaceViewerMembershipResponse,
  StartCenterAgentMemberResearchResponse,
  SubmitAgentActivityEventsRpcInput,
  SubmitAgentActivitySessionReconciliationRpcInput,
  SubmitAgentControllerTaskLifecycleEventItem,
  SubmitAgentControllerTaskLifecycleEventsResponse,
  SubmitAgentControllerTaskLifecycleEventsRpcInput,
  SubmitRuntimeAgentControllerReportResult,
  SubmitRuntimeAgentControllerReportsResponse,
  SubmitRuntimeProviderConversationProofResult,
  SubmitRuntimeProviderConversationProofsResponse,
  SubmitRuntimeRegistrationResponse,
  TrashSpaceFileEntryResponse,
  UpdateAgentProfileDefaultProjectResponse,
  UpdateAgentProfileDefaultProjectRpcInput,
  UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeBody,
  UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeBody,
  UpdateAgentProfilePrimaryBindingModelSelectionBody,
  UpdateAgentProfilePrimaryBindingOpenCodePermissionBody,
  UpdateCenterAgentModelBody,
  UpdateCenterAgentModelResponse,
  UpdateCenterAgentOperatingStateBody,
  UpdateCenterAgentOperatingStateResponse,
  UpdateCenterAgentOrganizationMemoryPolicyBody,
  UpdateFeedbackReportingPolicyBody,
  UpdateOrganizationInformationProtectionPolicyBody,
  UpdateProjectRpcInput,
  UpdateSpaceFileEntryBody,
  UpdateSpaceFileEntryResponse,
  WriteCurrentDeviceObservedMetadataResponse,
} from "@openmeld/schemas/types";
import {
  buildDirectMessagePairKey,
  createAuthenticatedSpaceAccessContext,
  createDispatchContinuationSpaceAccessContext,
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
  type SpaceAccessContext,
} from "@openmeld/space";
import type { z } from "zod/v4";
import {
  asQueryable,
  readAgentAccessTargets,
} from "../agent-access/infrastructure/postgresql/agent-access-repo";
import {
  rpcCenterAgentListAgentActivitySessions as centerAgentListAgentActivitySessions,
  rpcCenterAgentReadAgentActivity as centerAgentReadAgentActivity,
} from "../agent-activity/activity-center-agent-rpc";
import { rpcSubmitAgentActivityEvents as submitAgentActivityEvents } from "../agent-activity/activity-event-rpc";
import { canResumeAgentActivitySessionSelection } from "../agent-activity/activity-session-inventory-repository";
import {
  rpcReadAgentActivitySessionInventory as readAgentActivitySessionInventory,
  rpcSubmitAgentActivitySessionReconciliation as submitAgentActivitySessionReconciliation,
} from "../agent-activity/activity-session-inventory-rpc";
import { rpcReadAgentActivitySnapshot as readAgentActivitySnapshot } from "../agent-activity/activity-snapshot-rpc";
import { rpcReadAgentActivityStats as readAgentActivityStats } from "../agent-activity/activity-stats-rpc";
import {
  type AgentExecutionReadinessReads,
  createAgentExecutionReadinessReads,
} from "../agent-execution/application/agent-execution-readiness-reads";
import {
  type AgentExecutionTargetRuntimeContext,
  type CoreAgentExecutionReadiness,
  preloadRuntimeDeviceDisplayNamesForOwner,
  readPreloadedRuntimeDeviceDisplayName,
  resolveCoreAgentExecutionReadinessForProfile,
} from "../agent-execution/application/agent-execution-readiness-service";
import { readAgentProfileUsage } from "../agent-execution/application/agent-profile-usage";
import {
  resolvePublicWakeabilityReason,
  resolveUsageExhaustedResetAt,
} from "../agent-execution/application/public-wakeability-reason";
import { acceptProviderConversationProofRecord } from "../agent-execution/infrastructure/postgresql/provider-conversation-proof-repo";
import { projectOrganizationDirectoryAgentProfileOperationalContext } from "../agent-profile/application/agent-profile-operational-context";
import { resolveAgentProfileWorkRecoveryAuthScope } from "../agent-profile/application/agent-profile-work-recovery-auth-scope";
import { combineAgentWorkloads } from "../agent-profile/application/agent-workload";
import {
  type AgentProfileBindingCommandResult,
  AgentProfileBindingModelSelectionValidationError,
  type AgentProfileBindingOwner,
  type AgentProfileBindingProfileOwnerValidationEvidence,
  ensurePrimaryAgentProfileBinding,
  updatePrimaryAgentProfileBindingAgentControllerCollaborationMode,
  updatePrimaryAgentProfileBindingAgentControllerPermissionMode,
  updatePrimaryAgentProfileBindingModelSelection,
  updatePrimaryAgentProfileBindingOpenCodePermission,
} from "../agent-profile-binding/application/agent-profile-binding-command-service";
import { toHttpAgentProfileBindingProjection } from "../agent-profile-binding/application/agent-profile-binding-http-projection";
import {
  type AgentProfileBindingLookupResult,
  lookupPrimaryAgentProfileBinding,
} from "../agent-profile-binding/application/agent-profile-binding-lookup-service";
import { requireSameAgentProfileBindingTarget } from "../agent-profile-binding/application/agent-profile-binding-target";
import {
  rememberAgentProfileCreationDefaults,
  resolveFirstUseAgentProfileCreationDefaults,
} from "../agent-profile-binding/application/agent-profile-creation-defaults-service";
import { readLocalRuntimeExpectedRoutes } from "../agent-profile-binding/application/local-runtime-expected-routes-service";
import {
  AgentProfileBindingOwnerInventoryLimitError,
  type AgentProfileBindingRecord,
  compareAndSetPrimaryAgentProfileBindingModelSelectionRecord,
  createPostgresAgentProfileBindingCommandStore,
  createPostgresAgentProfileBindingLookupStore,
  disablePrimaryAgentProfileBindingRecord,
  ensurePrimaryAgentProfileBindingRecord,
  listEnabledPrimaryAgentProfileBindingRecordsForProfile,
  listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController,
  listPrimaryAgentProfileConfigurations,
  readPrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecordByControllerConversation,
} from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import {
  type AgentProfileCreationDefaultsRecord,
  listAgentProfileCreationDefaultsRecords,
  readAgentProfileCreationDefaultsRecord,
} from "../agent-profile-binding/infrastructure/postgresql/agent-profile-creation-defaults-repo";
import { rpcSubmitAgentControllerTaskLifecycleEvents as submitAgentControllerTaskLifecycleEvents } from "../agent-task-coordination/application/agent-controller-task-lifecycle-rpc";
import {
  listRegisteredAgentControllerTasks,
  readRegisteredAgentControllerTask,
} from "../agent-task-coordination/infrastructure/postgresql/agent-controller-task-lifecycle-repo";
import { readAgentDelegationByChildTask } from "../agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import { readAuthProfileFacts } from "../auth/application/profile-facts-reader";
import {
  type CenterAgentOrganizationMember,
  prepareCenterAgentOrganizationMemberRequest,
} from "../center-agent/application/anonymous-member-request";
import { projectCenterAgentAuditJournalEvidence } from "../center-agent/application/audit-journal-evidence";
import {
  areCenterAgentContextLoadSelectionsEqual,
  CenterAgentContextLoadReceiptError,
  resolveCenterAgentContextLoadSelection,
} from "../center-agent/application/center-agent-context-load-receipt-service";
import {
  buildDelegatedTaskText,
  CenterAgentDelegationPreparationError,
  planCenterAgentWakeDelegation,
  requireCenterAgentContinuationParent,
} from "../center-agent/application/center-agent-delegation-service";
import {
  type CenterAgentDirectMessageOpenTimingRecorder,
  type CenterAgentDirectMessageOpenTimingStage,
  createCenterAgentDirectMessageOpenTiming,
} from "../center-agent/application/center-agent-dm-open-observability";
import {
  projectCenterAgentModelConfiguration,
  resolveCenterAgentModelRouteForBinding,
} from "../center-agent/application/center-agent-model-service";
import { listAuthorizedCenterAgentSessions } from "../center-agent/application/center-agent-session-list";
import {
  executeCenterAgentSlackFilePublication,
  executeCenterAgentSlackPublication,
} from "../center-agent/application/center-agent-slack-publication-service";
import { prepareCenterAgentTaskWatch } from "../center-agent/application/center-agent-task-watch-service";
import {
  executeCenterAgentWakePublication,
  prepareCenterAgentWakePublication,
  prepareCenterAgentWakePublicationBatch,
} from "../center-agent/application/center-agent-wake-publication-service";
import { isHostedCenterAgentExecutionTarget } from "../center-agent/application/hosted-center-agent-binding";
import { requireCenterAgentPermissionModeConfirmation } from "../center-agent/application/permission-mode-confirmation";
import {
  buildCenterAgentReadinessResponse,
  type CenterAgentProductOperationDeps,
  checkAgentProfileReadinessOperation,
  connectAgentProfileToLocalAgentOperation,
  projectCenterAgentComputerSetupOptions,
  projectCenterAgentLocalAgentConnectionCandidates,
  updateAgentProfileRuntimeSettingsOperation,
} from "../center-agent/application/product-operations";
import {
  prepareCenterAgentRepresentedMemberRequest,
  prepareHostedCenterAgentRequest,
  type VerifiedCenterAgentRepresentedMember,
} from "../center-agent/application/represented-member-request";
import { shouldWriteDestinationNeutralTaskContinuations } from "../center-agent/application/task-continuation-rollout";
import { continueTaskSummary } from "../center-agent/application/task-summary-recovery-service";
import {
  resolveCenterAgentAuditAttribution,
  writeCenterAgentAuditEntry,
} from "../center-agent/center-agent-audit";
import {
  type CenterAgentContextLoadReceiptRecord,
  insertCenterAgentContextLoadReceipt,
  insertCenterAgentContextManifest,
  readCenterAgentContextLoadReceiptByManifest,
  readCenterAgentContextManifestForLoadReceipt,
} from "../center-agent/center-agent-context-manifest-repository";
import { pauseActiveCenterAgentNativeDeliveries } from "../center-agent/center-agent-operating-state-service";
import {
  type AgentProfileOrganizationContext,
  isAgentProfileEligibleForOrganization,
  readAgentProfileOrganizationContext,
} from "../center-agent/center-agent-organization-scope";
import {
  type CenterAgentDesignationRecord,
  insertCenterAgentAuditJournalEntry,
  insertCenterAgentAuditJournalEntryIfMissing,
  listCenterAgentAuditJournalEntries,
  readCenterAgentDesignationRecord,
  readCenterAgentWakeAuditAttribution,
  readResolvedOrganizationDirectorySpaceMember,
  readResolvedOrganizationOwnerHumanSpaceMember,
  readResolvedOrganizationSpaceMember,
  resolveCenterAgentAttribution,
  toCenterAgentAuditJournalEntryDto,
  toCenterAgentDesignationDto,
  updateCenterAgentOperatingStateRecord,
  upsertCenterAgentDesignationRecord,
} from "../center-agent/center-agent-repository";
import {
  buildCenterAgentConnectorActionOperationScope,
  type CenterAgentConnectorActionRequester,
  readCenterAgentConnectorActionOperationForRecovery,
  readCenterAgentConnectorActionOperationForRequest,
  readConnectorActionReplayPermission,
  recordCenterAgentConnectorActionOperation,
  resolveConnectorActionReplayWindowRemainingMs,
} from "../center-agent/connector-action-operation-repository";
import {
  type CurrentDesignatedCenterAgentAuthorization,
  requireCurrentDesignatedCenterAgentCaller,
} from "../center-agent/current-designated-center-agent";
import {
  syncCompletedGitHubIssue,
  verifyGitHubIssueCompletion,
} from "../center-agent/github-issue-completion";
import type { CenterAgentWakePublicationCommand } from "../center-agent/infrastructure/postgresql/center-agent-wake-publication-repo";
import { startCenterAgentMemberResearch } from "../center-agent-member-research/member-research-service";
import type { CenterAgentMemoryEpisodeOrigin } from "../center-agent-memory/contract";
import {
  createCoreCenterAgentMemoryService,
  readCoreOrganizationMemoryAvailability,
} from "../center-agent-memory/core-memory-service";
import {
  resolveExplicitMemoryEpisodeOrigin,
  resolveExplicitMemorySourceDeliveryDb,
  resolveExplicitMemorySourceTurnRequest,
} from "../center-agent-memory/explicit-memory-origin";
import { createPostgresCenterAgentMemoryRepository } from "../center-agent-memory/postgresql-memory-repository";
import { rpcCenterAgentReadChangelog as centerAgentReadChangelog } from "../changelog/changelog-center-agent-rpc";
import { rpcReadChangelog as readChangelog } from "../changelog/changelog-read-rpc";
import { createComputerFileAccessRpc } from "../computers/computer-file-access-rpc";
import { createLocalFolderPickerRpc } from "../computers/local-folder-picker-rpc";
import { createServiceConnectionEvidenceRpc } from "../computers/service-connection-evidence-rpc";
import { readOwnerServiceConnectionTrace } from "../computers/service-connection-trace";
import {
  reconcileAgentModelInbox,
  reconcileRuntimeAgentModelInboxes,
} from "../config/agent-model-inbox-reconciliation";
import {
  readAuthoredModelCatalog,
  readModelCatalog,
} from "../config/model-catalog";
import {
  listConnectorAppRequestsForRequester,
  upsertConnectorAppRequest,
} from "../connectors/connector-app-request-repository";
import {
  type ConnectorConnectionRecord,
  createConnectorConnectionName,
  createSharedConnectorConnectionName,
  listConnectorConnections,
  markConnectorConnectionDisconnected,
  readConnectorConnectionForUser,
  readSharedConnectorConnection,
  reconcileConnectorConnections,
  upsertPendingConnectorConnection,
  upsertPendingSharedConnectorConnection,
} from "../connectors/connector-connection-repository";
import { requireConnectorVerificationRead } from "../connectors/connector-verification-read";
import {
  beginExistingGitHubAppInstallationVerification,
  beginGitHubAppInstallationVerification,
  completeGitHubAppInstallation,
  createGitHubAppInstallationState,
  readPendingGitHubAppInstallation,
} from "../connectors/github-app-installation-state";
import {
  requireRemotePluginConnection,
  selectPluginConnection,
} from "../connectors/plugin-access";
import { readPluginActionRequestStatusForOperation } from "../connectors/plugin-action-requests";
import {
  assertBoundPluginConnection,
  boundPluginConnectionPreference,
  readPluginConnectionExecutionBinding,
} from "../connectors/plugin-connection-execution-binding";
import {
  type DispatchHistoryEntry,
  listRecentDispatchLedgerEntriesForSpace,
} from "../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import { callRuntimeTransportApi as callPowerTransport } from "../dispatch/infrastructure/runtime-transport/runtime-transport-api-client";
import {
  acquireRuntimeTransportAgentProfileExecutionTargetMutation,
  acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation,
  controlRuntimeTransportOpenMeldTools,
  isRuntimeTransportProfileWorkspaceOutcomeDefinitive,
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoutesBatch,
  manageRuntimeTransportLocalAgentInstallation,
  manageRuntimeTransportProfileFolders,
  notifyRuntimeTransportRouteCatalogChanged,
  readRuntimeTransportAgentProfileExecutionState,
  readRuntimeTransportAgentProfileOperationalContexts,
  readRuntimeTransportAgentProfileWorkRecovery,
  readRuntimeTransportComputerFileAccessPolicy,
  readRuntimeTransportProfileFolderProjection,
  readRuntimeTransportProfileWorkspace,
  refreshRuntimeTransportLocalAgentCatalog,
  releaseRuntimeTransportAgentProfileExecutionTargetMutation,
  selectRuntimeTransportLocalFolders,
  setRuntimeTransportLocalAgentEnabled,
  setRuntimeTransportProfileWorkspace,
  updateRuntimeTransportComputerFileAccessPolicy,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import {
  resolveRuntimeTransportExecutionRecoveryShard,
  resolveRuntimeTransportOwnerShard,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import {
  rpcReadFeedbackReportingPolicy,
  rpcSetFeedbackReportingPolicy,
} from "../feedback/transport/rpc/feedback-management-rpc";
import type { CoreBindings } from "../lib/bindings";
import {
  type CoreLocalComponentsRelease,
  readCoreLocalComponentsRelease,
} from "../local-components/release-source";
import {
  isServiceAuthFreshnessRequired,
  resolveLocalComponentUpdateProjection,
} from "../local-components/update-projection";
import { assignBoundProfileToMemberAgent } from "../member-agent/member-agent-profile-assignment";
import {
  isMemberAgentsEnabled,
  isRequestChainEnforced,
} from "../member-agent/member-agents-feature";
import {
  hasStartedTutorial,
  readFirstWork,
  reserveFirstWork,
  updateFirstWork,
} from "../onboarding/first-work";
import {
  rpcCenterAgentListOpportunities as centerAgentListOpportunities,
  rpcCenterAgentRecommendOpportunity as centerAgentRecommendOpportunity,
  rpcCenterAgentRespondToOpportunity as centerAgentRespondToOpportunity,
} from "../opportunities/opportunity-center-agent-rpc";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { withOrganizationAgentTaskActivity } from "../organizations/organization-agent-task-activity";
import {
  listOrganizationComputers,
  type OrganizationComputerLiveSession,
} from "../organizations/organization-computers-service";
import {
  readOrganizationAccountIdentityProjection,
  readOrganizationPersonalClassification,
  readOrganizationRouteSlug,
  resolveActiveOrganizationMembership,
  resolveOrganizationMembershipById,
  resolveOrganizationMembershipWithRouteSlug,
  resolveOrganizationOwnerOrAdminMembership,
} from "../organizations/organization-context";
import {
  resolveOrganizationDirectoryAgentProfiles,
  resolveOrganizationDirectoryMembers,
} from "../organizations/organization-directory";
import {
  readOrganizationInformationProtectionPolicy,
  saveOrganizationInformationProtectionPolicy,
} from "../organizations/organization-information-protection-repository";
import {
  listOrganizationMemberActivity,
  recordOrganizationMemberActivity,
} from "../organizations/organization-member-activity-repository";
import { listOrganizationMemberOpenMeldServiceStatuses } from "../organizations/organization-member-openmeld-service-status-service";
import {
  listOnlineOrganizationMembers,
  recordOrganizationMemberPresence,
} from "../organizations/organization-member-presence-repository";
import { projectPeopleComputerControls } from "../people-computers/control-policy";
import { requirePeopleComputerControlSession } from "../people-computers/control-target";
import {
  projectPeopleComputers,
  resolvePeopleComputerConnectionStatus,
} from "../people-computers/projection";
import { updateAgentProfileDefaultProjectForAuthority } from "../projects/agent-profile-default-project-service";
import {
  buildCanonicalLocalProjectConnectRequest,
  buildCanonicalLocalProjectDiscoveryRequest,
  createLocalProjectControlRpc,
} from "../projects/local-project-control-rpc";
import { prepareProjectIssueActionAdmission } from "../projects/project-issue-action-admission";
import { readActiveProjectIds } from "../projects/project-repository";
import { prepareExpectedHumanProjectRequest } from "../projects/project-request-preparation";
import {
  rpcArchiveProject as archiveProject,
  rpcCreateProject as createProject,
  rpcListProjects as listProjects,
  rpcReadProjectIssueRouting as readProjectIssueRouting,
  rpcUpdateProject as updateProject,
  rpcUpdateProjectIssueRouting as updateProjectIssueRouting,
} from "../projects/project-rpc";
import { attachCenterAgentTurnRuntimeEvidence } from "../remote-agent/application/center-agent-turn-diagnostics";
import { reconcileChannelAuthorizationUpdates } from "../remote-agent/application/channel-authorization-update-service";
import {
  requireDelegatedConnectionSelection,
  resolveRemoteAgentConnectorRequester,
} from "../remote-agent/application/delegated-requester";
import { listLarkPlatformProvidersEnabledForOrganization } from "../remote-agent/application/lark-platform-provider-policy";
import {
  beginRemoteAgentLarkPlatformRegistration,
  disconnectRemoteAgentLarkPlatformRegistration,
  LarkPlatformRegistrationServiceError,
  listRemoteAgentActiveLarkPlatformRegistrations,
  pollRemoteAgentLarkPlatformRegistration,
} from "../remote-agent/application/lark-platform-registration-service";
import {
  buildMessageChannelIdentityLinkId,
  deleteRemoteAgentMessageChannelIdentityLinkTarget,
  findRemoteAgentMessageChannelIdentityLinkTarget,
  listRemoteAgentMessageChannelConnectionProjections,
  listRemoteAgentMessageChannelIdentityLinkProjections,
  type MessageChannelProviderAccountEmailsResolver,
} from "../remote-agent/application/message-channel-connection-projection";
import {
  buildMessageChannelIdentityDisconnectAuditRecord,
  buildMessageChannelIdentityReplacementAuditRecord,
} from "../remote-agent/application/message-channel-identity-link-audit";
import { digestMessageChannelIdentityLinkToken } from "../remote-agent/application/message-channel-identity-link-token";
import { continueMessageChannelIdentityOnboardingRequest } from "../remote-agent/application/message-channel-native-delivery-service";
import { createConfiguredMessageChannelProviderRegistry } from "../remote-agent/application/message-channel-provider-runtime";
import {
  createMessageChannelSetupRequest,
  formatMessageChannelProviderName,
  resolveMessageChannelSetupRequests,
} from "../remote-agent/application/message-channel-setup-request-service";
import { REMOTE_AGENT_ACTIVE_EXECUTION_EVIDENCE_FRESHNESS_MS } from "../remote-agent/application/native-delivery-execution-evidence";
import { continueSlackIdentityOnboardingRequest } from "../remote-agent/application/native-delivery-service";
import { prepareRemoteAgentMemberRequest } from "../remote-agent/application/remote-agent-member-request";
import {
  type RemoteAgentRuntimeAvailability,
  resolveRemoteAgentRuntimeAvailability,
} from "../remote-agent/application/remote-agent-runtime-policy";
import { requireRemoteAgentToolCaller } from "../remote-agent/application/remote-agent-tool-caller";
import { resolveSlackBotToken } from "../remote-agent/application/slack-bot-token";
import {
  getSlackMessagePermalink,
  isSlackFullWorkspaceMember,
  listSlackChannelMemberIds,
  listSlackChannels,
  listSlackWorkspaceMembers,
  readSlackChannelHistory,
  readSlackFile,
  readSlackUserIdentity,
  resolveSlackChannelMessageTarget,
  resolveSlackConversationMessageTargetById,
  SlackApiError,
  type SlackChannelMessageTarget,
  type SlackWorkspaceMember,
  searchSlackPublicMessages,
} from "../remote-agent/application/slack-client";
import {
  createSlackIdentityLinkToken,
  digestSlackIdentityLinkToken,
  SLACK_IDENTITY_LINK_TOKEN_TTL_MS,
} from "../remote-agent/application/slack-identity-link-token";
import { runSlackInstallationWelcomePreparationTick as advanceSlackInstallationWelcomePreparations } from "../remote-agent/application/slack-installation-welcome-preparation-service";
import { runSlackInvitedMemberOnboardingTick } from "../remote-agent/application/slack-invited-member-onboarding-service";
import { installSlackWorkspaceFromOAuth } from "../remote-agent/application/slack-oauth-installation";
import {
  buildSlackOAuthChannelsReturnPath,
  buildSlackOAuthPeopleReturnPath,
  consumeSlackOAuthState,
  createSlackOAuthState,
} from "../remote-agent/application/slack-oauth-state";
import { decryptSlackSearchAuthorization } from "../remote-agent/application/slack-search-authorization";
import { readRemoteAgentLarkPlatformChannelConnection } from "../remote-agent/infrastructure/postgresql/lark-platform-channel-connection-repo";
import { readRemoteAgentLarkPlatformIdentityLink } from "../remote-agent/infrastructure/postgresql/lark-platform-identity-link-repo";
import {
  claimRemoteAgentMessageChannelIdentityLinkToken,
  consumeRemoteAgentMessageChannelIdentityLinkToken,
  type RemoteAgentMessageChannelIdentityLinkTokenRecord,
  readActiveRemoteAgentMessageChannelIdentityLinkToken,
  readRemoteAgentMessageChannelIdentityLinkTokenForUser,
} from "../remote-agent/infrastructure/postgresql/message-channel-identity-link-token-repo";
import {
  listActiveRemoteAgentNativeDeliveryTargetsBySpaceIds,
  listRemoteAgentNativeDeliveryTurnDiagnosticRecords,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByDispatchAndConversation,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  authorizeFailedSlackInstallationWelcomeRetry,
  enqueueSlackInstallationWelcomePreparation,
  type SlackInstallationWelcomePreparation,
} from "../remote-agent/infrastructure/postgresql/slack-installation-welcome-preparation-repo";
import { SLACK_INSTALLATION_WELCOME_VERSION } from "../remote-agent/infrastructure/postgresql/slack-installation-welcome-repo";
import type { SlackInvitedMemberOnboarding } from "../remote-agent/infrastructure/postgresql/slack-teammate-invitation-delivery-repo";
import {
  claimSlackIdentityLinkTokenForUser,
  consumeSlackIdentityLinkTokenAndUpsertUserLink,
  insertSlackIdentityLinkToken,
  readActiveSlackIdentityLinkToken,
  readSlackIdentityLinkTokenForUser,
  readSlackUserIdentityLink,
  readSlackUserIdentityLinksForUsers,
  type SlackUserIdentityLinkRecord,
} from "../remote-agent/infrastructure/postgresql/slack-user-identity-link-repo";
import {
  createRemoteAgentSlackWorkspaceBinding,
  deleteRemoteAgentSlackWorkspaceBindingByOrganization,
  readRemoteAgentSlackWorkspaceBinding,
  readRemoteAgentSlackWorkspaceBindingByOrganization,
} from "../remote-agent/infrastructure/postgresql/slack-workspace-binding-repo";
import {
  hasSlackDirectMessageScopes,
  prepareDeleteSlackWorkspaceTokenByOrganizationStatement,
  readSlackWorkspaceToken,
} from "../remote-agent/infrastructure/postgresql/slack-workspace-token-repo";
import {
  rpcCreateRoutine as createRoutine,
  rpcDeleteRoutine as deleteRoutine,
  rpcListRoutineRuns as listRoutineRuns,
  rpcListRoutines as listRoutines,
  rpcListRoutineTargetSpaces as listRoutineTargetSpaces,
  rpcPauseRoutine as pauseRoutine,
  type CreateRoutineInput as RoutineCreateInput,
  type DeleteRoutineInput as RoutineDeleteInput,
  type PauseRoutineInput as RoutinePauseInput,
  type ResumeRoutineInput as RoutineResumeInput,
  type ListRoutineRunsInput as RoutineRunsListInput,
  type ListRoutinesInput as RoutinesListInput,
  type ListRoutineTargetSpacesInput as RoutineTargetSpacesListInput,
  type UpdateRoutineInput as RoutineUpdateInput,
  rpcResumeRoutine as resumeRoutine,
  rpcUpdateRoutine as updateRoutine,
} from "../routines/routine-rpc";
import { acceptRuntimeAgentControllerReport } from "../runtime-registry/application/runtime-agent-controller-report-service";
import { lookupRuntime } from "../runtime-registry/application/runtime-lookup-service";
import { registerRuntime } from "../runtime-registry/application/runtime-registration-service";
import {
  acceptRuntimeAgentControllerReportRecord,
  readCurrentRuntimeAgentControllerReport,
} from "../runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import { resolveRuntimePrepareReadinessFromPostgres } from "../runtime-registry/infrastructure/postgresql/runtime-prepare-readiness-postgresql";
import {
  listOwnedDeviceExecutionTargetRecords,
  listOwnedDeviceExecutionTargetRecordsForUsers,
  readRuntimeRegistryRecord,
  readRuntimeRegistryRecordByRuntimeId,
  registerRuntimeRegistryRecord,
} from "../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { notifyAgentProfileWorkUsageRecoveryAvailable } from "../runtime-transport/application/agent-profile-work-usage-recovery";
import { selectCurrentOwnerServiceSessionsByDeviceLane } from "../runtime-transport/application/current-owner-service-sessions";
import {
  resolveProjectedDefaultFolder,
  resolveRemovableFolder,
} from "../runtime-transport/application/profile-folder-projection-store";
import { listActiveRuntimeCoordinatorExecutionTargetsBySpaceIds } from "../runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
import { recordSensitiveOperationOutcome } from "../sensitive-operations/application/sensitive-operation-gate";
import {
  parseRpcErrorPayload,
  readSafeRpcFailureReasonCode,
} from "../shared/rpc/rpc-json";
import { listAuthorizedAgentDirectMessageSessions } from "../space/application/agent-direct-message-session-list";
import {
  assertSpaceAccessMatchesSpace,
  requireWritableSpaceActor,
} from "../space/application/space-access-policy";
import type { SpaceBootstrapWithTiming } from "../space/application/space-bootstrap-timing";
import type {
  SpaceClaimTimeLivenessInput,
  SpaceClaimTimeLivenessResult,
} from "../space/application/space-claim-liveness-service";
import {
  discardSpaceComposerUpload,
  readSpaceComposerUploadStream,
  type SpaceComposerUploadScope,
  SpaceComposerUploadStorageError,
  stageSpaceComposerUpload,
} from "../space/application/space-composer-upload-storage";
import {
  buildSpaceEntryResolution,
  buildUnavailableSpaceEntryResolution,
  type SpaceEntryAccessResult,
} from "../space/application/space-entry-resolution-service";
import { buildSpaceFileAuditEvent } from "../space/application/space-file-audit";
import { hashSpaceFileStream } from "../space/application/space-file-stream";
import {
  readSpaceMemberNameFromAuth,
  SPACE_MEMBER_NAME_READ_BUDGET_MS,
} from "../space/application/space-members-service";
import {
  projectSpaceTaskDetailForClient,
  projectSpaceTaskReceiptForClient,
  projectSpaceTasksForClient,
  spaceTaskContractUpdateRequiredError,
} from "../space/application/space-task-client-compatibility";
import type { FinalOutcomeWriteAuthority } from "../space/application/types";
import { readSpaceBoardExecutionProjection } from "../space/infrastructure/postgresql/space-board-execution-read-repo";
import { readSpaceDispatchLookupByClientMessageId } from "../space/infrastructure/postgresql/space-dispatch-read-repo";
import type { Space } from "../space/transport/do/space";
import {
  buildSpaceRpcRequest,
  readSpaceRpcJsonOrThrow,
  type SpaceRpcJsonResult,
  unwrapSpaceRpcJsonResult,
} from "../space/transport/rpc/space-rpc-adapter";
import {
  resolveSpaceMessageAttachmentReferences,
  SpaceAttachmentReferenceInvalidError,
} from "../space-attachment/application/space-message-attachment-service";
import {
  deleteSpaceAttachmentRecord,
  insertSpaceAttachmentRecord,
  readSpaceAttachmentRecord,
} from "../space-attachment/infrastructure/postgresql/space-attachment-repo";
import {
  countDirectMessageSpacesForPair,
  listAccountSpaceIdsFromSpaceIndex,
  listAccountSpacesFromSpaceIndex,
  listAgentWorkloadSpaceIds,
  listOrganizationSpacesFromSpaceIndex,
  listSpaceIndexTargetProfileNameSnapshots,
  readCenterAgentDirectMessageProjectionCandidateByPairKey,
  readCenterAgentDirectMessageProjectionCandidateBySpaceId,
  readDirectMessageSpaceIndexCandidateBySpaceId,
  readReusableDirectMessageSpaceIndexCandidate,
  readSpaceIndexNamesByIds,
  readSpaceIndexOrganizationJoinTarget,
} from "../space-index/space-index-repository";
import {
  ConnectedComputerEnrollmentInvalidError,
  enrollLocalSetupDeviceUseCase,
  forgetComputerUseCase,
  forgetCurrentComputerUseCase,
  getCurrentDeviceTargetUseCase,
  getCurrentLocalRuntimeReplyReadinessUseCase,
  listLocalRuntimesUseCase,
  setLocalRuntimeDisplayNameUseCase,
} from "../start/application/current-device-target-service";
import {
  type OwnedDeviceRegistryRecord,
  writeCurrentDeviceObservedMetadataUseCase,
} from "../start/application/owned-device-registry-service";
import {
  connectOwnedDeviceToConnectedComputerRecord,
  readConnectedComputerIdentityRecord,
} from "../start/infrastructure/postgresql/connected-computer-repo";
import { resolveCurrentDeviceFromBindings } from "../start/infrastructure/postgresql/current-device-derivation-repo";
import {
  forgetComputerRecordAtomically,
  forgetCurrentComputerRecordAtomically,
} from "../start/infrastructure/postgresql/current-device-forget-repo";
import {
  deleteForgottenDeviceRecord,
  readForgottenDeviceRecord,
} from "../start/infrastructure/postgresql/forgotten-device-repo";
import {
  listOwnedDeviceRegistryRecords,
  listOwnedDeviceRegistryRecordsForUsers,
  readOwnedDeviceRegistryRecord,
  upsertOwnedDeviceRegistryRecord,
} from "../start/infrastructure/postgresql/owned-device-registry-repo";
import { rpcReadOrganizationUsageOverview as readOrganizationUsageOverview } from "../usage/organization-usage-overview-rpc";
import { recordUserTimeZoneObservation } from "../user-time-context/user-time-context-repository";
import {
  requireCurrentLocalRuntimeExecutionTarget,
  requireCurrentLocalRuntimeServiceTarget,
} from "./current-local-control-target";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "./errors";
import {
  requireAcceptedLocalAgentControlPayload,
  requireAcceptedLocalAgentInstallationPayload,
  requireAcceptedLocalAgentUpdatePayload,
} from "./local-agent-control-policy";
import { callRequiredAuthWorkerRpc } from "./required-auth-worker-rpc";
import {
  isHexSpaceId,
  resolveNamedSpaceId,
  resolveNewSpaceId,
  resolveSpaceStub,
} from "./space-ref";
export type CreateRoutineInput = RoutineCreateInput;
export type ArchiveProjectInput = ArchiveProjectRpcInput;
export type CreateProjectInput = CreateProjectRpcInput;
export type ListProjectsInput = ListProjectsRpcInput;
export type UpdateProjectInput = UpdateProjectRpcInput;
export type UpdateAgentProfileDefaultProjectInput =
  UpdateAgentProfileDefaultProjectRpcInput;
export type ReadComputerFileAccessPolicyInput = ComputerFileAccessReadRpcInput;
export type UpdateComputerFileAccessPolicyInput =
  ComputerFileAccessUpdateRpcInput;
export type SelectLocalFoldersInput = LocalFolderPickerRpcInput;
export type DiscoverProjectsInput = LocalProjectControlDiscoverProjectsRpcInput;
export type ConnectCandidateInput = LocalProjectControlConnectCandidateRpcInput;
export type ConnectDeclaredPathInput =
  LocalProjectControlConnectDeclaredPathRpcInput;
export type SetDefaultConnectionInput =
  LocalProjectControlSetDefaultConnectionRpcInput;
export type RemoveConnectionInput = LocalProjectControlRemoveConnectionRpcInput;
export type RemoveMissingConnectionsInput =
  LocalProjectControlRemoveMissingConnectionsRpcInput;
export type SubmitAgentActivityEventsInput = SubmitAgentActivityEventsRpcInput;
export type SubmitAgentActivitySessionReconciliationInput =
  SubmitAgentActivitySessionReconciliationRpcInput;
export type SubmitAgentControllerTaskLifecycleEventsInput =
  SubmitAgentControllerTaskLifecycleEventsRpcInput;
export type ReadAgentActivitySnapshotInput = AgentActivitySnapshotRpcInput;
export type ReadAgentActivitySessionInventoryInput =
  AgentActivitySessionInventoryRpcInput;
export type ReadAgentActivityStatsInput = AgentActivityStatsRpcInput;
export type ReadOrganizationUsageOverviewInput =
  OrganizationUsageOverviewRpcInput;
export type CenterAgentReadAgentActivityInput =
  CenterAgentReadAgentActivityToolRpcInput;
export type CenterAgentListAgentActivitySessionsInput =
  CenterAgentListAgentActivitySessionsToolRpcInput;
export type CenterAgentReadChangelogInput =
  CenterAgentReadChangelogToolRpcInput;
export type CenterAgentReadTurnDiagnosticsInput =
  CenterAgentReadTurnDiagnosticsRpcInput;
export type CenterAgentListOpportunitiesInput =
  CenterAgentListOpportunitiesToolRpcInput;
export type CenterAgentRecommendOpportunityInput =
  CenterAgentRecommendOpportunityToolRpcInput;
export type CenterAgentRespondToOpportunityInput =
  CenterAgentRespondToOpportunityToolRpcInput;
export type ReadChangelogInput = ChangelogQuery;
export type DeleteRoutineInput = RoutineDeleteInput;
export type ListRoutineRunsInput = RoutineRunsListInput;
export type ListRoutineTargetSpacesInput = RoutineTargetSpacesListInput;
export type ListRoutinesInput = RoutinesListInput;
export type PauseRoutineInput = RoutinePauseInput;
export type ResumeRoutineInput = RoutineResumeInput;
export type UpdateRoutineInput = RoutineUpdateInput;
export function rpcListProjects(env: CoreBindings, input: ListProjectsInput) {
  return listProjects(env, input);
}

export function rpcReadProjectIssueRouting(
  env: CoreBindings,
  input: Parameters<typeof readProjectIssueRouting>[1]
) {
  return readProjectIssueRouting(env, input);
}

export function rpcUpdateProjectIssueRouting(
  env: CoreBindings,
  input: Parameters<typeof updateProjectIssueRouting>[1]
) {
  return updateProjectIssueRouting(env, input);
}
export function rpcCreateProject(env: CoreBindings, input: CreateProjectInput) {
  return createProject(env, input);
}
export function rpcUpdateProject(env: CoreBindings, input: UpdateProjectInput) {
  return updateProject(env, input);
}
export function rpcArchiveProject(
  env: CoreBindings,
  input: ArchiveProjectInput
) {
  return archiveProject(env, input);
}
export async function rpcUpdateAgentProfileDefaultProject(
  env: CoreBindings,
  input: UpdateAgentProfileDefaultProjectInput,
  expectedBindingTarget?: import("../agent-profile-binding/application/agent-profile-binding-target").AgentProfileBindingTarget
): Promise<UpdateAgentProfileDefaultProjectResponse> {
  const parsedRequest =
    updateAgentProfileDefaultProjectRpcInputSchema.safeParse(input);
  if (!parsedRequest.success) {
    throw createCoreRpcHttpError({
      code: "agent_profile.invalid_input",
      reason:
        parsedRequest.error.issues[0]?.message ??
        "Invalid Agent Profile Default Project request.",
      status: 400,
    });
  }
  const request = parsedRequest.data;
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context: request.context,
    expectedOrganizationId: request.expectedOrganizationId,
  });
  return await updateAgentProfileDefaultProjectForAuthority({
    agentProfileId: request.agentProfileId,
    authority,
    defaultProjectId: request.defaultProjectId,
    onlyIfUnmodified: request.onlyIfUnmodified,
    expectedBindingTarget:
      expectedBindingTarget ?? request.expectedBindingTarget,
    env,
    service,
  });
}
export async function rpcUpdateBoundAgentProfileDefaultProject(
  env: CoreBindings,
  input: UpdateAgentProfileDefaultProjectInput
) {
  const expected = agentProfileBindingTargetSchema.safeParse(
    input.expectedBindingTarget
  );
  if (!expected.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "The current Binding is required to save this working folder.",
    });
  }
  return await rpcUpdateAgentProfileDefaultProject(env, input, expected.data);
}
const localProjectControlRpc = createLocalProjectControlRpc({
  resolveCurrentTarget: resolveCurrentLocalProjectControlTarget,
});
export function rpcDiscoverPeopleComputerProjects(
  env: CoreBindings,
  input: PeopleComputerProjectDiscoveryRpcInput
) {
  const parsed = peopleComputerProjectDiscoveryRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer Project discovery request.",
    });
  }
  const { deviceId, runtimeLane, ...request } = parsed.data;
  return buildPeopleComputerProjectControlRpc({
    deviceId,
    runtimeLane,
  }).discoverProjects(env, request);
}
function buildPeopleComputerProjectControlRpc(target: PeopleComputerTarget) {
  return createLocalProjectControlRpc({
    resolveCurrentTarget: async ({ capability, env: targetEnv, userId }) => {
      const { localRuntimes, ownerService } =
        await resolveCurrentLocalServiceContext({
          env: targetEnv,
          userId,
          target,
        });
      const session = requirePeopleComputerControlSession({
        target,
        inventory: localRuntimes,
        ownerService,
      });
      if (
        session.executionCompatibility.status !== "compatible" ||
        session.capabilities.localProjectControl?.[capability] !== true
      ) {
        throw createCoreRpcHttpError({
          status: 409,
          code: "service_update_required",
          reason:
            "Update OpenMeld Service in this environment before managing Project folders.",
        });
      }
      return target;
    },
  });
}
export function rpcConnectPeopleComputerProjectCandidate(
  env: CoreBindings,
  input: ConnectCandidateInput & PeopleComputerTarget
) {
  const { deviceId, runtimeLane, ...request } = input;
  return buildPeopleComputerProjectControlRpc({
    deviceId,
    runtimeLane,
  }).connectCandidate(env, request);
}
export function rpcConnectPeopleComputerProjectPath(
  env: CoreBindings,
  input: ConnectDeclaredPathInput & PeopleComputerTarget
) {
  const { deviceId, runtimeLane, ...request } = input;
  return buildPeopleComputerProjectControlRpc({
    deviceId,
    runtimeLane,
  }).connectDeclaredPath(env, request);
}
export function rpcSetPeopleComputerProjectDefaultConnection(
  env: CoreBindings,
  input: SetDefaultConnectionInput & PeopleComputerTarget
) {
  const { deviceId, runtimeLane, ...request } = input;
  return buildPeopleComputerProjectControlRpc({
    deviceId,
    runtimeLane,
  }).setDefaultConnection(env, request);
}
function buildComputerFileAccessRpc(target?: PeopleComputerTarget) {
  return createComputerFileAccessRpc({
    readPolicy: readRuntimeTransportComputerFileAccessPolicy,
    requireOwnerUserId: requireAuthenticatedOwnerUserId,
    resolveCurrentTarget: async ({ env, userId }) => {
      const { bindingTarget, localRuntimes, ownerService } =
        await resolveCurrentLocalServiceContext({ env, userId, target });
      if (target) {
        const session = requirePeopleComputerControlSession({
          target,
          inventory: localRuntimes,
          ownerService,
        });
        if (
          !(
            projectPeopleComputerControls(session).computerFileAccess
              .readPolicy &&
            projectPeopleComputerControls(session).computerFileAccess
              .updatePolicy
          )
        ) {
          throw createCoreRpcHttpError({
            status: 409,
            code: "computer.file_access.unsupported",
            reason:
              "This environment does not support managing file access. Update OpenMeld Service and try again.",
          });
        }
        return target;
      }
      return requireCurrentLocalRuntimeServiceTarget({
        bindingTarget,
        inventory: localRuntimes,
        ownerService,
        offlineError: {
          code: "computer.file_access.service_offline",
          reason: "This computer isn't reachable for OpenMeld right now.",
          status: 503,
        },
      });
    },
    updatePolicy: updateRuntimeTransportComputerFileAccessPolicy,
  });
}
const computerFileAccessRpc = buildComputerFileAccessRpc();
export function rpcReadPeopleComputerFileAccessPolicy(
  env: CoreBindings,
  input: PeopleComputerFileAccessReadRpcInput
) {
  const parsed = peopleComputerFileAccessReadRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer file access target.",
    });
  }
  const { context, deviceId, runtimeLane } = parsed.data;
  return buildComputerFileAccessRpc({ deviceId, runtimeLane }).readPolicy(env, {
    context,
    expectedDeviceId: deviceId,
  });
}
export async function rpcComputerSessionHistory(
  env: CoreBindings,
  input: SessionHistoryRpcInput
) {
  const parsed = sessionHistoryRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid session history request.",
    });
  }
  const { context, deviceId, runtimeLane, organizationId, request } =
    parsed.data;
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  if (context.actorContext.callerPrincipalId !== ownerUserId) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "session_history.denied",
      reason:
        "Use the verified session history agent tool for delegated requests.",
    });
  }
  await requireOrganizationMembershipOrThrow({ context, env, organizationId });
  const requester =
    context.actorContext.profileKind === "human"
      ? {
          requestRootId: context.actorContext.requestId,
          ownerUserId,
          requesterUserId: ownerUserId,
          readerProfileId: null,
          delegatorProfileId: null,
          spaceId: null,
          audience: "owner_private" as const,
        }
      : await requireSessionHistoryLocalRequester(
          env,
          parsed.data,
          ownerUserId
        );
  const { localRuntimes, ownerService } =
    await resolveCurrentLocalServiceContext({
      env,
      userId: ownerUserId,
      target: { deviceId, runtimeLane },
    });
  requirePeopleComputerControlSession({
    target: { deviceId, runtimeLane },
    inventory: localRuntimes,
    ownerService,
  });
  return requestComputerSessionHistory({
    env,
    ownerUserId,
    deviceId,
    runtimeLane,
    request: {
      expectedDeviceId: deviceId,
      organizationId,
      request,
      requester,
    },
  });
}
export function rpcUpdatePeopleComputerFileAccessPolicy(
  env: CoreBindings,
  input: PeopleComputerFileAccessUpdateRpcInput
) {
  const parsed = peopleComputerFileAccessUpdateRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer file access request.",
    });
  }
  const { deviceId, runtimeLane, ...request } = parsed.data;
  return buildComputerFileAccessRpc({ deviceId, runtimeLane }).updatePolicy(
    env,
    { ...request, expectedDeviceId: deviceId }
  );
}
function buildLocalFolderPickerRpc(target?: PeopleComputerTarget) {
  return createLocalFolderPickerRpc({
    requireOwnerUserId: requireAuthenticatedOwnerUserId,
    resolveCurrentTarget: async ({ env, userId }) => {
      const { bindingTarget, localRuntimes, ownerService } =
        await resolveCurrentLocalServiceContext({ env, userId, target });
      if (target) {
        const session = requirePeopleComputerControlSession({
          target,
          inventory: localRuntimes,
          ownerService,
        });
        if (
          !projectPeopleComputerControls(session).localFolderPicker
            .selectFolders
        ) {
          throw createCoreRpcHttpError({
            status: 409,
            code: "local.folder_picker.service_update_required",
            reason:
              "This environment does not support choosing folders. Update OpenMeld Service or enter a path manually.",
          });
        }
        return target;
      }
      return requireCurrentLocalRuntimeServiceTarget({
        bindingTarget,
        inventory: localRuntimes,
        ownerService,
        offlineError: {
          code: "local.folder_picker.service_offline",
          reason: "This computer isn't reachable for OpenMeld right now.",
          status: 503,
        },
      });
    },
    selectFolders: selectRuntimeTransportLocalFolders,
  });
}
const localFolderPickerRpc = buildLocalFolderPickerRpc();
export function rpcSelectPeopleComputerFolders(
  env: CoreBindings,
  input: PeopleComputerFolderPickerRpcInput
) {
  const parsed = peopleComputerFolderPickerRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer folder picker request.",
    });
  }
  const { deviceId, runtimeLane, ...request } = parsed.data;
  return buildLocalFolderPickerRpc({ deviceId, runtimeLane }).selectFolders(
    env,
    { ...request, expectedDeviceId: deviceId }
  );
}
export function rpcReadComputerFileAccessPolicy(
  env: CoreBindings,
  input: ReadComputerFileAccessPolicyInput
): Promise<ComputerFileAccessPolicyResponse> {
  return computerFileAccessRpc.readPolicy(env, input);
}
export function rpcUpdateComputerFileAccessPolicy(
  env: CoreBindings,
  input: UpdateComputerFileAccessPolicyInput
): Promise<ComputerFileAccessPolicyResponse> {
  return computerFileAccessRpc.updatePolicy(env, input);
}
export function rpcSelectLocalFolders(
  env: CoreBindings,
  input: SelectLocalFoldersInput
): Promise<LocalFolderPickerResult> {
  return localFolderPickerRpc.selectFolders(env, input);
}
export function rpcDiscoverProjects(
  env: CoreBindings,
  input: DiscoverProjectsInput
) {
  return localProjectControlRpc.discoverProjects(env, input);
}
export function rpcConnectCandidate(
  env: CoreBindings,
  input: ConnectCandidateInput
) {
  return localProjectControlRpc.connectCandidate(env, input);
}
export function rpcConnectDeclaredPath(
  env: CoreBindings,
  input: ConnectDeclaredPathInput
) {
  return localProjectControlRpc.connectDeclaredPath(env, input);
}
export function rpcSetDefaultConnection(
  env: CoreBindings,
  input: SetDefaultConnectionInput
) {
  return localProjectControlRpc.setDefaultConnection(env, input);
}
export function rpcRemoveConnection(
  env: CoreBindings,
  input: RemoveConnectionInput
) {
  return localProjectControlRpc.removeConnection(env, input);
}
export function rpcRemoveMissingConnections(
  env: CoreBindings,
  input: RemoveMissingConnectionsInput
) {
  return localProjectControlRpc.removeMissingConnections(env, input);
}
export {
  buildCanonicalLocalProjectConnectRequest,
  buildCanonicalLocalProjectDiscoveryRequest,
};
export function rpcSubmitAgentActivityEvents(
  env: CoreBindings,
  input: SubmitAgentActivityEventsInput
) {
  return submitAgentActivityEvents(env, input);
}
export function rpcSubmitAgentActivitySessionReconciliation(
  env: CoreBindings,
  input: SubmitAgentActivitySessionReconciliationInput
) {
  return submitAgentActivitySessionReconciliation(env, input);
}
export function rpcSubmitAgentControllerTaskLifecycleEvents(
  env: CoreBindings,
  input: SubmitAgentControllerTaskLifecycleEventsInput
): Promise<SubmitAgentControllerTaskLifecycleEventsResponse> {
  return submitAgentControllerTaskLifecycleEvents(env, input);
}
export function rpcReadAgentActivitySnapshot(
  env: CoreBindings,
  input: ReadAgentActivitySnapshotInput
) {
  return readAgentActivitySnapshot(env, input);
}
export function rpcReadAgentActivitySessionInventory(
  env: CoreBindings,
  input: ReadAgentActivitySessionInventoryInput
) {
  return readAgentActivitySessionInventory(env, input);
}
export function rpcReadAgentActivityStats(
  env: CoreBindings,
  input: ReadAgentActivityStatsInput
) {
  return readAgentActivityStats(env, input);
}
export function rpcReadOrganizationUsageOverview(
  env: CoreBindings,
  input: ReadOrganizationUsageOverviewInput
) {
  return readOrganizationUsageOverview(env, input);
}
export function rpcCenterAgentReadAgentActivity(
  env: CoreBindings,
  input: CenterAgentReadAgentActivityInput
) {
  return centerAgentReadAgentActivity(env, input);
}
export function rpcCenterAgentListAgentActivitySessions(
  env: CoreBindings,
  input: CenterAgentListAgentActivitySessionsInput
) {
  return centerAgentListAgentActivitySessions(env, input);
}
export function rpcCenterAgentReadChangelog(
  env: CoreBindings,
  input: CenterAgentReadChangelogInput
) {
  return centerAgentReadChangelog(env, input);
}
export async function rpcCenterAgentReadTurnDiagnostics(
  env: CoreBindings,
  input: CenterAgentReadTurnDiagnosticsInput
): Promise<CenterAgentReadTurnDiagnosticsResponse> {
  const parsed = centerAgentReadTurnDiagnosticsRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent turn diagnostics request",
      status: 400,
    });
  }
  const authorization = await prepareHostedCenterAgentRequest(
    env,
    requireRpcContext(parsed.data.context)
  );
  const submissionId =
    authorization.context.agentControllerConversationId?.trim();
  const db = getPostgresDatabase(env);
  if (!(submissionId && db)) {
    throw centerAgentTurnDiagnosticsUnavailableError();
  }
  const currentDelivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  if (
    !currentDelivery ||
    (currentDelivery.status !== "accepted" &&
      currentDelivery.status !== "retry_observed") ||
    currentDelivery.routineRunId !== null ||
    currentDelivery.organizationId !==
      authorization.activeOrganization.organizationId ||
    currentDelivery.profileId !== authorization.actorProfileId
  ) {
    throw centerAgentTurnDiagnosticsUnavailableError();
  }
  const previousDeliveries =
    await listRemoteAgentNativeDeliveryTurnDiagnosticRecords({
      currentDelivery,
      db,
      limit: parsed.data.limit ?? CENTER_AGENT_TURN_DIAGNOSTICS_DEFAULT_LIMIT,
    });
  const turns = await attachCenterAgentTurnRuntimeEvidence({
    currentDelivery,
    deliveries: [currentDelivery, ...previousDeliveries],
    remoteAgentWorker: env.OPENMELD_REMOTE_AGENT_WORKER,
  });
  return centerAgentReadTurnDiagnosticsResponseSchema.parse({
    currentTurn: turns[0],
    organizationId: authorization.activeOrganization.organizationId,
    previousTurns: turns.slice(1),
  });
}
function centerAgentTurnDiagnosticsUnavailableError(): Error {
  return createCoreRpcHttpError({
    code: "center_agent.turn_diagnostics.current_turn_unavailable",
    reason:
      "OpenMeld could not verify this Center Agent turn in the native delivery ledger.",
    status: 409,
  });
}
export function rpcCenterAgentListOpportunities(
  env: CoreBindings,
  input: CenterAgentListOpportunitiesInput
) {
  return centerAgentListOpportunities(env, input);
}
export function rpcCenterAgentRecommendOpportunity(
  env: CoreBindings,
  input: CenterAgentRecommendOpportunityInput
) {
  return centerAgentRecommendOpportunity(env, input);
}
export function rpcCenterAgentRespondToOpportunity(
  env: CoreBindings,
  input: CenterAgentRespondToOpportunityInput
) {
  return centerAgentRespondToOpportunity(env, input);
}
export function rpcReadChangelog(
  env: CoreBindings,
  input: ReadChangelogInput
): Promise<ChangelogQueryResponse> {
  return readChangelog(env, input);
}
export function rpcListRoutines(env: CoreBindings, input: ListRoutinesInput) {
  return listRoutines(env, input);
}
export function rpcListRoutineTargetSpaces(
  env: CoreBindings,
  input: ListRoutineTargetSpacesInput
) {
  return listRoutineTargetSpaces(env, input);
}
export function rpcCreateRoutine(env: CoreBindings, input: CreateRoutineInput) {
  return createRoutine(env, input);
}
export function rpcUpdateRoutine(env: CoreBindings, input: UpdateRoutineInput) {
  return updateRoutine(env, input);
}
export function rpcPauseRoutine(env: CoreBindings, input: PauseRoutineInput) {
  return pauseRoutine(env, input);
}
export function rpcResumeRoutine(env: CoreBindings, input: ResumeRoutineInput) {
  return resumeRoutine(env, input);
}
export function rpcDeleteRoutine(env: CoreBindings, input: DeleteRoutineInput) {
  return deleteRoutine(env, input);
}
export function rpcListRoutineRuns(
  env: CoreBindings,
  input: ListRoutineRunsInput
) {
  return listRoutineRuns(env, input);
}
type SpaceRpcStub = DurableObjectStub<Space> & {
  rpcListSignals(input: ListSignalsInput): Promise<ListSignalsResult>;
  rpcListSignalsResult(
    input: ListSignalsInput
  ): Promise<SpaceRpcJsonResult<ListSignalsResult>>;
  rpcListDispatchConversationContinuitySignalsResult(
    input: ListSignalsInput
  ): Promise<SpaceRpcJsonResult<ListSignalsResult>>;
  rpcPostSignal(input: PostSignalInput): Promise<SignalEnvelope>;
  rpcPostDirectMessageSignal(
    input: PostSignalOnceByClientMessageIdInput & {
      pairKey: string;
      organizationId: string;
    }
  ): Promise<SignalEnvelope>;
  rpcPostSignalOnceByClientMessageId(
    input: PostSignalOnceByClientMessageIdInput
  ): Promise<SignalEnvelope>;
  rpcResolveOrRejectTextSignalByClientMessageId(input: {
    clientMessageId: string;
    spaceId: string;
  }): Promise<
    | {
        signal: Extract<
          SignalEnvelope,
          {
            type: "signal.text";
          }
        >;
        status: "accepted";
      }
    | {
        status: "rejected";
      }
  >;
  rpcPostStatusSignal(input: PostStatusSignalInput): Promise<SignalEnvelope>;
  rpcPostSystemNoticeSignal(
    input: PostSystemNoticeSignalInput
  ): Promise<SignalEnvelope>;
  rpcPostExecutionRecoveryNoticeSignal(
    input: PostExecutionRecoveryNoticeSignalInput
  ): Promise<PostExecutionRecoveryNoticeSignalResponse>;
  rpcInspectExecutionRecovery(
    input: InspectExecutionRecoveryInput
  ): Promise<InspectExecutionRecoveryResponse>;
  rpcExecuteExecutionRecovery(
    input: ExecuteExecutionRecoveryInput
  ): Promise<ExecuteExecutionRecoveryResponse>;
  rpcStartUsageExhaustedContinuation(
    input: StartUsageExhaustedContinuationInput
  ): Promise<StartUsageExhaustedContinuationResponse>;
  rpcPostTransientSignal(input: PostTransientSignalInput): Promise<void>;
  rpcGetMeta(input: GetSpaceMetaInput): Promise<SpaceMeta>;
  rpcGetEntryAccess(
    input: GetSpaceMetaInput
  ): Promise<SpaceEntryAccessResponse>;
  rpcFilePins(input: SpaceFilePinsInput): Promise<SpaceFilePinsResponse>;
  rpcMessagePins(
    input: SpaceMessagePinsInput
  ): Promise<SpaceMessagePinsResponse>;
  rpcInputQueue(input: SpaceInputQueueInput): Promise<SpaceInputQueueResponse>;
  rpcAgentWorkload(
    input: SpaceAgentWorkloadInput
  ): Promise<AgentWorkloadSnapshot>;
  rpcListTasks(input: ListSpaceTasksInput): Promise<ListSpaceTasksResponse>;
  rpcGetTask(input: GetSpaceTaskInput): Promise<SpaceTaskResponse>;
  rpcCreateTask(input: CreateSpaceTaskInput): Promise<SpaceTaskMutationReceipt>;
  rpcMutateTask(input: MutateSpaceTaskInput): Promise<SpaceTaskMutationReceipt>;
  rpcGetBoard(input: GetSpaceBoardInput): Promise<SpaceBoardRoomProjection>;
  rpcGetBoardResult(
    input: GetSpaceBoardInput
  ): Promise<SpaceRpcJsonResult<SpaceBoardRoomProjection>>;
  rpcGetContract(input: GetSpaceContractInput): Promise<SpaceContract>;
  rpcGetStatus(input: GetSpaceStatusInput): Promise<GetSpaceStatusResponse>;
  rpcGetStatusResult(
    input: GetSpaceStatusInput
  ): Promise<SpaceRpcJsonResult<GetSpaceStatusResponse>>;
  rpcGetConversationState(
    input: GetSpaceConversationStateRpcInput
  ): Promise<GetSpaceConversationStateResponse>;
  rpcGetBootstrap(
    input: GetSpaceBootstrapInput
  ): Promise<SpaceBootstrapResponse>;
  rpcGetBootstrapWithTiming(
    input: GetSpaceBootstrapInput
  ): Promise<SpaceBootstrapWithTiming>;
  rpcGetUpdates(input: GetSpaceUpdatesInput): Promise<GetSpaceUpdatesResponse>;
  rpcGetDispatchResult(
    input: GetSpaceDispatchResultInput
  ): Promise<GetSpaceDispatchResultResponse>;
  rpcPatchMeta(input: {
    spaceId: string;
    name?: string;
    purpose?: string;
    creator?: SpaceCreator;
    guide?: string;
    accessMode?: SpaceAccessMode;
    organizationId?: string;
    visibility?: "public" | "private";
    context?: CoreRpcContextInput;
    initializeIfAbsent?: boolean;
    password?: string;
  }): Promise<SpaceMeta>;
  rpcPatchMetaWithPasswordAtomic(input: {
    spaceId: string;
    name?: string;
    purpose?: string;
    creator?: SpaceCreator;
    guide?: string;
    organizationId: string;
    visibility: "public" | "private";
    password: string;
    context?: CoreRpcContextInput;
  }): Promise<SpaceMeta>;
  rpcInitializeDirectMessageMeta(input: {
    spaceId: string;
    name?: string;
    purpose: string;
    pairKey: string;
    creator?: SpaceCreator;
    ownerUserIds?: string[];
    guide: string;
    organizationId: string;
    visibility: "public" | "private";
  }): Promise<{
    created: boolean;
    meta: SpaceMeta;
  }>;
  rpcConvertDirectMessageToSpace(input: {
    context?: CoreRpcContextInput;
    includeMemberSnapshots?: ConvertDirectMessageToSpaceBody["includeMemberSnapshots"];
    members: ResolvedSpaceMemberProfile[];
    name: string;
    spaceId: string;
  }): Promise<ConvertDirectMessageToSpaceResponse>;
  rpcPutContract(input: PutSpaceContractInput): Promise<SpaceContract>;
  rpcPatchContract(input: PatchSpaceContractInput): Promise<SpaceContract>;
  rpcDelete(input: DeleteSpaceInput): Promise<DeleteSpaceResult>;
  rpcGetCursor(input: GetSpaceCursorInput): Promise<SpaceCursor>;
  rpcPatchCursor(input: UpdateSpaceCursorInput): Promise<SpaceCursor>;
  rpcGetMembers(input: GetSpaceMembersInput): Promise<SpaceMembersSnapshot>;
  rpcGetHistoryNavigation(
    input: GetSpaceMembersInput & SpaceHistoryNavigationQuery
  ): Promise<SpaceHistoryNavigation>;
  rpcGetIdentityDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceIdentityDirectory>;
  rpcGetMemberDirectory(
    input: GetSpaceMembersInput
  ): Promise<SpaceMemberDirectory>;
  rpcGetViewerMembership(
    input: GetSpaceViewerMembershipInput
  ): Promise<SpaceViewerMembershipResponse>;
  rpcListThreads(
    input: ListSpaceThreadsInput
  ): Promise<ListSpaceThreadsResponse>;
  rpcListThreadsResult(
    input: ListSpaceThreadsInput
  ): Promise<SpaceRpcJsonResult<ListSpaceThreadsResponse>>;
  rpcGetThread(input: GetSpaceThreadInput): Promise<GetSpaceThreadResponse>;
  rpcGetThreadResult(
    input: GetSpaceThreadInput
  ): Promise<SpaceRpcJsonResult<GetSpaceThreadResponse>>;
  rpcListThreadEvents(
    input: ListSpaceThreadEventsInput
  ): Promise<ListSpaceThreadEventsResponse>;
  rpcListThreadEventsResult(
    input: ListSpaceThreadEventsInput
  ): Promise<SpaceRpcJsonResult<ListSpaceThreadEventsResponse>>;
  rpcListThreadSignals(
    input: ListSpaceThreadSignalsInput
  ): Promise<ListSpaceThreadSignalsResponse>;
  rpcListThreadSignalsResult(
    input: ListSpaceThreadSignalsInput
  ): Promise<SpaceRpcJsonResult<ListSpaceThreadSignalsResponse>>;
  rpcGetClaimTimeLiveness(
    input: SpaceClaimTimeLivenessInput
  ): Promise<SpaceClaimTimeLivenessResult>;
  rpcGetDispatchTrace(
    input: GetSpaceDispatchTraceInput
  ): Promise<SpaceDispatchTraceResponse>;
  rpcGetDispatchLookup(
    input: GetSpaceDispatchLookupInput
  ): Promise<GetSpaceDispatchLookupResponse>;
  rpcGetWakeProgress(
    input: GetSpaceWakeProgressInput
  ): Promise<GetSpaceWakeProgressResponse>;
  rpcGetActiveWakeProgress(
    input: GetActiveSpaceWakeProgressInput
  ): Promise<GetActiveSpaceWakeProgressResponse>;
  rpcPostWakeStop(
    input: PostSpaceWakeStopInput
  ): Promise<PostSpaceWakeStopResponse>;
  rpcRespondToAgentInteraction(input: {
    spaceId: string;
    body: RespondToSpaceAgentInteractionBody;
    password?: string;
    context?: CoreRpcContextInput;
    spaceAccess?: SpaceAccessContext;
  }): Promise<RespondToSpaceAgentInteractionResponse>;
  rpcGetWakeTraceWaterfall(
    input: GetSpaceWakeTraceWaterfallInput
  ): Promise<GetSpaceWakeTraceWaterfallResponse>;
  rpcGetMessageReactions(
    input: GetSpaceMessageReactionsInput & {
      spaceAccess: SpaceAccessContext;
    }
  ): Promise<GetSpaceMessageReactionsResponse>;
  rpcSetMessageReaction(
    input: SetSpaceMessageReactionInput & {
      spaceAccess: SpaceAccessContext;
    }
  ): Promise<GetSpaceMessageReactionsResponse>;
  rpcGetMessageDetails(
    input: GetSpaceMessageDetailsInput
  ): Promise<GetSpaceMessageDetailsResponse>;
  rpcGetMessageLinks(
    input: GetSpaceMessageDetailsInput & {
      spaceAccess: SpaceAccessContext;
    }
  ): Promise<import("@openmeld/schemas").SpaceMessageLinks>;
  rpcCreateDiagnosticReport(
    input: CreateSpaceDiagnosticReportInput
  ): Promise<CreateSpaceDiagnosticReportResponse>;
  rpcPostMembers(
    input: AddSpaceMembersInput
  ): Promise<PostSpaceMembersResponse>;
  rpcBroadcastAgentReadinessInvalidated(input: {
    agentProfileIds: readonly string[];
    reason: string;
    spaceId: string;
  }): Promise<{
    agentProfileIds: string[];
    broadcast: boolean;
    ok: true;
    spaceId: string;
  }>;
  rpcBroadcastWakeProgressChanged(input: {
    agentProfileIds: readonly string[];
    clientMessageIds: readonly string[];
    reason: string;
    spaceId: string;
  }): Promise<{
    broadcast: boolean;
    ok: true;
    spaceId: string;
  }>;
  rpcRemoveMembers(
    input: RemoveSpaceMembersInput
  ): Promise<RemoveSpaceMembersResponse>;
  rpcLeaveSpace(input: LeaveSpaceInput): Promise<LeaveSpaceResponse>;
  rpcUpsertPassword(
    input: UpsertSpacePasswordInput
  ): Promise<SpacePasswordStateResult>;
  rpcClearPassword(
    input: ClearSpacePasswordInput
  ): Promise<SpacePasswordStateResult>;
  rpcSetAccessMode(
    input: SetSpaceAccessModeInput
  ): Promise<SpaceAccessModeStateResult>;
};
type RequiredAuthWorkerRpc = Required<
  NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>
>;
const ORGANIZATION_SPACE_DIRECTORY_LIMIT = 500;
const CENTER_AGENT_AUDIT_JOURNAL_DEFAULT_LIMIT = 100;
const CENTER_AGENT_DISPATCH_HISTORY_DEFAULT_LIMIT = 10;
const CENTER_AGENT_MANAGED_ROLE = "center_agent" as const;

const CREATE_SPACE_ALLOWED_FIELDS = new Set([
  "name",
  "purpose",
  "guide",
  "accessMode",
  "password",
  "visibility",
  "context",
]);
export type CoreRpcContextInput = OpenMeldRequestContext;
type CoreRpcSpaceAccessInput = {
  context?: CoreRpcContextInput;
  password?: string;
  spaceId: string;
  spaceAccess?: SpaceAccessContext;
};
type SpaceAttachmentAccessInput = {
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  spaceId: string;
};
export type RecordSpaceAttachmentInput = SpaceAttachmentAccessInput &
  Omit<RecordSpaceAttachmentPayload, "spaceId">;
/** Internal compensation input used only after a Gateway R2 write fails. */
export type DeleteSpaceAttachmentRecordInput =
  DeleteSpaceAttachmentRecordInputContract;
export type DeleteSpaceAttachmentRecordResult =
  DeleteSpaceAttachmentRecordResultContract;
export type ResolveSpaceAttachmentForDownloadInput =
  SpaceAttachmentAccessInput &
    Omit<ResolveSpaceAttachmentForDownloadPayload, "spaceId">;
export type ListSpaceFilesInput = SpaceAttachmentAccessInput & {
  query?: ListSpaceFilesQuery;
};
export type GetSpaceFileInput = SpaceAttachmentAccessInput & {
  fileId: string;
};
export type CreateSpaceFolderInput = SpaceAttachmentAccessInput & {
  body: CreateSpaceFolderBody;
};
export type UpdateSpaceFileEntryInput = SpaceAttachmentAccessInput & {
  body: UpdateSpaceFileEntryBody;
  entryId: string;
};
export type TrashSpaceFileEntryInput = SpaceAttachmentAccessInput & {
  clientMutationId: string;
  entryId: string;
};
export type RestoreSpaceFileEntryInput = SpaceAttachmentAccessInput & {
  body: RestoreSpaceFileEntryBody;
  entryId: string;
};
export type RestoreSpaceFileRevisionInput = SpaceAttachmentAccessInput & {
  body: RestoreSpaceFileRevisionBody;
  fileId: string;
  revision: number;
};
export type SpaceFileWriteInput = SpaceAttachmentAccessInput & {
  write: CommitSpaceFileWriteInput;
};
export type ResolveSpaceFileContentRpcInput = SpaceAttachmentAccessInput & {
  content: ResolveSpaceFileContentInput;
};
export type ReadSpaceFileContentRpcInput = ResolveSpaceFileContentRpcInput;
export type ReadSpaceFileContentRpcResponse =
  ResolveSpaceFileContentResponse & {
    bytes: ArrayBuffer;
  };
export type WriteSpaceFileContentRpcInput = SpaceFileWriteInput & {
  bytes: ArrayBuffer | ReadableStream<Uint8Array>;
};
export type StageSpaceComposerUploadRpcInput = SpaceAttachmentAccessInput & {
  bytes: ArrayBuffer;
  mimeType: string;
  name: string;
  nowMs?: number;
  uploadId: string;
};
export type PublishSpaceComposerUploadRpcInput = SpaceAttachmentAccessInput & {
  clientMutationId: string;
  nowMs?: number;
  uploadId: string;
};
export type DiscardSpaceComposerUploadRpcInput = SpaceAttachmentAccessInput & {
  uploadId: string;
};
export type CreateSpaceDiagnosticReportInput = CoreRpcSpaceAccessInput & {
  body: CreateSpaceDiagnosticReportBody;
};
export type CreateSpaceInput = {
  name?: string;
  purpose?: string;
  guide?: string;
  accessMode?: SpaceAccessMode;
  password?: string;
  visibility?: "public" | "private";
  context?: CoreRpcContextInput;
};
export type CreateSpaceResult = {
  spaceId: string;
  meta?: SpaceMeta;
};
export type ListSignalsInput = {
  messageRead?: import("@openmeld/schemas").MessageReadQuery;
  includePersonalHistoryBoundary?: boolean;
  q?: string;
  spaceId: string;
  afterTs?: number;
  cursor?: string;
  limit?: number;
  recent?: boolean;
  afterSignalId?: string;
  aroundSignalId?: string;
  beforeCount?: number;
  afterCount?: number;
  fromProfileIds?: readonly string[];
  signalTypes?: readonly (
    | "signal.text"
    | "signal.status"
    | "signal.system_notice"
  )[];
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type ListSignalsResult = {
  messagePage?: import("@openmeld/schemas").MessageReadPage;
  personalHistoryDeletedAt?: number;
  searchIndexing?: boolean;
  signals: SignalEnvelope[];
  nextCursor: string | null;
};
export type MutateSpaceMessageInput = {
  spaceId: string;
  signalId: string;
  body: import("@openmeld/schemas/types").SpaceMessageMutationBody;
  spaceAccess: SpaceAccessContext;
  context?: CoreRpcContextInput;
};
export async function rpcMutateSpaceMessage(
  env: CoreBindings,
  input: MutateSpaceMessageInput
) {
  requireWritableRpcSpaceAccessContext(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcMutateSpaceMessage(input);
}
export type PostSignalInput = {
  /** Internal Core→Space only. Public input cannot supply a time anchor. */
  requestTimeContext?: import("@openmeld/schemas").UserRequestTimeContext;
  /** Internal Core→Space only. Public input cannot supply a request chain. */
  requestChainBasis?: import("../request-chain/dispatch-request-chain").RequestChainBasis;
  contextSelection?: import("@openmeld/schemas/types").ExecutionContextSelection;
  contextSelections?: Record<
    string,
    import("@openmeld/schemas/types").ExecutionContextSelection
  >;
  taskDraft?: import("@openmeld/schemas/types").SignalText["data"]["taskDraft"];
  deviceWait?: SignalText["data"]["deviceWait"];
  agentStreamId?: string;
  spaceId: string;
  profile: Profile;
  text: string;
  authoringPolicy: SpaceSignalAuthoringPolicy;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  attachments?: SignalText["data"]["attachments"];
  files?: SignalText["data"]["files"];
  messageEnvelope?: SignalText["data"]["messageEnvelope"];
  meta?: SignalText["data"]["meta"];
  replyTo?: SignalText["data"]["replyTo"];
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  spaceAddressingVersion?: string;
  threadContext?: SpaceThreadContext;
};
export type PostSignalOnceByClientMessageIdInput = PostSignalInput & {
  clientMessageId: string;
  /** Internal Core→Space only. Public message metadata is never authority. */
  pluginContinuation?: PluginConnectionContinuationBinding;
};
// Transient signals must stay non-persistent; user Wake dispatch must use PostSignalInput with authoringPolicy.
export type PostTransientSignalInput = {
  spaceId: string;
  profile: Profile;
  text: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  messageEnvelope?: SignalText["data"]["messageEnvelope"];
  meta?: SignalText["data"]["meta"];
  replyTo?: SignalText["data"]["replyTo"];
};
export type PostStatusSignalInput = {
  spaceId: string;
  profile: Profile;
  data: SignalStatusData;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  threadContext?: SpaceThreadContext;
};
export type PostSystemNoticeSignalInput = {
  spaceId: string;
  profile: Profile;
  data: SignalSystemNoticeData;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  threadContext?: SpaceThreadContext;
  /** Internal Core→Space only; never accepted from a public HTTP body. */
  preHeadFailurePublication?: import("@openmeld/schemas/types").PreHeadFailurePublicationIdentity;
};
export type ExecutionRecoveryNoticeSignalData = SignalSystemNoticeData & {
  noticeType: "execution_recovery_available" | "execution_recovery_completed";
  resultRef: string;
};
export type PostExecutionRecoveryNoticeSignalInput = Omit<
  PostSystemNoticeSignalInput,
  "data" | "finalOutcomeAuthority"
> & {
  data: ExecutionRecoveryNoticeSignalData;
};
export type PostExecutionRecoveryNoticeSignalResponse = {
  publishedSignalId: string;
  status: "already_published" | "published";
};
export type InspectExecutionRecoveryInput = {
  spaceId: string;
  dispatchId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type ExecuteExecutionRecoveryInput = {
  spaceId: string;
  body: ExecuteExecutionRecoveryBody;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type StartUsageExhaustedContinuationInput = {
  continuationClientMessageId: string;
  /**
   * Set only when the continuation cannot reuse the interrupted conversation.
   * An occupied native conversation is the case: the re-post has to name the
   * branch explicitly, because `auto` would resolve back to the same context.
   */
  contextSelection?: import("@openmeld/schemas/types").ExecutionContextSelection;
  contextSelections?: Record<
    string,
    import("@openmeld/schemas/types").ExecutionContextSelection
  >;
  taskDraft?: import("@openmeld/schemas/types").SignalText["data"]["taskDraft"];
  interruptedClientMessageId: string;
  interruptedDispatchId: string;
  interruptedSourceSignalId: string;
  operationId: string;
  spaceAccess: SpaceAccessContext;
  spaceId: string;
  targetProfileId: string;
  context?: CoreRpcContextInput;
};
export type StartUsageExhaustedContinuationResponse = {
  continuationClientMessageId: string;
  operationId: string;
  status: "started";
};
export type GetSpaceMetaInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type UpdateSpaceMetaInput = {
  ownership?: import("@openmeld/schemas/types").PatchSpaceMetaBody["ownership"];
  allowGuests?: boolean;
  spaceId: string;
  visibility?: SpaceMeta["visibility"];
  name?: string;
  purpose?: string;
  guide?: string;
  password?: string;
  context?: CoreRpcContextInput;
};
export type GetSpaceContractInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceBoardInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceStatusInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceEntryResolutionRpcInput = GetSpaceEntryResolutionInput & {
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceConversationStateRpcInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
type ApplySpaceAgentStreamDeltaIdentity = {
  replyThreadRootSignalId?: string | null;
  v: 1;
  spaceId: string;
  streamId: string;
  sequence: number;
  profileId: string;
  triggerMessageId: string;
  dispatchId: string;
};
export type ApplySpaceAgentStreamDeltaInput =
  ApplySpaceAgentStreamDeltaIdentity &
    (
      | {
          kind?: "text";
          textSnapshot: string;
        }
      | {
          kind: "thinking";
          thinkingSnapshot: string;
          reasoningState?: import("@openmeld/schemas/types").LocalAgentReasoningState;
        }
      | {
          kind: "progress";
          progressSnapshot: string;
        }
    );
export type ApplySpaceAgentStreamPartInput = {
  v: 1;
  spaceId: string;
  streamId: string;
  sequence: number;
  profileId: string;
  triggerMessageId: string;
  dispatchId: string;
  part: AgentStreamPart;
};
export type CloseSpaceAgentStreamInput = {
  spaceId: string;
  streamId: string;
  terminal: SpaceAgentStreamTerminal;
};
export type GetSpaceBootstrapInput = ListSignalsInput & {
  includeAgentReadiness?: boolean;
  includeAgentStreamPresence?: boolean;
};
export type GetSpaceUpdatesInput = {
  spaceId: string;
  afterSignalId: string;
  limit?: number;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceDispatchResultInput = {
  spaceId: string;
  dispatchId?: string;
  resultRef?: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type PutSpaceContractInput = {
  spaceId: string;
  contract: PutSpaceContractBody;
  password?: string;
  context?: CoreRpcContextInput;
};
export type PatchSpaceContractInput = {
  spaceId: string;
  contractPatch: PatchSpaceContractBody;
  password?: string;
  context?: CoreRpcContextInput;
};
export type DeleteSpaceInput = {
  spaceId: string;
  approvedAgentCreatorProfileId?: string;
  password?: string;
  context?: CoreRpcContextInput;
};
export type DeleteSpaceResult = {
  spaceId: string;
  deleted: true;
};
export type ListAccountSpacesInput = {
  includeDeletedSpaces?: boolean;
  gatewayHost: string;
  ownerUserId: string;
  scope: AccountSpaceIndexQuery["scope"];
  selectedProfileId: string;
  limit?: number;
  includeDirectMessageProfileIds?: boolean;
  includeRecentlyDeletedItems?: boolean;
  includePurposes?: boolean;
  includeMemberPreviews?: boolean;
  includeMessagePreviews?: boolean;
  includeDirectoryPreviews?: boolean;
};
export type ListAccountSpaceActiveWakeSummaryInput =
  AccountSpaceActiveWakeSummaryRpcInput;
export type GetSpaceCursorInput = {
  spaceId: string;
  profileId: string;
  password?: string;
  context?: CoreRpcContextInput;
};
export type UpdateSpaceCursorInput = {
  spaceId: string;
  profileId: string;
  lastSeenTs?: number;
  role?: string;
  mentionAlias?: string;
  password?: string;
  context?: CoreRpcContextInput;
};
export type SpacePasswordStateResult = {
  spaceId: string;
  passwordProtected: boolean;
};
export type SpaceAccessModeStateResult = SpaceAccessModeState;
export type GetSpaceMembersInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceViewerMembershipInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type ListSpaceThreadsInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceThreadInput = {
  spaceId: string;
  threadId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type ListSpaceThreadEventsInput = {
  spaceId: string;
  threadId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type ListSpaceThreadSignalsInput = ListSpaceThreadSignalsQuery & {
  spaceId: string;
  threadId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceDispatchTraceInput = {
  includeServiceConnectionDiagnostics?: boolean;
  spaceId: string;
  dispatchId: string;
  includeRemoteAgentRuntimeDiagnostics?: boolean;
  responseContractVersion?: SpaceDispatchTraceResponseContractVersion;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceDispatchLookupInput = {
  spaceId: string;
  sourceSignalId?: string;
  clientMessageId?: string;
  targetProfileId?: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceWakeProgressInput = {
  includeDeviceWait?: boolean;
  spaceId: string;
  clientMessageId: string;
  includePreviewText?: boolean;
  includeTiming?: boolean;
  includeReplyPlacement?: boolean;
  includeSourceContext?: boolean;
  includeWaitReason?: boolean;
  includeWakeStopEligibility?: boolean;
  targetProfileId?: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetActiveSpaceWakeProgressInput = {
  includeDeviceWait?: boolean;
  spaceId: string;
  includePageInfo?: boolean;
  includePreviewText?: boolean;
  includeTiming?: boolean;
  includeReplyPlacement?: boolean;
  includeSourceContext?: boolean;
  includeWaitReason?: boolean;
  includeWakeStopEligibility?: boolean;
  sourceProfileId?: string;
  targetProfileId?: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type PostSpaceWakeStopInput = {
  spaceId: string;
  body: PostSpaceWakeStopBody;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type RespondToSpaceAgentInteractionInput = {
  spaceId: string;
  body: RespondToSpaceAgentInteractionBody;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceWakeTraceWaterfallInput = {
  spaceId: string;
  clientMessageId?: string | null;
  sourceSignalId?: string | null;
  targetProfileId?: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type GetSpaceMessageDetailsInput = {
  includeThreadContext?: true;
  delegationVersion?: 1;
  delegationCursor?: string;
  spaceId: string;
  signalId: string;
  executionContextVersion?: 1;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};
export type AddSpaceMembersInput = {
  spaceId: string;
  members: ResolvedSpaceMemberProfile[];
  requireActorMembership?: boolean;
  password?: string;
  context?: CoreRpcContextInput;
};
export type RemoveSpaceMembersInput = {
  spaceId: string;
  memberProfileIds: string[];
  password?: string;
  context?: CoreRpcContextInput;
};
export type LeaveSpaceInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
};
export type UpsertSpacePasswordInput = {
  spaceId: string;
  password: string;
  context?: CoreRpcContextInput;
};
export type ClearSpacePasswordInput = {
  spaceId: string;
  context?: CoreRpcContextInput;
};
export type SetSpaceAccessModeInput = {
  spaceId: string;
  accessMode: SpaceAccessMode;
  allowGuests?: boolean;
  linkJoinPolicy?: SpaceLinkJoinPolicy;
  password?: string;
  visibility?: "public" | "private";
  context?: CoreRpcContextInput;
};
export type GetCurrentDeviceTargetInput = {
  context?: CoreRpcContextInput;
};
export type ForgetComputerInput = {
  deviceId: string;
  context?: CoreRpcContextInput;
};
export type GetLocalRuntimesInput = {
  connectionIdentityAdoption?: LocalRuntimesQuery["connectionIdentityAdoption"];
  context?: CoreRpcContextInput;
  includeUsageLimits?: LocalRuntimesQuery["includeUsageLimits"];
};
export type GetCurrentLocalRuntimeReplyReadinessInput = {
  context?: CoreRpcContextInput;
};
export type GetPeopleComputerReplyReadinessInput = PeopleComputerTarget & {
  context?: CoreRpcContextInput;
};
export function rpcListPeopleComputers(
  env: CoreBindings,
  input: GetLocalRuntimesInput
): Promise<PeopleComputersResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  return listPeopleComputersForOwnerUser({
    env,
    userId,
    includeUsageLimits: input.includeUsageLimits === "true",
  });
}
const serviceConnectionEvidenceRpc = createServiceConnectionEvidenceRpc({
  requireOwnerUserId: requireAuthenticatedOwnerUserId,
  requireOwnedDevice: async (env, userId, deviceId) => {
    const inventory = await listLocalRuntimesForOwnerUser({ env, userId });
    if (
      !inventory.localRuntimes.some((computer) =>
        peopleComputerContainsDevice(computer, deviceId)
      )
    ) {
      throw createCoreRpcHttpError({
        status: 404,
        code: "computer.not_found",
        reason: "This computer is not available on your account.",
      });
    }
  },
  requireUploader: async (env, userId, input) => {
    const target = { deviceId: input.deviceId, runtimeLane: input.runtimeLane };
    const { localRuntimes, ownerService } =
      await resolveCurrentLocalServiceContext({ env, userId, target });
    const session = requirePeopleComputerControlSession({
      target,
      inventory: localRuntimes,
      ownerService,
    });
    if (session.daemonSessionId !== input.report.uploaderServiceSessionId) {
      throw createCoreRpcHttpError({
        status: 409,
        code: "computer.connection_incident.uploader_changed",
        reason:
          "The Service connection changed. Try again after it reconnects.",
      });
    }
  },
});
export function rpcReadServiceConnectionIncidents(
  env: CoreBindings,
  input: ServiceConnectionIncidentsReadRpcInput
) {
  return serviceConnectionEvidenceRpc.read(env, input);
}
export function rpcReportServiceConnectionIncident(
  env: CoreBindings,
  input: ServiceConnectionIncidentReportRpcInput
) {
  return serviceConnectionEvidenceRpc.report(env, input);
}
async function listPeopleComputersForOwnerUser(input: {
  env: CoreBindings;
  userId: string;
  includeUsageLimits?: boolean;
}): Promise<PeopleComputersResponse> {
  const { env, userId } = input;
  const ownerService = await lookupRuntimeTransportOwnerService({
    env,
    ownerUserId: userId,
    blockForgottenDevices: true,
  }).catch((error: unknown) => {
    console.warn("[core.people_computers.connection_lookup_failed]", {
      userId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  });
  const inventory = await listLocalRuntimesUseCase({
    store: buildCurrentDeviceTargetStore(env),
    userId,
    ...(ownerService ? { lookupOwnerService: async () => ownerService } : {}),
  });
  const localComponentsRelease = await readCoreLocalComponentsRelease(
    env.OPENMELD_CLI_RELEASES
  );
  return peopleComputersResponseSchema.parse(
    projectPeopleComputers({
      generatedAt: new Date().toISOString(),
      localComponentsRelease,
      inventory: input.includeUsageLimits
        ? inventory
        : omitLocalRuntimeUsageLimits(inventory),
      ownerService,
    })
  );
}
export function rpcGetPeopleComputerReplyReadiness(
  env: CoreBindings,
  input: GetPeopleComputerReplyReadinessInput
): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
  const target = peopleComputerTargetSchema.safeParse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (!target.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  return getCurrentLocalRuntimeReplyReadinessForOwnerUser({
    env,
    userId: requireAuthenticatedOwnerUserId(input.context),
    target: target.data,
  });
}
// Explicit RPC names prevent an older receiver from ignoring the selected target.
export function rpcSetPeopleComputerLocalAgentEnabled(
  env: CoreBindings,
  input: SetCurrentLocalAgentEnabledInput & PeopleComputerTarget
) {
  const parsed = peopleComputerTargetSchema.safeParse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  return rpcSetCurrentLocalAgentEnabled(env, input, parsed.data);
}
export function rpcGetPeopleComputerLocalAgentInstallations(
  env: CoreBindings,
  input: GetCurrentLocalAgentInstallationsInput & PeopleComputerTarget
) {
  const parsed = peopleComputerTargetSchema.safeParse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  return rpcGetCurrentLocalAgentInstallations(env, input, parsed.data);
}
export async function rpcManagePeopleComputerLocalAgentUpdate(
  env: CoreBindings,
  input: GetCurrentLocalAgentInstallationsInput &
    PeopleComputerTarget & {
      request?: import("@openmeld/schemas/types").LocalAgentUpdateRequest;
    }
): Promise<import("@openmeld/schemas/types").LocalAgentUpdateState> {
  const target = peopleComputerTargetSchema.parse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  const { agentId } = currentLocalAgentInstallationsRouteParamsSchema.parse({
    agentId: input.agentId,
  });
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const { currentTarget } = await resolveCurrentLocalAgentControlTarget({
    capability: "updateInstallations",
    env,
    target,
    userId,
    unsupportedCode: "local_agent_control.unsupported",
    unsupportedReason:
      "Update OpenMeld Service to update local agents from OpenMeld.",
  });
  const request = input.request
    ? localAgentUpdateRequestSchema.parse(input.request)
    : null;
  const result = await manageRuntimeTransportLocalAgentInstallation({
    env,
    ownerUserId: userId,
    deviceId: currentTarget.deviceId,
    runtimeLane: currentTarget.runtimeLane,
    request: request
      ? { ...request, agentId, operation: "update" }
      : { agentId, operation: "read_update" },
  });
  return localAgentUpdateStateSchema.parse(
    requireAcceptedLocalAgentUpdatePayload(result)
  );
}
export async function rpcManagePeopleComputerLocalAgentSetup(
  env: CoreBindings,
  input: GetCurrentLocalAgentInstallationsInput &
    PeopleComputerTarget & {
      request?: import("@openmeld/schemas/types").LocalAgentSetupRequest;
    }
): Promise<import("@openmeld/schemas/types").LocalAgentSetupState> {
  const target = peopleComputerTargetSchema.parse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (input.agentId !== "grok-bot") {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "This Agent does not support connection setup.",
    });
  }
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const { currentTarget } = await resolveCurrentLocalAgentControlTarget({
    capability: "setupInstallations",
    env,
    target,
    userId,
    unsupportedCode: "local_agent_control.unsupported",
    unsupportedReason: "Update OpenMeld Service to install connection tools.",
  });
  const request = input.request
    ? localAgentSetupRequestSchema.parse(input.request)
    : null;
  const result = await manageRuntimeTransportLocalAgentInstallation({
    env,
    ownerUserId: userId,
    deviceId: currentTarget.deviceId,
    runtimeLane: currentTarget.runtimeLane,
    request: request
      ? { ...request, agentId: "grok-bot", operation: "setup" }
      : { agentId: "grok-bot", operation: "read_setup" },
  });
  const payload = requireAcceptedInstallationControlPayload(result);
  if (payload.status !== "setup_state") {
    throw createCoreRpcHttpError({
      status: 502,
      code: "local_agent_control.invalid_response",
      reason: "Unexpected connection setup response.",
    });
  }
  return localAgentSetupStateSchema.parse(payload.setup);
}
export function rpcSelectPeopleComputerLocalAgentInstallation(
  env: CoreBindings,
  input: SelectCurrentLocalAgentInstallationInput & PeopleComputerTarget
) {
  const parsed = peopleComputerTargetSchema.safeParse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  return rpcSelectCurrentLocalAgentInstallation(env, input, parsed.data);
}
export function rpcRefreshPeopleComputerLocalAgentCatalog(
  env: CoreBindings,
  input: RefreshCurrentLocalAgentCatalogInput & PeopleComputerTarget
) {
  const parsed = peopleComputerTargetSchema.safeParse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  return rpcRefreshCurrentLocalAgentCatalog(env, input, parsed.data);
}
export function rpcRequestPeopleComputerOpenMeldToolsUpdate(
  env: CoreBindings,
  input: RequestCurrentOpenMeldToolsUpdateInput & PeopleComputerTarget
) {
  const parsed = peopleComputerTargetSchema.safeParse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  return rpcRequestCurrentOpenMeldToolsUpdate(env, input, parsed.data);
}
export function rpcSetPeopleComputerOpenMeldToolsMaintenance(
  env: CoreBindings,
  input: SetCurrentOpenMeldToolsMaintenanceInput & PeopleComputerTarget
) {
  const parsed = peopleComputerTargetSchema.safeParse({
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  return rpcSetCurrentOpenMeldToolsMaintenance(env, input, parsed.data);
}
export type SetLocalRuntimeDisplayNameInput = SetLocalRuntimeDisplayNameBody & {
  deviceId: string;
  context?: CoreRpcContextInput;
};
export type SetCurrentLocalAgentEnabledInput =
  SetCurrentLocalAgentEnabledBody & {
    agentId: string;
    context?: CoreRpcContextInput;
  };
export type GetCurrentLocalAgentInstallationsInput = {
  agentId: string;
  context?: CoreRpcContextInput;
};
export type SelectCurrentLocalAgentInstallationInput =
  SelectCurrentLocalAgentInstallationBody & {
    agentId: string;
    context?: CoreRpcContextInput;
  };
export type RequestCurrentOpenMeldToolsUpdateInput = {
  context?: CoreRpcContextInput;
};
export type SetCurrentOpenMeldToolsMaintenanceInput =
  SetCurrentOpenMeldToolsMaintenanceBody & {
    context?: CoreRpcContextInput;
  };
export type SetCurrentAgentProfileWorkspaceInput =
  SetCurrentAgentProfileWorkspaceBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type GetCurrentAgentProfileWorkspaceInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
  expectedBindingTarget?: import("@openmeld/schemas/types").AgentProfileBindingTarget;
};
export type RefreshCurrentLocalAgentCatalogInput = {
  context?: CoreRpcContextInput;
};
export type EnrollLocalRuntimeInput = {
  deviceId: string;
  connectedComputerId?: string;
  runtimeLane: LocalRuntimeEnrollmentBody["runtimeLane"];
  context?: CoreRpcContextInput;
};
export type GetPrepareReadinessInput = GetPrepareReadinessQuery & {
  deviceId: string;
  context?: CoreRpcContextInput;
};
export type GetLocalRuntimeExpectedRoutesInput = {
  contractVersion?: import("@openmeld/schemas/types").GetLocalRuntimeExpectedRoutesQuery["contractVersion"];
  deviceId: string;
  lane: string;
  context?: CoreRpcContextInput;
};
export type SubmitRuntimeRegistrationInput = {
  deviceId: string;
  lane: string;
  context?: CoreRpcContextInput;
};
export type SubmitRuntimeAgentControllerReportsInput = {
  deviceId: string;
  lane: string;
  reports: import("@openmeld/schemas/types").SubmitRuntimeAgentControllerReportsBody["reports"];
  openMeldServiceRuntimeId: import("@openmeld/schemas/types").RuntimeReportingRuntimeId;
  context?: CoreRpcContextInput;
};
export type SubmitRuntimeProviderConversationProofsInput = {
  deviceId: string;
  lane: string;
  proofs: import("@openmeld/schemas/types").SubmitRuntimeProviderConversationProofsBody["proofs"];
  openMeldServiceRuntimeId: import("@openmeld/schemas/types").RuntimeReportingRuntimeId;
  context?: CoreRpcContextInput;
};
export type GetAgentProfilePrimaryBindingInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};
export type GetCurrentAgentProfileSessionInput = {
  agentControllerConversationId: string;
  agentControllerRef: string;
  context?: CoreRpcContextInput;
};
export type ExecuteAgentProfileWorkRecoveryInput = {
  agentProfileId: string;
  body: ExecuteAgentProfileWorkRecoveryBody;
  context?: CoreRpcContextInput;
};
export type AgentProfileExecutionModeInput = {
  agentProfileId: string;
  body?: {
    mode: "parallel" | "serial";
  };
  context?: CoreRpcContextInput;
};
export type GetAgentProfileControllerChangeEligibilityInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};
export type DisableAgentProfilePrimaryBindingInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};
export type GetAgentProfileCreationDefaultsInput = {
  agentControllerRef: string;
  context?: CoreRpcContextInput;
  organizationId: string;
};
export type CenterAgentListAgentProfileCreationDefaultsInput =
  CenterAgentListAgentProfileCreationDefaultsBody & {
    context?: CoreRpcContextInput;
  };
export type SetAgentProfileCreationDefaultsInput =
  SetAgentProfileCreationDefaultsBody & {
    agentControllerRef: string;
    context?: CoreRpcContextInput;
    organizationId: string;
  };
export type GetCurrentOrganizationDirectoryInput = {
  agentProfileWorkRecoveryVersion?: 2;
  centerAgentOnly?: boolean;
  context?: CoreRpcContextInput;
  includeMemberLastActiveAt?: boolean;
};
export type GetCurrentOrganizationProfileDirectoryInput =
  OrganizationProfileDirectoryReadOptions & {
    context?: CoreRpcContextInput;
  };
export type GetCurrentOrganizationAgentRuntimeOverviewInput = {
  workloadProfileId?: string;
  includeUsageLimits?: boolean;
  agentProfileWorkRecoveryVersion?: 2;
  includeTaskActivity?: boolean;
  context?: CoreRpcContextInput;
};
export type RecordCurrentOrganizationWebActivityInput = {
  context?: CoreRpcContextInput;
  spaceId?: string;
};
export type RecordCurrentOrganizationMemberPresenceInput = {
  context?: CoreRpcContextInput;
  report: import("@openmeld/schemas/types").OrganizationMemberPresenceBody;
};
export type GetCurrentOrganizationComputersInput = {
  context?: CoreRpcContextInput;
  includeUsageLimits?: "true";
};
export type GetCurrentOrganizationMemberOpenMeldServiceStatusesInput = {
  context?: CoreRpcContextInput;
};
export type GetCurrentOrganizationSpaceDirectoryInput = z.infer<
  typeof getCurrentOrganizationSpaceDirectoryRpcInputSchema
>;
export type JoinOrganizationPublicSpaceInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
};
export type AddCenterAgentToSpaceInput = {
  expectedCenterAgentProfileId: string;
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
};
export type AddOrganizationDirectoryProfilesToSpaceInput =
  AddOrganizationDirectoryProfilesToSpaceBody & {
    spaceId: string;
    password?: string;
    context?: CoreRpcContextInput;
  };
export type BeginCurrentMemberConnectorAuthorizationInput = {
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
  service: ConnectorService;
};
export type BeginCurrentOrganizationSharedConnectorAuthorizationInput =
  BeginCurrentMemberConnectorAuthorizationInput;
export type BeginCurrentOrganizationGitHubAppInstallationInput = {
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
};
export type BeginGitHubAppInstallationVerificationInput = {
  installationId: string;
  state: string;
};
export type ReadPendingGitHubAppInstallationInput = {
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
};
export type BeginExistingGitHubAppInstallationVerificationInput =
  ReadPendingGitHubAppInstallationInput & {
    installationId: string;
    verificationConnectionName: ConnectorConnectionName;
  };
export type CompleteGitHubAppInstallationInput =
  ReadPendingGitHubAppInstallationInput & {
    installationId: string;
    targetConnectionName: ConnectorConnectionName;
    verificationConnectionName: ConnectorConnectionName;
  };
export type ListCurrentOrganizationConnectorConnectionsInput = {
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
  service?: ConnectorService;
};
export type ListCurrentOrganizationConnectorAppRequestsInput = {
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
};
export type CreateCurrentOrganizationConnectorAppRequestInput =
  CreateConnectorAppRequestBody & {
    context?: CoreRpcContextInput;
    expectedOrganizationId: string;
  };
export type ReconcileCurrentOrganizationConnectorConnectionsInput = {
  availableConnectionNames: ConnectorConnectionName[];
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
  service: ConnectorService;
};
export type AuthorizeConnectorDisconnectInput = {
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
  scope?: "member" | "shared";
  service: ConnectorService;
  userId?: string;
};
export type CompleteConnectorDisconnectInput =
  AuthorizeConnectorDisconnectInput & {
    connectionName: ConnectorConnectionName;
  };
export type CenterAgentResolveConnectorConnectionInput =
  import("@openmeld/schemas/types").CenterAgentResolveConnectorConnectionBody & {
    context?: CoreRpcContextInput;
  };
export type GetCenterAgentDesignationInput = {
  context?: CoreRpcContextInput;
};
export type GetCenterAgentModelInput = {
  context?: CoreRpcContextInput;
};
export type UpdateCenterAgentModelInput = UpdateCenterAgentModelBody & {
  context?: CoreRpcContextInput;
};
export type ListMessageChannelConnectionsInput = {
  context?: CoreRpcContextInput;
};
export type RequestMessageChannelSetupInput = MessageChannelSetupRequestBody & {
  context?: CoreRpcContextInput;
};
export type ListActiveLarkPlatformRegistrationsInput =
  ListMessageChannelConnectionsInput;
export type PreviewMessageChannelIdentityLinkInput =
  MessageChannelIdentityLinkPreviewBody & {
    context?: CoreRpcContextInput;
  };
export type ConsumeMessageChannelIdentityLinkInput =
  MessageChannelIdentityLinkConsumeBody & {
    context?: CoreRpcContextInput;
  };
export type BeginLarkPlatformRegistrationInput = {
  context?: CoreRpcContextInput;
  mode?: LarkPlatformRegistrationBeginMode;
  provider: LarkPlatformProvider;
};
export type PollLarkPlatformRegistrationInput =
  BeginLarkPlatformRegistrationInput & {
    attemptId: string;
  };
export type DisconnectLarkPlatformRegistrationInput =
  BeginLarkPlatformRegistrationInput;
export type DisconnectMessageChannelIdentityLinkInput = {
  context?: CoreRpcContextInput;
  identityLinkId: string;
};
export type ListAgentDirectMessageSessionsInput =
  ListAgentDirectMessageSessionsQuery & {
    context?: CoreRpcContextInput;
  };
export type UpdateAgentDirectMessageSessionInput = {
  context?: CoreRpcContextInput;
  spaceId: string;
  update: UpdateAgentDirectMessageSessionBody;
};
export type DeleteAgentDirectMessageSessionInput = {
  context?: CoreRpcContextInput;
  spaceId: string;
};
export type ListCenterAgentSessionsInput = ListCenterAgentSessionsQuery & {
  context?: CoreRpcContextInput;
};
export type GetCenterAgentDirectMessageSpaceProjectionInput = {
  context?: CoreRpcContextInput;
  spaceId?: string;
};
export type CreateCenterAgentContextManifestInput =
  CreateCenterAgentContextManifestBody & {
    context?: CoreRpcContextInput;
  };
export type CreateCenterAgentContextLoadReceiptInput =
  CreateCenterAgentContextLoadReceiptBody & {
    context?: CoreRpcContextInput;
    manifestId: string;
  };
export type DesignateCenterAgentInput = DesignateCenterAgentBody & {
  context?: CoreRpcContextInput;
};
export type UpdateCenterAgentProfileInput = CenterAgentUpdateProfileBody & {
  context?: CoreRpcContextInput;
};
export type GetCenterAgentOperatingStateInput = {
  context?: CoreRpcContextInput;
};
export type UpdateCenterAgentOperatingStateInput =
  UpdateCenterAgentOperatingStateBody & {
    context?: CoreRpcContextInput;
  };
export type ConnectCenterAgentSlackWorkspaceInput =
  CenterAgentSlackWorkspaceConnectBody & {
    context?: CoreRpcContextInput;
  };
export type DisconnectCenterAgentSlackWorkspaceInput = {
  context?: CoreRpcContextInput;
};
export type CreateSlackOAuthStateInput = {
  context?: CoreRpcContextInput;
  moveFromOrganizationId?: string | null;
  purpose?: "member_identity" | "organization_install";
};
export type ConsumeSlackOAuthStateInput = {
  state: string;
};
export type InstallSlackWorkspaceFromOAuthInput = SlackOAuthInstallationInput;
export type IssueSlackIdentityLinkFromOAuthInput = SlackOAuthIdentityLinkInput;
export type PreviewSlackIdentityLinkInput = SlackIdentityLinkPreviewBody & {
  context?: CoreRpcContextInput;
};
export type ConsumeSlackIdentityLinkInput = SlackIdentityLinkConsumeBody & {
  context?: CoreRpcContextInput;
};
export type AssertCurrentDesignatedCenterAgentInput = {
  context?: CoreRpcContextInput;
};
export type RecordCenterAgentAuditInput = {
  action: CenterAgentAction;
  context?: CoreRpcContextInput;
  onBehalfOf?: {
    profileId: string;
  } | null;
  resource?: {
    id: string;
    type: string;
  } | null;
};
export type ListCenterAgentAuditJournalInput =
  ListCenterAgentAuditJournalQuery & {
    context?: CoreRpcContextInput;
  };
export type ReadCenterAgentOrganizationMemoryPolicyInput = {
  context?: CoreRpcContextInput;
  includeAvailability?: boolean;
};
export type SetCenterAgentOrganizationMemoryPolicyInput =
  UpdateCenterAgentOrganizationMemoryPolicyBody & {
    context?: CoreRpcContextInput;
  };
export type ReadOrganizationInformationProtectionPolicyInput = {
  context?: CoreRpcContextInput;
};
export type SetOrganizationInformationProtectionPolicyInput =
  UpdateOrganizationInformationProtectionPolicyBody & {
    context?: CoreRpcContextInput;
  };
export type ReadCurrentOrganizationFeedbackReportingPolicyInput = {
  context?: CoreRpcContextInput;
};
export type SetCurrentOrganizationFeedbackReportingPolicyInput =
  UpdateFeedbackReportingPolicyBody & {
    context?: CoreRpcContextInput;
  };
export type WipeCurrentMemberCenterAgentMemoryInput = {
  context?: CoreRpcContextInput;
};
export type CenterAgentRememberForOrganizationInput =
  CenterAgentRememberForOrganizationBody & {
    context?: CoreRpcContextInput;
    includeStatus?: boolean;
    speakerMember?: {
      memberId: string;
      userId: string;
    };
  };
export type CenterAgentCreateSpaceInput = CenterAgentCreateSpaceBody & {
  context?: CoreRpcContextInput;
};
export type CenterAgentCreateAgentProfileInput =
  CenterAgentCreateAgentProfileBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentListLocalAgentConnectionCandidatesInput =
  CenterAgentListLocalAgentConnectionCandidatesBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentListComputersInput = CenterAgentListComputersBody & {
  context?: CoreRpcContextInput;
};
export type CenterAgentReadPeopleComputersInput =
  CenterAgentReadPeopleComputersBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentRequestOpenMeldToolsUpdateInput =
  CenterAgentRequestOpenMeldToolsUpdateBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentSetOpenMeldToolsMaintenanceInput =
  CenterAgentSetOpenMeldToolsMaintenanceBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentListLocalAgentInstallationsInput =
  CenterAgentListLocalAgentInstallationsBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentSelectLocalAgentInstallationInput =
  CenterAgentSelectLocalAgentInstallationBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentConnectAgentProfileToLocalAgentInput =
  CenterAgentConnectAgentProfileToLocalAgentBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentUpdateAgentProfileRuntimeSettingsInput =
  CenterAgentUpdateAgentProfileRuntimeSettingsBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentCheckAgentProfileReadinessInput =
  CenterAgentCheckAgentProfileReadinessBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentCreateConfiguredAgentProfileInput =
  CenterAgentCreateConfiguredAgentProfileBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentEnableAgentProfileInput =
  CenterAgentEnableAgentProfileBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type CenterAgentAddAgentProfilesToSpaceInput =
  CenterAgentAddAgentProfilesToSpaceBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentAddMembersToSpaceInput =
  CenterAgentAddMembersToSpaceBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentRemoveAgentProfilesFromSpaceInput =
  CenterAgentRemoveAgentProfilesFromSpaceBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadSpaceContextInput =
  CenterAgentReadSpaceContextBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadDispatchHistoryInput =
  CenterAgentReadDispatchHistoryBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentPostSpaceMessageInput =
  CenterAgentPostSpaceMessageBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadSpaceAuthoringContractInput = {
  context?: CoreRpcContextInput;
  requestedAddressingModel?: "wake_reference_mention";
};
export type CenterAgentPostSlackChannelMessageInput =
  CenterAgentPostSlackChannelMessageBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentPostSlackThreadMessageInput =
  CenterAgentPostSlackThreadMessageBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentPostSlackFileInput = CenterAgentPostSlackFileBody & {
  context?: CoreRpcContextInput;
};
export type CenterAgentListSlackChannelsInput =
  CenterAgentListSlackChannelsBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadSlackChannelMembersInput =
  CenterAgentReadSlackChannelMembersBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadSlackChannelHistoryInput =
  CenterAgentReadSlackChannelHistoryBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadSlackFileInput = CenterAgentReadSlackFileBody & {
  context?: CoreRpcContextInput;
};
export type CenterAgentReadSlackWorkspaceDirectoryInput =
  CenterAgentReadSlackWorkspaceDirectoryBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentSearchSlackMessagesInput =
  CenterAgentSearchSlackMessagesBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentRecordConnectorActionAuditInput =
  CenterAgentRecordConnectorActionAuditBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadConnectorActionOperationInput =
  CenterAgentReadConnectorActionOperationBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentRecordConnectorActionOperationInput =
  CenterAgentRecordConnectorActionOperationBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentWakeAgentProfilesInSpaceInput =
  CenterAgentWakeAgentProfilesInSpaceBody & {
    context?: CoreRpcContextInput;
  };

export type CenterAgentWakeAgentProfilesInSpacesInput =
  CenterAgentWakeAgentProfilesInSpacesBody & {
    context?: CoreRpcContextInput;
  };

export type CenterAgentWatchAgentTaskInput = CenterAgentWatchAgentTaskBody & {
  context?: CoreRpcContextInput;
};
export type CenterAgentListAgentTasksInput = CenterAgentListAgentTasksBody & {
  context?: CoreRpcContextInput;
};
export type CenterAgentUpdateSpaceSettingsInput =
  CenterAgentUpdateSpaceSettingsBody & {
    context?: CoreRpcContextInput;
  };
export type CenterAgentReadOrganizationDirectoryInput = {
  context?: CoreRpcContextInput;
  includeMemberLastActiveAt?: boolean;
  speakerMember?: CenterAgentToolSpeaker;
};
export type CenterAgentReadMemberOpenMeldServiceStatusInput =
  CenterAgentReadMemberOpenMeldServiceStatusBody & {
    context?: CoreRpcContextInput;
    speakerMember?: CenterAgentToolSpeaker;
  };
export type CenterAgentReadMemberComputersInput =
  CenterAgentReadMemberComputersBody & {
    context?: CoreRpcContextInput;
    speakerMember?: CenterAgentToolSpeaker;
  };
export type CenterAgentReadOrganizationSpaceDirectoryInput = {
  context?: CoreRpcContextInput;
  speakerMember?: CenterAgentToolSpeaker;
};
export type CenterAgentListActiveSpaceWakesInput =
  CenterAgentReadOrganizationSpaceDirectoryInput;
export type CenterAgentReadSpaceWakeProgressInput =
  CenterAgentReadOrganizationSpaceDirectoryInput & {
    sourceProfileId?: string;
    spaceId: string;
    targetProfileId?: string;
  };
export type CenterAgentStopSpaceWakeInput =
  CenterAgentReadOrganizationSpaceDirectoryInput & {
    body: PostSpaceWakeStopBody;
    spaceId: string;
  };

export type CenterAgentSpaceInputQueueInput =
  CenterAgentReadOrganizationSpaceDirectoryInput & {
    spaceId: string;
    mutation?: SpaceInputQueueMutation;
  };

export type OpenCenterAgentDirectMessageSpaceInput = {
  context?: CoreRpcContextInput;
  sessionCreationId?: string;
};
export type OpenDirectMessageSpaceInput = OpenDirectMessageSpaceBody & {
  context?: CoreRpcContextInput;
};
export type ConvertDirectMessageToSpaceInput =
  ConvertDirectMessageToSpaceBody & {
    context?: CoreRpcContextInput;
    spaceId: string;
  };
export type GetAgentExecutionReadinessInput =
  AgentExecutionReadinessResponseOptions & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type GetAgentExecutionReadinessBatchInput =
  GetAgentExecutionReadinessBatchBody &
    AgentExecutionReadinessResponseOptions & {
      context?: CoreRpcContextInput;
    };
type GetAgentExecutionReadinessResponseDraft = Omit<
  GetAgentExecutionReadinessResponse,
  "agentExecutionReadiness" | "routeLane"
> & {
  agentExecutionReadiness: CoreAgentExecutionReadiness["agentExecutionReadiness"];
  routeLane: CoreAgentExecutionReadiness["routeLane"];
};
export type EnsureAgentProfilePrimaryBindingInput =
  EnsureAgentProfilePrimaryBindingBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type UpdateAgentProfilePrimaryBindingModelSelectionInput =
  UpdateAgentProfilePrimaryBindingModelSelectionBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput =
  UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput =
  UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type UpdateAgentProfilePrimaryBindingOpenCodePermissionInput =
  UpdateAgentProfilePrimaryBindingOpenCodePermissionBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type NotifyAgentProfileRouteCatalogChangedInput =
  NotifyAgentProfileRouteCatalogChangedBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };
export type NotifyAgentProfilesRouteCatalogChangedInput =
  NotifyAgentProfilesRouteCatalogChangedBody & {
    context?: CoreRpcContextInput;
  };
export type WriteCurrentDeviceObservedMetadataInput = {
  deviceId: string;
  metadata: ObservedDeviceMetadata;
  context?: CoreRpcContextInput;
};
export async function rpcGetCurrentDeviceTarget(
  env: CoreBindings,
  input: GetCurrentDeviceTargetInput
): Promise<CurrentDeviceTargetResponse> {
  const response = await getCurrentDeviceTargetUseCase({
    store: buildCurrentDeviceTargetStore(env),
    userId: requireAuthenticatedOwnerUserId(input.context),
  });
  const validated = currentDeviceTargetResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build current device target response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcListLocalRuntimes(
  env: CoreBindings,
  input: GetLocalRuntimesInput
): Promise<LocalRuntimesResponse> {
  const response = await listLocalRuntimesForOwnerUser({
    ...(input.connectionIdentityAdoption === undefined
      ? {}
      : { connectionIdentityAdoption: input.connectionIdentityAdoption }),
    env,
    userId: requireAuthenticatedOwnerUserId(input.context),
  });
  return input.includeUsageLimits === "true"
    ? response
    : omitLocalRuntimeUsageLimits(response);
}
function omitLocalRuntimeUsageLimits(
  response: LocalRuntimesResponse
): LocalRuntimesResponse {
  const omitFromComputer = <
    T extends
      | LocalRuntimesResponse["localRuntimes"][number]
      | NonNullable<LocalRuntimesResponse["legacyDeviceEvidence"]>[number],
  >(
    computer: T
  ): T => ({
    ...computer,
    executionTargets: computer.executionTargets.map((target) => ({
      ...target,
      capabilities: target.capabilities.map((capability) => {
        if (!capability.agentControllerInterface) {
          return capability;
        }
        const {
          usageLimits: _usageLimits,
          usageAdmission: _usageAdmission,
          ...agentControllerInterface
        } = capability.agentControllerInterface;
        return { ...capability, agentControllerInterface };
      }),
    })),
  });
  return {
    ...response,
    localRuntimes: response.localRuntimes.map(omitFromComputer),
    ...(response.legacyDeviceEvidence
      ? {
          legacyDeviceEvidence:
            response.legacyDeviceEvidence.map(omitFromComputer),
        }
      : {}),
  };
}
async function listLocalRuntimesForOwnerUser(input: {
  connectionIdentityAdoption?: GetLocalRuntimesInput["connectionIdentityAdoption"];
  env: CoreBindings;
  userId: string;
}): Promise<LocalRuntimesResponse> {
  const response = await listLocalRuntimesUseCase({
    ...(input.connectionIdentityAdoption === undefined
      ? {}
      : { connectionIdentityAdoption: input.connectionIdentityAdoption }),
    lookupOwnerService: async ({ ownerUserId }) =>
      await lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env: input.env,
        ownerUserId,
      }),
    store: buildCurrentDeviceTargetStore(input.env),
    userId: input.userId,
  });
  const validated = localRuntimesResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build local runtimes response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcGetCurrentLocalRuntimeReplyReadiness(
  env: CoreBindings,
  input: GetCurrentLocalRuntimeReplyReadinessInput
): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  return await getCurrentLocalRuntimeReplyReadinessForOwnerUser({
    env,
    userId,
  });
}
async function getCurrentLocalRuntimeReplyReadinessForOwnerUser(input: {
  env: CoreBindings;
  userId: string;
  target?: PeopleComputerTarget;
}): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
  const response = await getCurrentLocalRuntimeReplyReadinessUseCase({
    localComponentsRelease: await readCoreLocalComponentsRelease(
      input.env.OPENMELD_CLI_RELEASES
    ),
    ...(input.target ? { target: input.target } : {}),
    lookupOwnerService: async ({ ownerUserId }) =>
      await lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env: input.env,
        ownerUserId,
      }),
    store: buildCurrentDeviceTargetStore(input.env),
    userId: input.userId,
  });
  const validated =
    currentLocalRuntimeReplyReadinessResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build current local runtime reply readiness response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function readOwnerComputerCareObservation(input: {
  env: CoreBindings;
  target: PeopleComputerTarget;
  userId: string;
}) {
  const observedAtMs = Date.now();
  try {
    const ownerService = await lookupRuntimeTransportOwnerService({
      blockForgottenDevices: true,
      env: input.env,
      ownerUserId: input.userId,
    });
    const session = ownerService.online
      ? selectCurrentOwnerServiceSessionsByDeviceLane(ownerService).find(
          (entry) =>
            entry.deviceId === input.target.deviceId &&
            entry.lane === input.target.runtimeLane
        )
      : undefined;
    return {
      observedAtMs,
      connection: session ? ("connected" as const) : ("unavailable" as const),
      supervisor: session ? ("responding" as const) : ("unknown" as const),
      lastHeartbeatAtMs: session?.lastHeartbeatMs ?? null,
      executionHost: session?.capabilities.executionHost ?? null,
    };
  } catch {
    // A failed read is unknown, not proof that the Computer is offline.
    return {
      observedAtMs,
      connection: "unknown" as const,
      supervisor: "unknown" as const,
      lastHeartbeatAtMs: null,
      executionHost: null,
    };
  }
}
async function buildOwnerComputerDiagnostics(input: {
  env: CoreBindings;
  includeUsageLimits: boolean;
  localRuntimes: LocalRuntimesResponse;
  target?: PeopleComputerTarget;
  userId: string;
}): Promise<OwnerComputerDiagnostics> {
  const [currentLocalRuntimeReplyReadiness, currentComputerFileAccess] =
    await Promise.all([
      getCurrentLocalRuntimeReplyReadinessForOwnerUser({
        env: input.env,
        target: input.target,
        userId: input.userId,
      }),
      readOwnerCurrentComputerFileAccessSummary(input),
    ]);
  return ownerComputerDiagnosticsSchema.parse({
    currentComputerFileAccess,
    currentLocalRuntimeReplyReadiness,
    localRuntimes: projectOwnerComputerLocalRuntimes(
      input.includeUsageLimits
        ? input.localRuntimes
        : omitLocalRuntimeUsageLimits(input.localRuntimes)
    ),
  });
}
async function readOwnerCurrentComputerFileAccessSummary(input: {
  env: CoreBindings;
  localRuntimes: LocalRuntimesResponse;
  target?: PeopleComputerTarget;
  userId: string;
}): Promise<OwnerComputerDiagnostics["currentComputerFileAccess"]> {
  const currentComputer = input.localRuntimes.localRuntimes.find(
    (computer) =>
      computer.isCurrent ||
      computer.deviceId === input.localRuntimes.currentDeviceId
  );
  if (
    !(
      currentComputer &&
      input.localRuntimes.currentDeviceId &&
      input.localRuntimes.currentRuntimeLane
    )
  ) {
    return {
      code: "computer.current_missing",
      message: "No current Computer is connected to this account.",
      status: "unavailable",
    };
  }
  if (
    !input.target &&
    currentComputer.computerFileAccess?.readPolicy !== true
  ) {
    return { status: "unsupported" };
  }
  try {
    const ownerService = await lookupRuntimeTransportOwnerService({
      blockForgottenDevices: true,
      env: input.env,
      ownerUserId: input.userId,
    });
    if (input.target) {
      const session = requirePeopleComputerControlSession({
        target: input.target,
        inventory: input.localRuntimes,
        ownerService,
      });
      if (
        !projectPeopleComputerControls(session).computerFileAccess.readPolicy
      ) {
        return { status: "unsupported" };
      }
    }
    const target = requireCurrentLocalRuntimeServiceTarget({
      bindingTarget: {
        availability: "resolved",
        deviceId: input.localRuntimes.currentDeviceId,
        runtimeLane: input.localRuntimes.currentRuntimeLane,
      },
      inventory: input.localRuntimes,
      offlineError: {
        code: "computer.file_access.service_offline",
        reason: "This computer isn't reachable for OpenMeld right now.",
        status: 503,
      },
      ownerService,
    });
    const response = await readRuntimeTransportComputerFileAccessPolicy({
      ...target,
      env: input.env,
      ownerUserId: input.userId,
      request: { expectedDeviceId: target.deviceId },
    });
    if (!("policy" in response)) {
      return {
        code: response.code,
        message: response.message,
        status: "unavailable",
      };
    }
    return summarizeComputerFileAccessPolicy(response);
  } catch (error) {
    console.warn("[core.computers.owner_file_access_diagnostics_failed]", {
      deviceId: currentComputer.deviceId,
      error: error instanceof Error ? error.message : String(error),
      event: "computers.owner_file_access_diagnostics_failed",
      ownerUserId: input.userId,
    });
    return {
      code: "computer.file_access.unavailable",
      message: "File Access details are temporarily unavailable.",
      status: "unavailable",
    };
  }
}
type LookupOwnerServiceForUser = (input: {
  ownerUserId: string;
}) => Promise<
  import("@openmeld/schemas/types").RuntimeTransportLookupOwnerServiceResponse
>;
type CurrentLocalAgentControlTarget =
  LocalRuntimesResponse["localRuntimes"][number]["executionTargets"][number];
type CurrentLocalControlTarget = CurrentLocalAgentControlTarget;
async function resolveCurrentLocalControlTarget(input: {
  env: CoreBindings;
  offlineError: {
    code: string;
    reason: string;
    status: number;
  };
  userId: string;
}): Promise<{
  currentTarget: CurrentLocalControlTarget;
  lookupOwnerServiceForUser: LookupOwnerServiceForUser;
  ownerService: Awaited<ReturnType<LookupOwnerServiceForUser>>;
}> {
  const {
    bindingTarget,
    localRuntimes,
    lookupOwnerServiceForUser,
    ownerService,
  } = await resolveCurrentLocalServiceContext(input);
  const currentTarget = requireCurrentLocalRuntimeExecutionTarget({
    bindingTarget,
    inventory: localRuntimes,
    offlineError: input.offlineError,
    ownerService,
  });
  return { currentTarget, lookupOwnerServiceForUser, ownerService };
}
async function resolveCurrentLocalServiceContext(input: {
  env: CoreBindings;
  target?: PeopleComputerTarget;
  userId: string;
}) {
  const lookupOwnerServiceForUser: LookupOwnerServiceForUser = async ({
    ownerUserId,
  }) =>
    await lookupRuntimeTransportOwnerService({
      blockForgottenDevices: true,
      env: input.env,
      ownerUserId,
    });
  const ownerService = await lookupOwnerServiceForUser({
    ownerUserId: input.userId,
  });
  const localRuntimes = await listLocalRuntimesUseCase({
    connectionIdentityAdoption: input.target
      ? undefined
      : "safe_legacy_current",
    lookupOwnerService: async () => ownerService,
    store: buildCurrentDeviceTargetStore(input.env),
    userId: input.userId,
  });
  const bindingTarget =
    localRuntimes.currentDeviceId && localRuntimes.currentRuntimeLane
      ? {
          availability: "resolved" as const,
          deviceId: localRuntimes.currentDeviceId,
          runtimeLane: localRuntimes.currentRuntimeLane,
        }
      : { availability: "missing" as const };
  return {
    bindingTarget,
    localRuntimes,
    lookupOwnerServiceForUser,
    ownerService,
  };
}
async function resolveCurrentLocalAgentControlTarget(input: {
  capability: keyof CurrentLocalAgentControlTarget["localAgentControl"];
  env: CoreBindings;
  target?: PeopleComputerTarget;
  unsupportedCode: string;
  unsupportedReason: string;
  userId: string;
}): Promise<{
  currentTarget: PeopleComputerTarget;
  lookupOwnerServiceForUser: LookupOwnerServiceForUser;
}> {
  if (input.target) {
    const { localRuntimes, ownerService, lookupOwnerServiceForUser } =
      await resolveCurrentLocalServiceContext(input);
    const session = requirePeopleComputerControlSession({
      target: input.target,
      inventory: localRuntimes,
      ownerService,
    });
    if (
      projectPeopleComputerControls(session).localAgentControl[
        input.capability
      ] !== true
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        code: input.unsupportedCode,
        reason: input.unsupportedReason,
      });
    }
    return { currentTarget: input.target, lookupOwnerServiceForUser };
  }
  const { currentTarget, lookupOwnerServiceForUser } =
    await resolveCurrentLocalControlTarget({
      env: input.env,
      offlineError: {
        code: "local_agent_control.current_runtime_missing",
        reason:
          "This computer isn't reachable for local agent changes right now.",
        status: 409,
      },
      userId: input.userId,
    });
  if (currentTarget.localAgentControl[input.capability] !== true) {
    throw createCoreRpcHttpError({
      status: 409,
      reason: input.unsupportedReason,
      code: input.unsupportedCode,
    });
  }
  return { currentTarget, lookupOwnerServiceForUser };
}
async function resolveCurrentOpenMeldToolsControlTarget(input: {
  capability: "requestUpdate" | "setAutomaticUpdates";
  env: CoreBindings;
  target?: PeopleComputerTarget;
  userId: string;
}): Promise<{
  deviceId: string;
  runtimeLane: DaemonServiceLane;
}> {
  const { bindingTarget, localRuntimes, ownerService } =
    await resolveCurrentLocalServiceContext(input);
  const explicitSession = input.target
    ? requirePeopleComputerControlSession({
        target: input.target,
        inventory: localRuntimes,
        ownerService,
      })
    : undefined;
  const currentTarget = explicitSession
    ? { deviceId: explicitSession.deviceId, runtimeLane: explicitSession.lane }
    : requireCurrentLocalRuntimeServiceTarget({
        bindingTarget,
        inventory: localRuntimes,
        offlineError: {
          code: "service_offline",
          reason: "OpenMeld Service is offline.",
          status: 503,
        },
        ownerService,
      });
  const supportsControl =
    ownerService.online &&
    (explicitSession ? [explicitSession] : ownerService.sessions).some(
      (session) =>
        session.deviceId === currentTarget.deviceId &&
        session.lane === currentTarget.runtimeLane &&
        projectPeopleComputerControls(session).openMeldToolsControl[
          input.capability
        ] === true
    );
  if (!supportsControl) {
    throw createCoreRpcHttpError({
      code: "service_update_required",
      reason: "Reconnect Computer to use this action.",
      status: 409,
    });
  }
  return currentTarget;
}
function requireAcceptedOpenMeldToolsControlResult(
  result: Awaited<ReturnType<typeof controlRuntimeTransportOpenMeldTools>>
) {
  if (result.status === "accepted") {
    return result.result;
  }
  let reason = result.message;
  let status = 409;
  if (result.reasonCode.includes("timeout")) {
    reason = "OpenMeld Service did not respond.";
    status = 504;
  } else if (
    result.reasonCode.includes("not_found") ||
    result.reasonCode.includes("offline")
  ) {
    reason = "OpenMeld Service is offline.";
    status = 503;
  }
  throw createCoreRpcHttpError({
    code: result.reasonCode,
    reason,
    status,
  });
}
async function controlOpenMeldToolsForUser(input: {
  env: CoreBindings;
  target?: PeopleComputerTarget;
  request: OpenMeldToolsControlRequest;
  userId: string;
}) {
  const capability =
    input.request.operation === "request_update"
      ? "requestUpdate"
      : "setAutomaticUpdates";
  const currentTarget = await resolveCurrentOpenMeldToolsControlTarget({
    capability,
    env: input.env,
    target: input.target,
    userId: input.userId,
  });
  return requireAcceptedOpenMeldToolsControlResult(
    await controlRuntimeTransportOpenMeldTools({
      deviceId: currentTarget.deviceId,
      env: input.env,
      ownerUserId: input.userId,
      request: input.request,
      runtimeLane: currentTarget.runtimeLane,
    })
  );
}
export async function rpcRequestCurrentOpenMeldToolsUpdate(
  env: CoreBindings,
  input: RequestCurrentOpenMeldToolsUpdateInput,
  target?: PeopleComputerTarget
): Promise<RequestCurrentOpenMeldToolsUpdateResponse> {
  const result = await controlOpenMeldToolsForUser({
    env,
    target,
    request: {
      operation: "request_update",
      requestSource: "web",
    },
    userId: requireAuthenticatedOwnerUserId(input.context),
  });
  if (result.operation !== "request_update") {
    throw new Error("OpenMeld Service returned the wrong update result.");
  }
  return requestCurrentOpenMeldToolsUpdateResponseSchema.parse(result.result);
}
export async function rpcSetCurrentOpenMeldToolsMaintenance(
  env: CoreBindings,
  input: SetCurrentOpenMeldToolsMaintenanceInput,
  target?: PeopleComputerTarget
): Promise<SetCurrentOpenMeldToolsMaintenanceResponse> {
  const parsed = setCurrentOpenMeldToolsMaintenanceBodySchema.safeParse({
    automaticUpdatesEnabled: input.automaticUpdatesEnabled,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Invalid update setting.",
      status: 400,
    });
  }
  const result = await controlOpenMeldToolsForUser({
    env,
    target,
    request: {
      automaticUpdatesEnabled: parsed.data.automaticUpdatesEnabled,
      operation: "set_automatic_updates",
      requestSource: "web",
    },
    userId: requireAuthenticatedOwnerUserId(input.context),
  });
  if (result.operation !== "set_automatic_updates") {
    throw new Error("OpenMeld Service returned the wrong update setting.");
  }
  return setCurrentOpenMeldToolsMaintenanceResponseSchema.parse(result.result);
}
type CurrentLocalProjectControlTarget =
  LocalRuntimesResponse["localRuntimes"][number]["executionTargets"][number];
async function resolveCurrentLocalProjectControlTarget(input: {
  capability:
    | keyof NonNullable<CurrentLocalProjectControlTarget["localProjectControl"]>
    | "readConnections";
  env: CoreBindings;
  userId: string;
}): Promise<CurrentLocalProjectControlTarget> {
  const { currentTarget, ownerService } =
    await resolveCurrentLocalControlTarget({
      env: input.env,
      offlineError: {
        code: "service_offline",
        reason: "This computer isn't reachable for OpenMeld right now.",
        status: 503,
      },
      userId: input.userId,
    });
  const available =
    input.capability === "readConnections"
      ? ownerService?.online === true &&
        selectCurrentOwnerServiceSessionsByDeviceLane(ownerService).some(
          (session) =>
            session.deviceId === currentTarget.deviceId &&
            session.lane === currentTarget.runtimeLane &&
            session.executionCompatibility.status === "compatible" &&
            session.capabilities.localProjectControl?.readConnections === true
        )
      : currentTarget.localProjectControl?.[input.capability] === true;
  if (!available) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Update the current local OpenMeld Service before managing Project connections.",
      code: "service_update_required",
    });
  }
  return currentTarget;
}
export async function rpcSetCurrentLocalAgentEnabled(
  env: CoreBindings,
  input: SetCurrentLocalAgentEnabledInput,
  target?: PeopleComputerTarget
): Promise<SetCurrentLocalAgentEnabledResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const routeParams = setCurrentLocalAgentEnabledRouteParamsSchema.safeParse({
    agentId: input.agentId,
  });
  const parsed = setCurrentLocalAgentEnabledBodySchema.safeParse({
    enabled: input.enabled,
  });
  if (!(routeParams.success && parsed.success)) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        routeParams.error?.issues[0]?.message ??
        parsed.error?.issues[0]?.message ??
        "invalid local agent enabled payload",
      code: "invalid_payload",
    });
  }
  const { currentTarget, lookupOwnerServiceForUser } =
    await resolveCurrentLocalAgentControlTarget({
      capability: "setEnabled",
      env,
      target,
      unsupportedCode: "local_agent_control.unsupported",
      unsupportedReason:
        "The current local OpenMeld Service does not support local agent changes from OpenMeld Web.",
      userId,
    });
  const transportResult = await setRuntimeTransportLocalAgentEnabled({
    agentId: routeParams.data.agentId,
    deviceId: currentTarget.deviceId,
    enabled: parsed.data.enabled,
    env,
    ownerUserId: userId,
    runtimeLane: currentTarget.runtimeLane,
  });
  const acceptedPayload =
    requireAcceptedLocalAgentControlPayload(transportResult);
  const refreshedLocalRuntimes = await listLocalRuntimesUseCase({
    connectionIdentityAdoption: "safe_legacy_current",
    lookupOwnerService: lookupOwnerServiceForUser,
    store: buildCurrentDeviceTargetStore(env),
    userId,
  });
  const response: SetCurrentLocalAgentEnabledResponse = {
    agentId: acceptedPayload.agentId,
    changed: acceptedPayload.changed,
    enabled: acceptedPayload.enabled,
    localRuntimes: omitLocalRuntimeUsageLimits(refreshedLocalRuntimes),
    reportSyncStatus: acceptedPayload.reportSyncStatus,
    status: acceptedPayload.status,
  };
  const validated =
    setCurrentLocalAgentEnabledResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build local agent enabled response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcGetCurrentLocalAgentInstallations(
  env: CoreBindings,
  input: GetCurrentLocalAgentInstallationsInput,
  target?: PeopleComputerTarget
): Promise<CurrentLocalAgentInstallationsResponse> {
  return await getCurrentLocalAgentInstallationsForUser(env, {
    agentId: input.agentId,
    target,
    userId: requireAuthenticatedOwnerUserId(input.context),
  });
}
async function getCurrentLocalAgentInstallationsForUser(
  env: CoreBindings,
  input: {
    agentId: string;
    userId: string;
    target?: PeopleComputerTarget;
  }
): Promise<CurrentLocalAgentInstallationsResponse> {
  const routeParams = currentLocalAgentInstallationsRouteParamsSchema.safeParse(
    {
      agentId: input.agentId,
    }
  );
  if (!routeParams.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        routeParams.error.issues[0]?.message ??
        "invalid local agent installation request",
      code: "invalid_payload",
    });
  }
  const { currentTarget } = await resolveCurrentLocalAgentControlTarget({
    capability: "manageInstallationsSafely",
    env,
    target: input.target,
    unsupportedCode: "local_agent_control.unsupported",
    unsupportedReason:
      "Update OpenMeld Service before choosing a local agent installation.",
    userId: input.userId,
  });
  const transportResult = await manageRuntimeTransportLocalAgentInstallation({
    deviceId: currentTarget.deviceId,
    env,
    ownerUserId: input.userId,
    request: {
      agentId: routeParams.data.agentId,
      operation: "list",
    },
    runtimeLane: currentTarget.runtimeLane,
  });
  const acceptedPayload =
    requireAcceptedLocalAgentInstallationPayload(transportResult);
  const response: CurrentLocalAgentInstallationsResponse = {
    agentId: acceptedPayload.agentId,
    installations: acceptedPayload.installations,
    selectionStatus: requireLocalAgentInstallationSelectionStatus(
      acceptedPayload.selectionStatus
    ),
    selectedInstallationId: acceptedPayload.selectedInstallationId,
  };
  const validated =
    currentLocalAgentInstallationsResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build local agent installations response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcSelectCurrentLocalAgentInstallation(
  env: CoreBindings,
  input: SelectCurrentLocalAgentInstallationInput,
  target?: PeopleComputerTarget
): Promise<SelectCurrentLocalAgentInstallationResponse> {
  return await selectCurrentLocalAgentInstallationForUser(env, {
    agentId: input.agentId,
    target,
    installationId: input.installationId,
    userId: requireAuthenticatedOwnerUserId(input.context),
  });
}
async function selectCurrentLocalAgentInstallationForUser(
  env: CoreBindings,
  input: {
    agentId: string;
    installationId: string;
    userId: string;
    target?: PeopleComputerTarget;
  }
): Promise<SelectCurrentLocalAgentInstallationResponse> {
  const routeParams = currentLocalAgentInstallationsRouteParamsSchema.safeParse(
    {
      agentId: input.agentId,
    }
  );
  const parsedBody = selectCurrentLocalAgentInstallationBodySchema.safeParse({
    installationId: input.installationId,
  });
  if (!(routeParams.success && parsedBody.success)) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        routeParams.error?.issues[0]?.message ??
        parsedBody.error?.issues[0]?.message ??
        "invalid local agent installation request",
      code: "invalid_payload",
    });
  }
  const { currentTarget, lookupOwnerServiceForUser } =
    await resolveCurrentLocalAgentControlTarget({
      capability: "manageInstallationsSafely",
      env,
      target: input.target,
      unsupportedCode: "local_agent_control.unsupported",
      unsupportedReason:
        "Update OpenMeld Service before choosing a local agent installation.",
      userId: input.userId,
    });
  const transportResult = await manageRuntimeTransportLocalAgentInstallation({
    deviceId: currentTarget.deviceId,
    env,
    ownerUserId: input.userId,
    request: {
      agentId: routeParams.data.agentId,
      installationId: parsedBody.data.installationId,
      operation: "select",
    },
    runtimeLane: currentTarget.runtimeLane,
  });
  const acceptedPayload =
    requireAcceptedLocalAgentInstallationPayload(transportResult);
  const refreshedLocalRuntimes = await listLocalRuntimesUseCase({
    connectionIdentityAdoption: "safe_legacy_current",
    lookupOwnerService: lookupOwnerServiceForUser,
    store: buildCurrentDeviceTargetStore(env),
    userId: input.userId,
  });
  const response: SelectCurrentLocalAgentInstallationResponse = {
    agentId: acceptedPayload.agentId,
    changed: acceptedPayload.changed,
    installations: acceptedPayload.installations,
    localRuntimes: omitLocalRuntimeUsageLimits(refreshedLocalRuntimes),
    reportSyncStatus: acceptedPayload.reportSyncStatus,
    selectionStatus: requireLocalAgentInstallationSelectionStatus(
      acceptedPayload.selectionStatus
    ),
    selectedInstallationId: acceptedPayload.selectedInstallationId,
    status:
      acceptedPayload.status === "listed"
        ? "unchanged"
        : acceptedPayload.status,
  };
  const validated =
    selectCurrentLocalAgentInstallationResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build selected local agent installation response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function requireLocalAgentInstallationSelectionStatus(
  status: unknown
): CurrentLocalAgentInstallationsResponse["selectionStatus"] {
  if (
    status === "available" ||
    status === "blocked_by_work" ||
    status === "operation_in_progress"
  ) {
    return status;
  }
  throw createCoreRpcHttpError({
    status: 409,
    reason:
      "Update OpenMeld Service before choosing a local agent installation.",
    code: "local_agent_control.service_update_required",
  });
}
export async function rpcGetCurrentAgentProfileWorkspace(
  env: CoreBindings,
  input: GetCurrentAgentProfileWorkspaceInput,
  target?: PeopleComputerTarget
): Promise<
  import("@openmeld/schemas/types").GetCurrentAgentProfileWorkspaceResponse
> {
  // Auth owns both the Profile's Organization and the private configuration's
  // owner. Membership alone never authorizes a local path read.
  const request = await requireAgentProfileWorkRecoveryScope(env, input);
  const query = getCurrentAgentProfileWorkspaceQuerySchema.safeParse({
    expectedBindingTarget: input.expectedBindingTarget,
  });
  if (!query.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid working-folder read precondition.",
    });
  }
  const expectedBindingTarget = query.data.expectedBindingTarget;
  const bound =
    target && !expectedBindingTarget
      ? null
      : await resolveBoundAgentProfileComputerContext(env, input);
  const currentTarget = target ?? bound?.target;
  if (!currentTarget) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "agent_profile_binding.target_unavailable",
      reason: "OpenMeld could not confirm the Computer that runs this Agent.",
    });
  }
  if (expectedBindingTarget && bound) {
    requireSameAgentProfileBindingTarget(
      bound.bindingTarget,
      expectedBindingTarget
    );
    if (
      bound.target.deviceId !== currentTarget.deviceId ||
      bound.target.runtimeLane !== currentTarget.runtimeLane
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        code: "agent_profile_binding.target_changed",
        reason:
          "This Agent’s Computer changed. Reopen Working folder to review its current settings.",
      });
    }
  }
  const result = await readRuntimeTransportProfileWorkspace({
    env,
    ownerUserId: request.owner.id,
    deviceId: currentTarget.deviceId,
    runtimeLane: currentTarget.runtimeLane,
    targetProfileId: request.agentProfileId,
  });
  if (result.status === "rejected") {
    throw createCoreRpcHttpError({
      status: 409,
      code: result.reasonCode,
      reason: result.message,
    });
  }
  if (!result.payload.accepted) {
    throw createCoreRpcHttpError({
      status: 409,
      code: result.payload.reasonCode,
      reason: result.payload.message,
    });
  }
  if (result.payload.targetProfileId !== request.agentProfileId) {
    throw createCoreRpcHttpError({
      status: 502,
      code: "local_agent_control.invalid_response",
      reason: "OpenMeld Service returned settings for a different Agent.",
    });
  }
  await requireAgentProfileWorkRecoveryScope(env, input);
  if (bound) {
    const current = await resolveBoundAgentProfileComputerContext(env, input);
    requireSameAgentProfileBindingTarget(
      current.bindingTarget,
      bound.bindingTarget
    );
    if (
      current.target.deviceId !== currentTarget.deviceId ||
      current.target.runtimeLane !== currentTarget.runtimeLane
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        code: "agent_profile_binding.target_changed",
        reason:
          "This Agent’s Computer changed. Reopen Working folder to review its current settings.",
      });
    }
  }
  return getCurrentAgentProfileWorkspaceResponseSchema.parse({
    agentProfileId: request.agentProfileId,
    target: currentTarget,
    workspace: result.payload.workspace,
  });
}

export async function rpcSetCurrentAgentProfileWorkspace(
  env: CoreBindings,
  input: SetCurrentAgentProfileWorkspaceInput,
  target?: PeopleComputerTarget,
  expectedBindingTarget?: import("../agent-profile-binding/application/agent-profile-binding-target").AgentProfileBindingTarget
): Promise<SetCurrentAgentProfileWorkspaceResponse> {
  const bindingTarget = expectedBindingTarget ?? input.expectedBindingTarget;
  const routeParams =
    setCurrentAgentProfileWorkspaceRouteParamsSchema.safeParse({
      agentProfileId: input.agentProfileId,
    });
  const parsed = setCurrentAgentProfileWorkspaceBodySchema.safeParse({
    workspaceMode: input.workspaceMode,
    ...(input.onlyIfUnconfigured ? { onlyIfUnconfigured: true } : {}),
    ...(input.workspacePath === undefined
      ? {}
      : { workspacePath: input.workspacePath }),
  });
  if (!(routeParams.success && parsed.success)) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        routeParams.error?.issues[0]?.message ??
        parsed.error?.issues[0]?.message ??
        "invalid profile workspace payload",
      code: "invalid_payload",
    });
  }
  const { db, request } = await requireAgentProfileWorkspaceScope(env, {
    agentProfileId: routeParams.data.agentProfileId,
    context: input.context,
  });
  const userId = request.owner.id;
  const { currentTarget } = await resolveCurrentLocalAgentControlTarget({
    capability: "setProfileWorkspace",
    env,
    target,
    unsupportedCode: "local_agent_control.profile_workspace_unsupported",
    unsupportedReason:
      "The current local OpenMeld Service does not support Project folder changes from OpenMeld Web.",
    userId,
  });
  const executionTargetMutationAdmission =
    await acquireAgentProfileExecutionTargetMutationAdmission({
      agentProfileId: routeParams.data.agentProfileId,
      env,
      ownerUserId: userId,
    });
  if (executionTargetMutationAdmission.status !== "acquired") {
    throw buildProfileWorkspaceMutationAdmissionError(
      executionTargetMutationAdmission.status
    );
  }
  let releaseExecutionTargetMutationAdmission = false;
  try {
    if (bindingTarget) {
      // This check is serialized with Binding changes by the existing owner
      // admission. A known refusal must release it without calling Service.
      releaseExecutionTargetMutationAdmission = true;
      const currentBinding = await readPrimaryAgentProfileBindingRecord({
        agentProfileId: routeParams.data.agentProfileId,
        db,
        owner: { id: userId, kind: "owner_account" },
      });
      requireSameAgentProfileBindingTarget(currentBinding, bindingTarget);
    }
    releaseExecutionTargetMutationAdmission = false;
    const transportResult = await setRuntimeTransportProfileWorkspace({
      deviceId: currentTarget.deviceId,
      env,
      ownerUserId: userId,
      runtimeLane: currentTarget.runtimeLane,
      targetProfileId: routeParams.data.agentProfileId,
      workspaceMode: parsed.data.workspaceMode,
      ...(parsed.data.onlyIfUnconfigured ? { onlyIfUnconfigured: true } : {}),
      ...(parsed.data.workspacePath === undefined
        ? {}
        : { workspacePath: parsed.data.workspacePath }),
    });
    releaseExecutionTargetMutationAdmission =
      isRuntimeTransportProfileWorkspaceOutcomeDefinitive(transportResult);
    return requireUpdatedProfileWorkspaceResponse(transportResult);
  } finally {
    if (releaseExecutionTargetMutationAdmission) {
      await releaseAgentProfileExecutionTargetMutationAdmission({
        agentProfileId: routeParams.data.agentProfileId,
        env,
        operationId: executionTargetMutationAdmission.operationId,
        ownerUserId: userId,
      });
    } else {
      console.warn(
        "[core.agent_profile.workspace_mutation_outcome_unknown_lease_retained]",
        {
          agentProfileId: routeParams.data.agentProfileId,
          operationId: executionTargetMutationAdmission.operationId,
          ownerUserId: userId,
        }
      );
    }
  }
}
export async function rpcSetBoundPeopleComputerAgentProfileWorkspace(
  env: CoreBindings,
  input: SetCurrentAgentProfileWorkspaceInput & PeopleComputerTarget
) {
  const expected = agentProfileBindingTargetSchema.safeParse(
    input.expectedBindingTarget
  );
  if (!expected.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "The current Binding is required to save this working folder.",
    });
  }
  const bound = await resolveBoundAgentProfileComputerContext(env, input);
  requireSameAgentProfileBindingTarget(bound.bindingTarget, expected.data);
  if (
    bound.target.deviceId !== input.deviceId ||
    bound.target.runtimeLane !== input.runtimeLane
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "agent_profile_binding.target_changed",
      reason:
        "This working folder belongs to a different Computer. Reopen Working folder to review the Agent’s current settings.",
    });
  }
  return await rpcSetCurrentAgentProfileWorkspace(
    env,
    input,
    bound.target,
    expected.data
  );
}
export type GetAgentProfileFoldersInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};

/**
 * Owner-only read of one Profile's folders on its bound Computer. It asks the
 * Service first; when the Computer cannot answer, it returns the last folder
 * save Core recorded and says so. Folders carry ids and names, never paths.
 */
export async function rpcGetAgentProfileFolders(
  env: CoreBindings,
  input: GetAgentProfileFoldersInput
): Promise<import("@openmeld/schemas/types").GetAgentProfileFoldersResponse> {
  const params = getAgentProfileFoldersRouteParamsSchema.safeParse({
    agentProfileId: input.agentProfileId,
  });
  if (!params.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid Agent Profile id.",
    });
  }
  const request = await requireAgentProfileWorkRecoveryScope(env, input);
  const bound = await resolveBoundAgentProfileComputerContext(env, input);
  const transport = {
    deviceId: bound.target.deviceId,
    env,
    ownerUserId: request.owner.id,
    runtimeLane: bound.target.runtimeLane,
    targetProfileId: request.agentProfileId,
  };
  const live = await manageRuntimeTransportProfileFolders({
    ...transport,
    operation: { operation: "list" },
  });
  if (live.status === "accepted") {
    return getAgentProfileFoldersResponseSchema.parse({
      agentProfileId: request.agentProfileId,
      observedAtMs: live.record.observedAtMs,
      projection: live.record.projection,
      status: "current",
      target: bound.target,
    });
  }
  const recorded = await readRuntimeTransportProfileFolderProjection(transport);
  if (recorded.status === "found") {
    return getAgentProfileFoldersResponseSchema.parse({
      agentProfileId: request.agentProfileId,
      observedAtMs: recorded.record.observedAtMs,
      projection: recorded.record.projection,
      reasonCode: live.reasonCode,
      status: "recorded",
      target: bound.target,
    });
  }
  return getAgentProfileFoldersResponseSchema.parse({
    agentProfileId: request.agentProfileId,
    message: live.message,
    reasonCode: live.reasonCode,
    status: "unavailable",
    target: bound.target,
  });
}

/**
 * Sets the default folder by id. The id must be in Core's folder projection
 * for this Binding's Computer; the Service then applies it under the same
 * execution-target admission as a working-folder save and rejects an id it no
 * longer knows. Clearing Default Project is the caller's second ordered write.
 */
export async function rpcSetAgentProfileDefaultFolder(
  env: CoreBindings,
  input: {
    agentProfileId: string;
    context?: CoreRpcContextInput;
    folderId: string;
  },
  target: PeopleComputerTarget,
  expectedBindingTarget: import("../agent-profile-binding/application/agent-profile-binding-target").AgentProfileBindingTarget
): Promise<{
  agentProfileId: string;
  folderId: string;
  observedAtMs: number;
  projection: import("@openmeld/schemas/types").ProfileFolderProjection;
}> {
  const folderId = profileFolderIdSchema.safeParse(input.folderId);
  if (!folderId.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Choose a folder from the Agent’s folder list.",
    });
  }
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const userId = request.owner.id;
  const transport = {
    deviceId: target.deviceId,
    env,
    ownerUserId: userId,
    runtimeLane: target.runtimeLane,
    targetProfileId: request.agentProfileId,
  };
  const recorded = await readRuntimeTransportProfileFolderProjection(transport);
  const candidate = resolveProjectedDefaultFolder({
    folderId: folderId.data,
    record: recorded.status === "found" ? recorded.record : null,
  });
  if (candidate.status === "not_found") {
    throw createCoreRpcHttpError({
      status: 404,
      code: "profile_folder.not_found",
      reason:
        "This folder isn’t in the Agent’s folder list on its Computer. List the Agent’s folders again and choose one of them.",
    });
  }
  if (candidate.status === "project_default_unsupported") {
    throw createCoreRpcHttpError({
      status: 409,
      code: "profile_folder.project_default_unsupported",
      reason:
        "A Project folder can’t be the default folder. Set the Agent’s Default Project instead.",
    });
  }
  const result = await applyDefaultChangingProfileFolderOperation(env, {
    db,
    expectedBindingTarget,
    operation: { folderId: folderId.data, operation: "set_default" },
    transport,
  });
  return {
    agentProfileId: request.agentProfileId,
    folderId: folderId.data,
    observedAtMs: result.record.observedAtMs,
    projection: result.record.projection,
  };
}

/**
 * Runs a folder operation that can change the default under the same
 * execution-target admission as a working-folder save. A timed-out or
 * unreadable outcome keeps the lease: the Service may still have applied it.
 */
async function applyDefaultChangingProfileFolderOperation(
  env: CoreBindings,
  input: {
    db: Parameters<typeof readPrimaryAgentProfileBindingRecord>[0]["db"];
    expectedBindingTarget: import("../agent-profile-binding/application/agent-profile-binding-target").AgentProfileBindingTarget;
    operation: Extract<
      import("@openmeld/schemas/types").ProfileFolderOperation,
      { operation: "repair" | "set_default" }
    >;
    transport: Omit<
      Parameters<typeof manageRuntimeTransportProfileFolders>[0],
      "operation"
    >;
  }
) {
  const agentProfileId = input.transport.targetProfileId;
  const userId = input.transport.ownerUserId;
  const admission = await acquireAgentProfileExecutionTargetMutationAdmission({
    agentProfileId,
    env,
    ownerUserId: userId,
  });
  if (admission.status !== "acquired") {
    throw buildProfileWorkspaceMutationAdmissionError(admission.status);
  }
  let releaseAdmission = true;
  try {
    const currentBinding = await readPrimaryAgentProfileBindingRecord({
      agentProfileId,
      db: input.db,
      owner: { id: userId, kind: "owner_account" },
    });
    requireSameAgentProfileBindingTarget(
      currentBinding,
      input.expectedBindingTarget
    );
    const result = await manageRuntimeTransportProfileFolders({
      ...input.transport,
      operation: input.operation,
    });
    releaseAdmission =
      result.status === "accepted" ||
      (result.reasonCode !== "local_agent_control.timeout" &&
        result.reasonCode !== "local_agent_control.invalid_response");
    if (result.status !== "accepted") {
      throw createCoreRpcHttpError({
        code: result.reasonCode,
        reason: result.message,
        status: result.reasonCode === "local_agent_control.timeout" ? 504 : 409,
      });
    }
    return result;
  } finally {
    if (releaseAdmission) {
      await releaseAgentProfileExecutionTargetMutationAdmission({
        agentProfileId,
        env,
        operationId: admission.operationId,
        ownerUserId: userId,
      });
    } else {
      console.warn(
        "[core.agent_profile.default_folder_mutation_outcome_unknown_lease_retained]",
        {
          agentProfileId,
          operationId: admission.operationId,
          ownerUserId: userId,
        }
      );
    }
  }
}
export type ManageAgentProfileFoldersInput =
  import("@openmeld/schemas/types").ManageAgentProfileFoldersBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  };

/**
 * Owner folder change from Profile settings, applied by the Agent's bound
 * Service. A new default goes through rpcSetAgentProfileDefaultFolder (id
 * check against the projection and execution-target admission); the caller
 * clears Default Project as the second ordered write, as for any folder save.
 */
export async function rpcManageAgentProfileFolders(
  env: CoreBindings,
  input: ManageAgentProfileFoldersInput
): Promise<
  import("@openmeld/schemas/types").ManageAgentProfileFoldersResponse
> {
  const parsed = manageAgentProfileFoldersBodySchema.safeParse({
    expectedBindingTarget: input.expectedBindingTarget,
    operation: input.operation,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Invalid folder change.",
    });
  }
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const bound = await resolveBoundAgentProfileComputerContext(env, input);
  requireSameAgentProfileBindingTarget(
    bound.bindingTarget,
    parsed.data.expectedBindingTarget
  );
  const operation = parsed.data.operation;
  if (operation.operation === "set_default") {
    const saved = await rpcSetAgentProfileDefaultFolder(
      env,
      {
        agentProfileId: request.agentProfileId,
        context: input.context,
        folderId: operation.folderId,
      },
      bound.target,
      parsed.data.expectedBindingTarget
    );
    return manageAgentProfileFoldersResponseSchema.parse({
      agentProfileId: request.agentProfileId,
      folderId: saved.folderId,
      observedAtMs: saved.observedAtMs,
      projection: saved.projection,
      target: bound.target,
    });
  }
  const transport = {
    deviceId: bound.target.deviceId,
    env,
    ownerUserId: request.owner.id,
    runtimeLane: bound.target.runtimeLane,
    targetProfileId: request.agentProfileId,
  };
  if (operation.operation === "repair") {
    // A repair names a folder by kind or path, not by a projected id: the
    // saved list it replaces may be unreadable.
    const repaired = await applyDefaultChangingProfileFolderOperation(env, {
      db,
      expectedBindingTarget: parsed.data.expectedBindingTarget,
      operation,
      transport,
    });
    return manageAgentProfileFoldersResponseSchema.parse({
      agentProfileId: request.agentProfileId,
      ...(repaired.payload.accepted && repaired.payload.folderId
        ? { folderId: repaired.payload.folderId }
        : {}),
      observedAtMs: repaired.record.observedAtMs,
      projection: repaired.record.projection,
      target: bound.target,
    });
  }
  if (operation.operation === "remove") {
    await requireRemovableAgentProfileFolder(env, {
      folderId: operation.folderId,
      transport,
    });
  }
  const result = await manageRuntimeTransportProfileFolders({
    ...transport,
    operation,
  });
  if (result.status !== "accepted") {
    throw createCoreRpcHttpError({
      code: result.reasonCode,
      reason: result.message,
      status: result.reasonCode === "local_agent_control.timeout" ? 504 : 409,
    });
  }
  return manageAgentProfileFoldersResponseSchema.parse({
    agentProfileId: request.agentProfileId,
    ...(result.payload.accepted && result.payload.folderId
      ? { folderId: result.payload.folderId }
      : {}),
    observedAtMs: result.record.observedAtMs,
    projection: result.record.projection,
    target: bound.target,
  });
}

/**
 * The Service refuses to remove the default folder. A Project folder whose
 * Project is the Default Project is where new work starts too, and only Core
 * knows the Default Project, so Core refuses that removal. Unknown folders and
 * an unverifiable Default Project fail closed.
 */
async function requireRemovableAgentProfileFolder(
  env: CoreBindings,
  input: {
    folderId: string;
    transport: Parameters<
      typeof readRuntimeTransportProfileFolderProjection
    >[0];
  }
): Promise<void> {
  const recorded = await readRuntimeTransportProfileFolderProjection(
    input.transport
  );
  const record = recorded.status === "found" ? recorded.record : null;
  // Only a Project folder needs the Default Project, which Auth owns.
  const needsDefaultProject = record?.projection.folders.some(
    (item) => item.folderId === input.folderId && item.kind === "project"
  );
  let defaultProjectId: string | null = null;
  if (needsDefaultProject) {
    const scope = await resolveAgentProfileWorkRecoveryAuthScope({
      agentProfileId: input.transport.targetProfileId,
      authWorker: env.OPENMELD_AUTH_WORKER,
    });
    if (scope.status !== "valid") {
      throw createCoreRpcHttpError({
        status: 503,
        code: "agent_profile.unavailable",
        reason:
          "OpenMeld couldn’t confirm this Agent’s Default Project. Try again.",
      });
    }
    defaultProjectId = scope.scope.defaultProjectId;
  }
  const removable = resolveRemovableFolder({
    defaultProjectId,
    folderId: input.folderId,
    record,
  });
  if (removable.status === "not_found") {
    throw createCoreRpcHttpError({
      status: 404,
      code: "profile_folder.not_found",
      reason:
        "This folder isn’t in the Agent’s folder list on its Computer. Reopen Folders and try again.",
    });
  }
  if (removable.status === "default_project_folder") {
    throw createCoreRpcHttpError({
      status: 409,
      code: "profile_folder.default_removal_requires_replacement",
      reason:
        "New work starts in this Project. Make another folder the default before removing it.",
    });
  }
}

/** Path-free folder list for the represented owner's Center Agent turn. */
async function readCenterAgentAgentProfileFolders(
  env: CoreBindings,
  input: GetAgentProfileFoldersInput
): Promise<
  NonNullable<
    import("@openmeld/schemas/types").CenterAgentCheckAgentProfileReadinessResponse["folders"]
  >
> {
  try {
    const folders = await rpcGetAgentProfileFolders(env, input);
    return {
      projection: folders.status === "unavailable" ? null : folders.projection,
      reasonCode: folders.status === "current" ? null : folders.reasonCode,
      status: folders.status,
    };
  } catch (error) {
    return {
      projection: null,
      reasonCode:
        readSafeRpcFailureReasonCode(error) ?? "profile_folder.read_failed",
      status: "unavailable",
    };
  }
}
function buildProfileWorkspaceMutationAdmissionError(
  status: "blocked" | "unavailable"
): ReturnType<typeof createCoreRpcHttpError> {
  const blocked = status === "blocked";
  return createCoreRpcHttpError({
    code: blocked
      ? "agent_profile.workspace_change_blocked_active_execution"
      : "agent_profile.workspace_change_eligibility_unavailable",
    reason: blocked
      ? "The working folder can’t change while this Agent is working because that would interrupt the current Wake."
      : "OpenMeld couldn’t confirm whether this Agent is working, so the working folder is temporarily unavailable. Try again.",
    status: blocked ? 409 : 503,
  });
}
function requireUpdatedProfileWorkspaceResponse(
  transportResult: Awaited<
    ReturnType<typeof setRuntimeTransportProfileWorkspace>
  >
): SetCurrentAgentProfileWorkspaceResponse {
  if (transportResult.status !== "accepted") {
    throw createCoreRpcHttpError({
      code: transportResult.reasonCode,
      reason: transportResult.message,
      status:
        transportResult.reasonCode === "local_agent_control.timeout"
          ? 504
          : 409,
    });
  }
  if (!transportResult.payload.accepted) {
    throw createCoreRpcHttpError({
      code:
        transportResult.payload.reasonCode ??
        "local_agent_control.profile_workspace_rejected",
      reason:
        transportResult.payload.message ??
        "The current local OpenMeld Service could not save the Project folder.",
      status: 409,
    });
  }
  const response: SetCurrentAgentProfileWorkspaceResponse = {
    agentProfileId: transportResult.payload.targetProfileId,
    status: "updated",
    workspaceMode: transportResult.payload.workspaceMode,
    workspacePath: transportResult.payload.workspacePath,
  };
  const validated =
    setCurrentAgentProfileWorkspaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build profile workspace response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcRefreshCurrentLocalAgentCatalog(
  env: CoreBindings,
  input: RefreshCurrentLocalAgentCatalogInput,
  target?: PeopleComputerTarget
): Promise<RefreshCurrentLocalAgentCatalogResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const { currentTarget, lookupOwnerServiceForUser } =
    await resolveCurrentLocalAgentControlTarget({
      capability: "refreshCatalog",
      env,
      target,
      unsupportedCode: "local_agent_control.refresh_catalog_unsupported",
      unsupportedReason:
        "The current local OpenMeld Service does not support checking local agents from OpenMeld Web.",
      userId,
    });
  const transportResult = await refreshRuntimeTransportLocalAgentCatalog({
    deviceId: currentTarget.deviceId,
    env,
    ownerUserId: userId,
    reason: "settings_manual_check",
    runtimeLane: currentTarget.runtimeLane,
  });
  if (transportResult.status !== "accepted") {
    throw createCoreRpcHttpError({
      status:
        transportResult.reasonCode === "local_agent_control.timeout"
          ? 504
          : 409,
      reason: transportResult.message,
      code: transportResult.reasonCode,
    });
  }
  if (!transportResult.payload.accepted) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        transportResult.payload.errorMessage ??
        "The current local OpenMeld Service could not check local agents.",
      code:
        transportResult.payload.note ??
        "local_agent_control.refresh_catalog_rejected",
    });
  }
  const refreshedLocalRuntimes = await listLocalRuntimesUseCase({
    connectionIdentityAdoption: "safe_legacy_current",
    lookupOwnerService: lookupOwnerServiceForUser,
    store: buildCurrentDeviceTargetStore(env),
    userId,
  });
  const response: RefreshCurrentLocalAgentCatalogResponse = {
    localRuntimes: omitLocalRuntimeUsageLimits(refreshedLocalRuntimes),
    sync: transportResult.payload,
  };
  const validated =
    refreshCurrentLocalAgentCatalogResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build local agent catalog refresh response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcSetLocalRuntimeDisplayName(
  env: CoreBindings,
  input: SetLocalRuntimeDisplayNameInput
): Promise<LocalRuntimesResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const routeParams = forgetComputerRouteParamsSchema.safeParse({
    deviceId: input.deviceId,
  });
  if (!routeParams.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: routeParams.error.issues[0]?.message ?? "invalid deviceId",
      code: "invalid_payload",
    });
  }
  const parsed = setLocalRuntimeDisplayNameBodySchema.safeParse({
    displayName: input.displayName,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid local runtime display name payload",
      code: "invalid_payload",
    });
  }
  const response = await setLocalRuntimeDisplayNameUseCase({
    store: buildCurrentDeviceTargetStore(env),
    userId,
    deviceId: routeParams.data.deviceId,
    displayName: parsed.data.displayName,
  });
  const validated = localRuntimesResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build local runtimes response after display name write: ${validated.error.message}`
    );
  }
  return omitLocalRuntimeUsageLimits(validated.data);
}
export async function rpcEnrollLocalRuntime(
  env: CoreBindings,
  input: EnrollLocalRuntimeInput
): Promise<LocalRuntimeEnrollmentResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const parsedDeviceId = currentDeviceTargetDeviceIdSchema.safeParse(
    input.deviceId
  );
  const parsed = localRuntimeEnrollmentBodySchema.safeParse({
    ...(input.connectedComputerId === undefined
      ? {}
      : { connectedComputerId: input.connectedComputerId }),
    runtimeLane: input.runtimeLane,
  });
  if (!(parsedDeviceId.success && parsed.success)) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsedDeviceId.error?.issues[0]?.message ??
        parsed.error?.issues[0]?.message ??
        "invalid local runtime enrollment",
      code: "invalid_payload",
    });
  }
  let response: LocalRuntimeEnrollmentResponse;
  try {
    response = await enrollLocalSetupDeviceUseCase({
      store: buildCurrentDeviceTargetStore(env),
      userId,
      deviceId: parsedDeviceId.data,
      ...(parsed.data.connectedComputerId === undefined
        ? {}
        : { connectedComputerId: parsed.data.connectedComputerId }),
      runtimeLane: parsed.data.runtimeLane,
    });
  } catch (error) {
    if (error instanceof ConnectedComputerEnrollmentInvalidError) {
      throw createCoreRpcHttpError({
        status: 409,
        reason: error.message,
        code: "connected_computer.enrollment_invalid",
      });
    }
    throw error;
  }
  const validated = localRuntimeEnrollmentResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build local runtime enrollment response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcForgetCurrentComputer(
  env: CoreBindings,
  input: GetCurrentDeviceTargetInput
): Promise<ForgetCurrentComputerResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const response = await forgetCurrentComputerUseCase({
    store: buildCurrentDeviceTargetStore(env),
    userId,
  });
  const validated = forgetCurrentComputerResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build forgotten computer response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcForgetComputer(
  env: CoreBindings,
  input: ForgetComputerInput
): Promise<ForgetComputerResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const parsed = forgetComputerRouteParamsSchema.safeParse({
    deviceId: input.deviceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_device_id",
      reason: parsed.error.issues[0]?.message ?? "Invalid computer device id.",
    });
  }
  const response = await forgetComputerUseCase({
    store: buildCurrentDeviceTargetStore(env),
    userId,
    deviceId: parsed.data.deviceId,
  });
  const validated = forgetComputerResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build forgotten computer response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcGetPrepareReadiness(
  env: CoreBindings,
  input: GetPrepareReadinessInput
): Promise<GetPrepareReadinessResponse> {
  const request = requirePrepareReadinessRequest(input.context, input.deviceId);
  const query = getPrepareReadinessQuerySchema.safeParse({
    agentControllerRefs: input.agentControllerRefs,
    lane: input.lane,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!query.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        query.error.issues[0]?.message ?? "invalid prepare readiness query",
      code: "invalid_payload",
    });
  }
  const runtimeLookupInput = createRuntimeLookupInput({
    deviceId: request.deviceId,
    lane: query.data.lane,
    owner: {
      id: request.userId,
      kind: "owner_account",
    },
  });
  const result = await resolveRuntimePrepareReadinessFromPostgres({
    agentControllerRefsToEvaluate: query.data.agentControllerRefs,
    db: requireRuntimeReadinessDb(env),
    nowMs: Date.now(),
    ...(query.data.openMeldServiceRuntimeId
      ? {
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: query.data.openMeldServiceRuntimeId,
          },
        }
      : {}),
    runtimeLookupInput,
  });
  const validated = getPrepareReadinessResponseSchema.safeParse(result);
  if (!validated.success) {
    throw new Error(
      `failed to build prepare readiness response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcSubmitRuntimeRegistration(
  env: CoreBindings,
  input: SubmitRuntimeRegistrationInput
): Promise<SubmitRuntimeRegistrationResponse> {
  const request = requireRuntimeReportingRequest(input.context, input.deviceId);
  const body = submitRuntimeRegistrationBodySchema.safeParse({
    lane: input.lane,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: body.error.issues[0]?.message ?? "invalid Runtime registration",
      code: "invalid_payload",
    });
  }
  const db = requireRuntimeReadinessDb(env);
  const runtimeLookupInput = createRuntimeLookupInput({
    deviceId: request.deviceId,
    lane: body.data.lane,
    owner: {
      id: request.userId,
      kind: "owner_account",
    },
  });
  const result = await registerRuntime({
    forgottenDeviceStore: {
      readForgottenDevice: async (lookup) =>
        await readForgottenDeviceRecord({
          db,
          deviceId: lookup.deviceId,
          userId: lookup.ownerId,
        }),
    },
    nowMs: Date.now(),
    ownerAuthorization: { status: "allowed" },
    runtimeLookupInput,
    store: {
      registerRuntimeRecord: async (record) =>
        await registerRuntimeRegistryRecord({
          db,
          record,
        }),
    },
  });
  let response: SubmitRuntimeRegistrationResponse;
  if ("openMeldServiceRuntimeId" in result) {
    response = {
      openMeldServiceRuntimeId: result.openMeldServiceRuntimeId,
      status: result.status,
    };
  } else {
    response = buildRejectedRuntimeRegistrationResponse(result.reason);
  }
  const validated = submitRuntimeRegistrationResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Runtime registration response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcSubmitRuntimeAgentControllerReports(
  env: CoreBindings,
  input: SubmitRuntimeAgentControllerReportsInput
): Promise<SubmitRuntimeAgentControllerReportsResponse> {
  const context = requireRpcContext(input.context);
  const request = requireRuntimeReportingRequest(context, input.deviceId);
  const body = submitRuntimeAgentControllerReportsBodySchema.safeParse({
    lane: input.lane,
    reports: input.reports,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Runtime Agent Controller Report submission",
      code: "invalid_payload",
    });
  }
  const db = requireRuntimeReadinessDb(env);
  const runtimeLookupInput = createRuntimeLookupInput({
    deviceId: request.deviceId,
    lane: body.data.lane,
    owner: {
      id: request.userId,
      kind: "owner_account",
    },
  });
  const openMeldServiceRuntimeId =
    resolveSubmittedAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: body.data.openMeldServiceRuntimeId,
      runtimeLookupInput,
    });
  if (!openMeldServiceRuntimeId.ok) {
    return buildRuntimeAgentControllerReportsResponse({
      reports: body.data.reports.map((report) => ({
        agentControllerRef: report.agentControllerRef,
        reason: "openmeld_service_runtime_id_invalid" as const,
        status: "rejected" as const,
      })),
    });
  }
  const openMeldServiceRuntimeIdVerification =
    await verifySubmittedRuntimeIdForLookup({
      db,
      openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
      runtimeLookupInput,
    });
  if (!openMeldServiceRuntimeIdVerification.ok) {
    return buildRuntimeAgentControllerReportsResponse({
      reports: body.data.reports.map((report) => ({
        agentControllerRef: report.agentControllerRef,
        reason: openMeldServiceRuntimeIdVerification.reason,
        status: "rejected" as const,
      })),
    });
  }
  const reports: SubmitRuntimeAgentControllerReportResult[] = [];
  const authFreshnessRequired = isServiceAuthFreshnessRequired(
    (await readCoreLocalComponentsRelease(env.OPENMELD_CLI_RELEASES)).manifest
  );
  for (const report of body.data.reports) {
    const acceptedAtMs = Date.now();
    const result = await acceptRuntimeAgentControllerReport({
      authFreshnessRequired,
      nowMs: acceptedAtMs,
      report,
      reportStore: {
        acceptRuntimeAgentControllerReport: async (storeInput) =>
          await acceptRuntimeAgentControllerReportRecord({
            authFreshnessRequired: storeInput.authFreshnessRequired,
            db,
            nowMs: storeInput.nowMs,
            report: storeInput.report,
          }),
      },
      openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
      runtimeLookupInput,
      runtimeLookupStore: {
        readRuntimeRecord: async (lookupInput) =>
          await readRuntimeRegistryRecord({
            db,
            runtimeLookupInput: lookupInput.runtimeLookupInput,
          }),
      },
    });
    if (result.status === "accepted") {
      try {
        await notifyAgentProfileWorkUsageRecoveryAvailable({
          bindingStore: {
            listBindings: async (bindingInput) =>
              (
                await listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController(
                  {
                    ...bindingInput,
                    db,
                  }
                )
              ).map((binding) => ({
                agentProfileId: binding.agentProfileId,
                modelId: binding.modelId,
              })),
          },
          currentReport: result.currentReport,
          notifyUsageAvailable: async (recoveryInput) =>
            await resolveRuntimeTransportOwnerShard(
              env,
              recoveryInput.ownerUserId
            ).rpcMarkAgentProfileWorkUsageAvailable({
              ownerUserId: recoveryInput.ownerUserId,
              targetProfileIds: [...recoveryInput.targetProfileIds],
            }),
          nowMs: acceptedAtMs,
          ownerUserId: request.userId,
          resumeInterruptedWork: async (recoveryInput) => {
            await resumeUsageExhaustedAgentProfileWork({
              context,
              env,
              ownerUserId: recoveryInput.ownerUserId,
              targetProfileIds: recoveryInput.targetProfileIds,
            });
          },
        });
      } catch (error) {
        console.warn("[core.agent_profile_work.usage_recovery_failed]", {
          agentControllerRef: result.currentReport.agentControllerRef,
          error,
          openMeldServiceRuntimeId:
            result.currentReport.openMeldServiceRuntimeId.value,
          ownerUserId: request.userId,
        });
      }
    }
    if (result.status === "accepted") {
      await reconcileRuntimeAgentModelInboxes({
        env,
        ownerUserId: request.userId,
        nowMs: acceptedAtMs,
        agentControllerRef: result.currentReport.agentControllerRef,
        openMeldServiceRuntimeId: result.currentReport.openMeldServiceRuntimeId,
      }).catch((error) =>
        console.warn("[core.model_inbox.reconcile_failed]", { error })
      );
    }
    reports.push(
      result.status === "accepted"
        ? {
            agentControllerRef: result.currentReport.agentControllerRef,
            outcome: result.outcome,
            status: "accepted" as const,
          }
        : {
            agentControllerRef: report.agentControllerRef,
            reason: result.reason,
            status: "rejected" as const,
          }
    );
  }
  return buildRuntimeAgentControllerReportsResponse({
    reports,
    openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
  });
}
export async function rpcSubmitRuntimeProviderConversationProofs(
  env: CoreBindings,
  input: SubmitRuntimeProviderConversationProofsInput
): Promise<SubmitRuntimeProviderConversationProofsResponse> {
  const request = requireRuntimeReportingRequest(input.context, input.deviceId);
  const body = submitRuntimeProviderConversationProofsBodySchema.safeParse({
    lane: input.lane,
    proofs: input.proofs,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Provider Conversation Proof submission",
      code: "invalid_payload",
    });
  }
  const db = requireRuntimeReadinessDb(env);
  const runtimeLookupInput = createRuntimeLookupInput({
    deviceId: request.deviceId,
    lane: body.data.lane,
    owner: {
      id: request.userId,
      kind: "owner_account",
    },
  });
  const openMeldServiceRuntimeId =
    resolveSubmittedAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: body.data.openMeldServiceRuntimeId,
      runtimeLookupInput,
    });
  if (!openMeldServiceRuntimeId.ok) {
    return buildRuntimeProviderConversationProofsResponse({
      proofs: body.data.proofs.map((proof) => ({
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        reason: "openmeld_service_runtime_id_invalid" as const,
        status: "rejected" as const,
      })),
    });
  }
  const openMeldServiceRuntimeIdVerification =
    await verifySubmittedRuntimeIdForLookup({
      db,
      openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
      runtimeLookupInput,
    });
  if (!openMeldServiceRuntimeIdVerification.ok) {
    return buildRuntimeProviderConversationProofsResponse({
      proofs: body.data.proofs.map((proof) => ({
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        reason: openMeldServiceRuntimeIdVerification.reason,
        status: "rejected" as const,
      })),
    });
  }
  const proofs: SubmitRuntimeProviderConversationProofResult[] = [];
  for (const proof of body.data.proofs) {
    const parsedAgentControllerRef = parseAgentControllerRef(
      proof.agentControllerRef
    );
    if (!parsedAgentControllerRef) {
      proofs.push({
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        reason: "agent_controller_ref_invalid",
        status: "rejected",
      });
      continue;
    }
    if (
      proof.provider !== "codex" ||
      (proof.method !== "codex_app_server_thread_resume" &&
        proof.method !== "codex_app_server_thread_read") ||
      proof.transportMode !== "codex-app-server" ||
      proof.intrusive !== false
    ) {
      proofs.push({
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        reason: "provider_method_invalid",
        status: "rejected",
      });
      continue;
    }
    if (proof.expiresAtMs <= proof.observedAtMs) {
      proofs.push({
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        reason: "proof_time_invalid",
        status: "rejected",
      });
      continue;
    }
    const binding = await readPrimaryAgentProfileBindingRecord({
      agentProfileId: proof.agentProfileId,
      db,
      owner: {
        id: request.userId,
        kind: "owner_account",
      },
    });
    if (!binding) {
      proofs.push({
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        reason: "agent_profile_binding_missing",
        status: "rejected",
      });
      continue;
    }
    if (
      binding.bindingId !== proof.bindingId ||
      binding.bindingState !== "enabled_primary" ||
      binding.agentControllerRef !== parsedAgentControllerRef.ref ||
      binding.openMeldServiceRuntimeId !==
        openMeldServiceRuntimeId.value.value ||
      normalizeOptionalText(binding.agentControllerConversationId) !==
        proof.agentControllerConversationId
    ) {
      proofs.push({
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        reason: "agent_profile_binding_mismatch",
        status: "rejected",
      });
      continue;
    }
    const result = await acceptProviderConversationProofRecord({
      db,
      nowMs: Date.now(),
      proof: {
        agentProfileId: proof.agentProfileId,
        bindingId: proof.bindingId,
        agentControllerRef: parsedAgentControllerRef.ref,
        agentControllerConversationId: proof.agentControllerConversationId,
        openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
        errorCode: normalizeOptionalText(proof.errorCode),
        errorMessage: normalizeOptionalText(proof.errorMessage),
        errorType: normalizeOptionalText(proof.errorType),
        expiresAtMs: proof.expiresAtMs,
        intrusive: false,
        method: proof.method,
        observedAtMs: proof.observedAtMs,
        provider: proof.provider,
        status: proof.status,
        transportMode: "codex-app-server",
      },
    });
    proofs.push(
      result.status === "accepted"
        ? {
            agentProfileId: result.currentProof.agentProfileId,
            bindingId: result.currentProof.bindingId,
            outcome: result.outcome,
            status: "accepted" as const,
          }
        : {
            agentProfileId: proof.agentProfileId,
            bindingId: proof.bindingId,
            reason: result.reason,
            status: "rejected" as const,
          }
    );
  }
  return buildRuntimeProviderConversationProofsResponse({
    proofs,
    openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
  });
}
export async function rpcGetAgentProfilePrimaryBinding(
  env: CoreBindings,
  input: GetAgentProfilePrimaryBindingInput
): Promise<GetAgentProfilePrimaryBindingResponse> {
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  if (profileOwnerValidation.status !== "valid") {
    return buildGetAgentProfilePrimaryBindingResponse(
      mapMissingAgentProfileBindingProjection({
        agentProfileId: request.agentProfileId,
        reasonCodes: [profileOwnerValidation.reasonCode],
      }),
      "unavailable"
    );
  }
  if (!ownersEqual(profileOwnerValidation.owner, request.owner)) {
    return buildGetAgentProfilePrimaryBindingResponse(
      mapMissingAgentProfileBindingProjection({
        agentProfileId: request.agentProfileId,
        reasonCodes: ["agent_profile_binding.owner_mismatch"],
      }),
      "unavailable"
    );
  }
  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createPostgresAgentProfileBindingLookupStore({ db }),
  });
  return buildGetAgentProfilePrimaryBindingResponse(
    mapAgentProfileBindingLookupResultToProjection(lookupResult)
  );
}
async function resolveBoundAgentProfileComputerTarget(
  env: CoreBindings,
  input: GetAgentProfilePrimaryBindingInput
): Promise<PeopleComputerTarget> {
  return (await resolveBoundAgentProfileComputerContext(env, input)).target;
}
async function resolveBoundAgentProfileComputerContext(
  env: CoreBindings,
  input: GetAgentProfilePrimaryBindingInput
) {
  const response = await rpcGetAgentProfilePrimaryBinding(env, input);
  const executionTarget = response.binding.executionTarget;
  const unavailable = () =>
    createCoreRpcHttpError({
      code: "agent_profile_binding.target_unavailable",
      reason: "OpenMeld could not confirm the Computer that runs this Agent.",
      status: 409,
    });
  if (
    response.status !== "found" ||
    !executionTarget ||
    !response.binding.bindingId
  ) {
    throw unavailable();
  }
  const runtime = await resolveAgentExecutionTargetRuntimeContext({
    env,
    owner: {
      id: requireAuthenticatedOwnerUserId(input.context),
      kind: "owner_account",
    },
    targetRuntime: {
      kind: "openmeld_service_runtime_id",
      openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
    },
  });
  if (!runtime) {
    throw unavailable();
  }
  return {
    target: { deviceId: runtime.deviceId, runtimeLane: runtime.lane },
    bindingTarget: {
      bindingId: response.binding.bindingId,
      agentControllerRef: executionTarget.agentControllerRef,
      agentControllerConversationId:
        executionTarget.agentControllerConversationId ?? null,
      openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId.value,
    },
  };
}
export async function rpcGetCurrentAgentProfileSession(
  env: CoreBindings,
  input: GetCurrentAgentProfileSessionInput
): Promise<CurrentAgentProfileSessionLookupResponse> {
  const query = currentAgentProfileSessionLookupQuerySchema.safeParse({
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerRef: input.agentControllerRef,
  });
  if (!query.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        query.error.issues[0]?.message ??
        "Current Agent Profile Session lookup is invalid.",
      status: 400,
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const db = requireCenterAgentDb(env);
  const binding =
    await readPrimaryAgentProfileBindingRecordByControllerConversation({
      agentControllerConversationId: query.data.agentControllerConversationId,
      agentControllerRef: query.data.agentControllerRef,
      db,
      owner: {
        id: activeOrganization.userId,
        kind: "owner_account",
      },
    });
  if (!binding) {
    return currentAgentProfileSessionLookupResponseSchema.parse({
      currentOrganizationId: activeOrganization.organizationId,
      status: "not_found",
    });
  }
  const profile = await readAgentProfileOrganizationContext({
    agentProfileId: binding.agentProfileId,
    db,
  });
  if (
    profile?.profileKind !== "agent" ||
    profile.ownerUserId !== activeOrganization.userId ||
    !profile.organizationId
  ) {
    return currentAgentProfileSessionLookupResponseSchema.parse({
      currentOrganizationId: activeOrganization.organizationId,
      reasonCode: "agent_profile_binding.profile_identity_unavailable",
      status: "unavailable",
    });
  }
  return currentAgentProfileSessionLookupResponseSchema.parse({
    currentOrganizationId: activeOrganization.organizationId,
    profile: {
      profileId: binding.agentProfileId,
      profileName: profile.profileName,
      profileOrganizationId: profile.organizationId,
    },
    sameOrganization:
      profile.organizationId === activeOrganization.organizationId,
    status: "found",
  });
}
async function requireTaskRecoveryRequester(
  env: CoreBindings,
  request: ReturnType<typeof requireAgentProfileBindingRequest>,
  body: ExecuteAgentProfileWorkRecoveryBody
): Promise<string | undefined> {
  if (request.owner.id === request.context.actorContext.ownerUserId) {
    return undefined;
  }
  const denied = () =>
    createCoreRpcHttpError({
      code: "agent_profile_work_recovery.not_allowed",
      reason: "This task needs its Agent owner's attention.",
      status: 403,
    });
  if (!body.spaceId) {
    throw denied();
  }
  const { stub, spaceId } = resolveRpcSpaceStubOrThrow(env, body.spaceId);
  const queue = await stub.rpcInputQueue({
    spaceId,
    context: request.context,
    includeRecovery: true,
  });
  const allowed = queue.recoveries?.find(
    (item) =>
      item.targetProfileId === request.agentProfileId &&
      item.expectedInterruptedTargetWakeLifecycleId ===
        body.expectedInterruptedTargetWakeLifecycleId
  );
  if (
    !(
      allowed &&
      (body.action === allowed.action ||
        (allowed.action === "fork_interrupted_work" &&
          body.action === "skip_interrupted_work"))
    )
  ) {
    throw denied();
  }
  return request.context.actorContext.openMeldProfileId;
}

export async function rpcExecuteAgentProfileWorkRecovery(
  env: CoreBindings,
  input: ExecuteAgentProfileWorkRecoveryInput
): Promise<ExecuteAgentProfileWorkRecoveryResponse> {
  const parsedBody = executeAgentProfileWorkRecoveryBodySchema.safeParse(
    input.body
  );
  if (!parsedBody.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsedBody.error.issues[0]?.message ??
        "Agent Profile work recovery action is invalid.",
      status: 400,
    });
  }
  const request = await requireAgentProfileWorkRecoveryScope(
    env,
    input,
    parsedBody.data.spaceId !== undefined
  );
  const requesterProfileId = await requireTaskRecoveryRequester(
    env,
    request,
    parsedBody.data
  );
  const recovery =
    runtimeTransportAgentProfileWorkRecoveryReadResponseSchema.parse(
      await readRuntimeTransportAgentProfileWorkRecovery({
        env,
        ownerUserId: request.owner.id,
        requestId: request.context.actorContext.requestId,
        targetProfileId: request.agentProfileId,
      })
    );
  const ownerShard = resolveRuntimeTransportOwnerShard(env, request.owner.id);
  if (recovery.status === "unavailable") {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.temporarily_unavailable",
      reason: "OpenMeld is checking this Agent’s paused work. Try again.",
      status: 503,
    });
  }
  const isAllowedAction =
    recovery.status === "available" &&
    (recovery.action === parsedBody.data.action ||
      (recovery.action === "fork_interrupted_work" &&
        (parsedBody.data.action === "skip_interrupted_work" ||
          (parsedBody.data.action === "continue_interrupted_work" &&
            Boolean(recovery.forkInterruptedConversation) &&
            recovery.authorizedContinuationClientMessageId !== null))) ||
      (recovery.action === "continue_interrupted_work" &&
        Boolean(recovery.forkInterruptedConversation) &&
        parsedBody.data.action === "fork_interrupted_work"));
  if (!isAllowedAction) {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.not_pending",
      reason: "This recovery action is no longer needed.",
      status: 409,
    });
  }
  // Read the caller's observed work identity, never fill it from this fresh
  // read: an old tab may arrive while a later recovery offers the same action.
  if (!recovery.interruptedTargetWakeLifecycleId) {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.temporarily_unavailable",
      reason: "OpenMeld is checking this Agent’s paused work. Try again.",
      status: 503,
    });
  }
  if (
    parsedBody.data.expectedInterruptedTargetWakeLifecycleId !==
    recovery.interruptedTargetWakeLifecycleId
  ) {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.not_pending",
      reason:
        "This Agent’s paused work has changed. Review its current work before trying again.",
      status: 409,
    });
  }
  if (parsedBody.data.action === "approve_queued_work") {
    await executeAgentProfileWorkQueueApproval({
      expectedInterruptedTargetWakeLifecycleId:
        parsedBody.data.expectedInterruptedTargetWakeLifecycleId,
      ownerShard,
      ownerUserId: request.owner.id,
      targetProfileId: request.agentProfileId,
    });
  } else if (parsedBody.data.action === "fork_interrupted_work") {
    const continuation = await executeAgentProfileWorkContinuation({
      requesterProfileId,
      context: request.context,
      env,
      expectedInterruptedTargetWakeLifecycleId:
        parsedBody.data.expectedInterruptedTargetWakeLifecycleId,
      forkInterruptedConversation: true,
      ownerShard,
      ownerUserId: request.owner.id,
      recovery,
      targetProfileId: request.agentProfileId,
    });
    throwUnstartedAgentProfileWorkContinuationError(continuation);
  } else if (parsedBody.data.action === "skip_interrupted_work") {
    await executeAgentProfileInterruptedWorkSkip({
      requesterProfileId,
      expectedInterruptedTargetWakeLifecycleId:
        parsedBody.data.expectedInterruptedTargetWakeLifecycleId,
      ownerShard,
      ownerUserId: request.owner.id,
      targetProfileId: request.agentProfileId,
    });
  } else {
    const continuation = await executeAgentProfileWorkContinuation({
      context: request.context,
      env,
      ownerShard,
      ownerUserId: request.owner.id,
      recovery,
      targetProfileId: request.agentProfileId,
    });
    throwUnstartedAgentProfileWorkContinuationError(continuation);
  }
  return executeAgentProfileWorkRecoveryResponseSchema.parse({
    action: parsedBody.data.action,
    status: "accepted",
  });
}
export async function rpcAgentProfileExecutionMode(
  env: CoreBindings,
  input: AgentProfileExecutionModeInput
): Promise<AgentProfileExecutionModeResponse> {
  const request = await requireAgentProfileWorkRecoveryScope(env, input);
  const body =
    input.body === undefined
      ? undefined
      : updateAgentProfileExecutionModeBodySchema.safeParse(input.body);
  if (body && !body.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Execution mode must be parallel or serial.",
      status: 400,
    });
  }
  const ownerShard = resolveRuntimeTransportOwnerShard(env, request.owner.id);
  return agentProfileExecutionModeResponseSchema.parse(
    await ownerShard.rpcAgentProfileExecutionMode({
      ownerUserId: request.owner.id,
      targetProfileId: request.agentProfileId,
      ...(body?.success ? { mode: body.data.mode } : {}),
    })
  );
}
async function executeAgentProfileInterruptedWorkSkip(input: {
  requesterProfileId?: string;
  expectedInterruptedTargetWakeLifecycleId: string;
  ownerShard: ReturnType<typeof resolveRuntimeTransportOwnerShard>;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<void> {
  // Skip promises that OpenMeld will not continue this work, which is Core's
  // own decision and cannot fail here. Asking the computer to withdraw the
  // original attempt is the part OpenMeld cannot guarantee, so it is requested
  // while the gate still names the work and does not hold up the decision.
  await input.ownerShard
    .rpcRequestAgentProfileWorkLocalAttemptWithdrawal({
      expectedInterruptedTargetWakeLifecycleId:
        input.expectedInterruptedTargetWakeLifecycleId,
      ownerUserId: input.ownerUserId,
      targetProfileId: input.targetProfileId,
    })
    .catch((error: unknown) => {
      console.warn("[core.agent_profile_work.skip_withdrawal_request_failed]", {
        error,
        targetProfileId: input.targetProfileId,
      });
      return null;
    });
  const skipped = await input.ownerShard.rpcSkipAgentProfileInterruptedWork({
    requesterProfileId: input.requesterProfileId,
    expectedInterruptedTargetWakeLifecycleId:
      input.expectedInterruptedTargetWakeLifecycleId,
    ownerUserId: input.ownerUserId,
    targetProfileId: input.targetProfileId,
  });
  if (skipped.status === "skipped") {
    return;
  }
  throw createCoreRpcHttpError({
    code:
      skipped.status === "unavailable"
        ? "agent_profile_work_recovery.temporarily_unavailable"
        : "agent_profile_work_recovery.not_pending",
    reason:
      skipped.status === "unavailable"
        ? "OpenMeld could not skip this interrupted task yet. Try again."
        : "This recovery action is no longer needed.",
    status: skipped.status === "unavailable" ? 503 : 409,
  });
}
async function executeAgentProfileWorkQueueApproval(input: {
  expectedInterruptedTargetWakeLifecycleId: string;
  ownerShard: ReturnType<typeof resolveRuntimeTransportOwnerShard>;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<void> {
  const approved = await input.ownerShard.rpcApproveAgentProfileWorkQueue({
    expectedInterruptedTargetWakeLifecycleId:
      input.expectedInterruptedTargetWakeLifecycleId,
    ownerUserId: input.ownerUserId,
    targetProfileId: input.targetProfileId,
  });
  if (approved.status === "approved") {
    return;
  }
  throw createCoreRpcHttpError({
    code:
      approved.status === "unavailable"
        ? "agent_profile_work_recovery.temporarily_unavailable"
        : "agent_profile_work_recovery.not_pending",
    reason:
      approved.status === "unavailable"
        ? "OpenMeld could not start this Agent’s queued work yet. Try again."
        : "This recovery action is no longer needed.",
    status: approved.status === "unavailable" ? 503 : 409,
  });
}
async function resumeUsageExhaustedAgentProfileWork(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
  ownerUserId: string;
  targetProfileIds: readonly string[];
}): Promise<void> {
  const ownerShard = resolveRuntimeTransportOwnerShard(
    input.env,
    input.ownerUserId
  );
  let firstError: unknown = null;
  for (const targetProfileId of input.targetProfileIds) {
    let interruptedTargetWakeLifecycleId: string | null = null;
    try {
      const recovery =
        runtimeTransportAgentProfileWorkRecoveryReadResponseSchema.parse(
          await readRuntimeTransportAgentProfileWorkRecovery({
            env: input.env,
            ownerUserId: input.ownerUserId,
            requestId: input.context.actorContext.requestId,
            targetProfileId,
          })
        );
      if (
        recovery.status !== "available" ||
        (recovery.action !== "continue_interrupted_work" &&
          !(
            recovery.action === "fork_interrupted_work" &&
            recovery.automaticForkEligible === true
          ))
      ) {
        continue;
      }
      interruptedTargetWakeLifecycleId =
        recovery.interruptedTargetWakeLifecycleId ?? null;
      await executeAgentProfileWorkContinuation({
        context: input.context,
        env: input.env,
        ...(recovery.action === "fork_interrupted_work"
          ? {
              forkInterruptedConversation: true,
              requireAutomaticForkEligibility: true as const,
            }
          : {}),
        ownerShard,
        ownerUserId: input.ownerUserId,
        recovery,
        targetProfileId,
      });
    } catch (error) {
      if (
        interruptedTargetWakeLifecycleId &&
        shouldMarkUsageContinuationNeedsAttention(error)
      ) {
        try {
          await ownerShard.rpcMarkAgentProfileWorkContinuationNeedsAttention({
            expectedInterruptedTargetWakeLifecycleId:
              interruptedTargetWakeLifecycleId,
            ownerUserId: input.ownerUserId,
            targetProfileId,
          });
        } catch (markError) {
          console.warn(
            "[core.agent_profile_work.continuation_needs_attention_failed]",
            {
              error: markError,
              ownerUserId: input.ownerUserId,
              targetProfileId,
            }
          );
        }
      }
      firstError ??= error;
    }
  }
  if (firstError) {
    throw firstError;
  }
}
function shouldMarkUsageContinuationNeedsAttention(error: unknown): boolean {
  const definitiveCodes = new Set([
    "agent_profile_work_recovery.continuation_conflict",
    "agent_profile_work_recovery.continuation_source_mismatch",
    "agent_profile_work_recovery.continuation_unavailable",
  ]);
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current !== null; depth += 1) {
    if (visited.has(current) || typeof current !== "object") {
      return false;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && definitiveCodes.has(record.code)) {
      return true;
    }
    if (
      typeof record.message === "string" &&
      definitiveCodes.has(record.message)
    ) {
      return true;
    }
    current = record.cause ?? null;
  }
  return false;
}
async function executeAgentProfileWorkContinuation(input: {
  requesterProfileId?: string;
  context: CoreRpcContextInput;
  env: CoreBindings;
  expectedInterruptedTargetWakeLifecycleId?: string;
  forkInterruptedConversation?: boolean;
  requireAutomaticForkEligibility?: true;
  ownerShard: ReturnType<typeof resolveRuntimeTransportOwnerShard>;
  ownerUserId: string;
  recovery: Extract<
    import("@openmeld/schemas/types").RuntimeTransportAgentProfileWorkRecoveryReadResponse,
    {
      status: "available";
    }
  >;
  targetProfileId: string;
}): Promise<"awaiting_original_stop" | "deferred" | "started"> {
  if (
    !(
      input.recovery.interruptedSourceSignalId &&
      input.recovery.interruptedTargetWakeLifecycleId
    )
  ) {
    return "deferred";
  }
  if (
    input.expectedInterruptedTargetWakeLifecycleId !== undefined &&
    input.expectedInterruptedTargetWakeLifecycleId !==
      input.recovery.interruptedTargetWakeLifecycleId
  ) {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.not_pending",
      reason: "This recovery action is no longer needed.",
      status: 409,
    });
  }
  const deterministicIdentity = await buildAgentProfileWorkContinuationIdentity(
    {
      interruptedClientMessageId: input.recovery.interruptedClientMessageId,
      targetProfileId: input.targetProfileId,
    }
  );
  const continuationClientMessageId =
    input.recovery.authorizedContinuationClientMessageId ??
    deterministicIdentity.continuationClientMessageId;
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    input.env,
    input.recovery.spaceId
  );
  const spaceAccess = createDispatchContinuationSpaceAccessContext({
    dispatchId: input.recovery.interruptedDispatchId,
    requestContext: input.context,
    sourceSignalId: input.recovery.interruptedSourceSignalId,
    spaceId,
    targetProfileId: input.targetProfileId,
  });
  const forkInterruptedConversation = Boolean(
    input.forkInterruptedConversation ||
      input.recovery.forkInterruptedConversation
  );
  if (
    input.recovery.authorizedContinuationClientMessageId === null ||
    input.requesterProfileId
  ) {
    const currentTarget =
      await requireCurrentAgentProfileWorkContinuationTarget({
        env: input.env,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      });
    const authorized =
      await input.ownerShard.rpcAuthorizeAgentProfileWorkContinuation({
        requesterProfileId: input.requesterProfileId,
        continuationClientMessageId,
        currentAgentControllerRef: currentTarget.agentControllerRef,
        currentBindingId: currentTarget.bindingId,
        currentConfigurationRevision: currentTarget.configurationRevision,
        currentDefaultProjectId: currentTarget.defaultProjectId,
        expectedInterruptedTargetWakeLifecycleId:
          input.recovery.interruptedTargetWakeLifecycleId,
        ...(forkInterruptedConversation
          ? { forkInterruptedConversation: true }
          : {}),
        requireAutomaticForkEligibility: input.requireAutomaticForkEligibility,
        ownerUserId: input.ownerUserId,
        requireAcceptedExecutionTargetRevision: true,
        targetProfileId: input.targetProfileId,
      });
    if (authorized.status !== "authorized") {
      throwAgentProfileWorkContinuationAuthorizationError(authorized.status);
    }
  }
  // Saving the owner's decision and having a safe permit to start replacement
  // work are different facts. This is asked on every attempt, including a retry
  // that reuses a stored authorization, because the cancellation sent with the
  // first one may never have reached the computer.
  const withdrawal = await resolveAgentProfileWorkLocalAttemptWithdrawal({
    expectedInterruptedTargetWakeLifecycleId:
      input.recovery.interruptedTargetWakeLifecycleId,
    ownerShard: input.ownerShard,
    ownerUserId: input.ownerUserId,
    targetProfileId: input.targetProfileId,
  });
  if (withdrawal.status === "requested") {
    return "awaiting_original_stop";
  }
  if (
    withdrawal.status !== "not_started" &&
    withdrawal.status !== "withdrawn"
  ) {
    return "deferred";
  }
  if (input.requireAutomaticForkEligibility) {
    const current =
      runtimeTransportAgentProfileWorkRecoveryReadResponseSchema.parse(
        await readRuntimeTransportAgentProfileWorkRecovery({
          env: input.env,
          ownerUserId: input.ownerUserId,
          requestId: input.context.actorContext.requestId,
          targetProfileId: input.targetProfileId,
        })
      );
    if (
      current.status !== "available" ||
      current.automaticForkEligible !== true ||
      current.interruptedTargetWakeLifecycleId !==
        input.recovery.interruptedTargetWakeLifecycleId
    ) {
      return "deferred";
    }
  }
  await stub.rpcStartUsageExhaustedContinuation({
    continuationClientMessageId,
    context: input.context,
    // The interrupted Wake is the fork source: §4C resolves and verifies the
    // boundary from the source's own history, so the branch never inherits a
    // turn the provider had not settled.
    ...(forkInterruptedConversation
      ? {
          contextSelection: {
            mode: "fork" as const,
            sourceWakeId: input.recovery.interruptedTargetWakeLifecycleId,
          },
        }
      : {}),
    interruptedClientMessageId: input.recovery.interruptedClientMessageId,
    interruptedDispatchId: input.recovery.interruptedDispatchId,
    interruptedSourceSignalId: input.recovery.interruptedSourceSignalId,
    operationId: deterministicIdentity.operationId,
    spaceAccess,
    spaceId,
    targetProfileId: input.targetProfileId,
  });
  return "started";
}
/**
 * Asks the owner shard whether the original attempt is out of the way.
 *
 * Durable Object code propagates after a Worker deploy, so a shard that predates
 * this prerequisite cannot answer it. That is treated as "not yet known", which
 * withholds the replacement and stays retryable, rather than as permission to
 * start a second attempt at the same instruction.
 */
async function resolveAgentProfileWorkLocalAttemptWithdrawal(input: {
  expectedInterruptedTargetWakeLifecycleId: string;
  ownerShard: ReturnType<typeof resolveRuntimeTransportOwnerShard>;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<
  import("@openmeld/schemas/types").RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalResponse
> {
  try {
    return runtimeTransportAgentProfileWorkLocalAttemptWithdrawalResponseSchema.parse(
      await input.ownerShard.rpcRequestAgentProfileWorkLocalAttemptWithdrawal({
        expectedInterruptedTargetWakeLifecycleId:
          input.expectedInterruptedTargetWakeLifecycleId,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
      })
    );
  } catch (error) {
    console.warn(
      "[core.agent_profile_work.local_attempt_withdrawal_unanswered]",
      { error, targetProfileId: input.targetProfileId }
    );
    return { status: "unavailable" };
  }
}
/**
 * Reports the stage a continuation actually reached.
 *
 * The owner's decision is kept either way, so an unstarted attempt is a
 * retryable stage rather than a lost choice. Waiting on the original request is
 * named separately from ordinary unavailability, because "nothing new has
 * started" is the fact the owner needs in order to trust the next click.
 */
function throwUnstartedAgentProfileWorkContinuationError(
  continuation: "awaiting_original_stop" | "deferred" | "started"
): void {
  if (continuation === "started") {
    return;
  }
  throw createCoreRpcHttpError({
    code:
      continuation === "awaiting_original_stop"
        ? "agent_profile_work_recovery.awaiting_original_stop"
        : "agent_profile_work_recovery.temporarily_unavailable",
    reason:
      continuation === "awaiting_original_stop"
        ? "OpenMeld is checking whether the original request stopped on your computer. Nothing new has started yet. Try again in a moment."
        : "OpenMeld is checking this Agent’s paused work. Try again.",
    status: 503,
  });
}
function throwAgentProfileWorkContinuationAuthorizationError(
  status: "needs_attention" | "not_pending" | "unavailable"
): never {
  if (status === "unavailable") {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.temporarily_unavailable",
      reason: "OpenMeld could not prepare this continuation yet. Try again.",
      status: 503,
    });
  }
  if (status === "needs_attention") {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.continuation_unavailable",
      reason:
        "This Agent’s setup changed after the task was interrupted. Review the interrupted work before continuing.",
      status: 409,
    });
  }
  throw createCoreRpcHttpError({
    code: "agent_profile_work_recovery.not_pending",
    reason: "This recovery action is no longer needed.",
    status: 409,
  });
}
async function requireCurrentAgentProfileWorkContinuationTarget(input: {
  env: CoreBindings;
  ownerUserId: string;
  targetProfileId: string;
}): Promise<{
  agentControllerRef: string;
  bindingId: string;
  configurationRevision: number;
  defaultProjectId: string | null;
}> {
  const bindingDb = getPostgresDatabase(input.env);
  if (!bindingDb) {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.temporarily_unavailable",
      reason: "OpenMeld could not verify this Agent’s current setup yet.",
      status: 503,
    });
  }
  const [binding, authScope] = await Promise.all([
    readPrimaryAgentProfileBindingRecord({
      agentProfileId: input.targetProfileId,
      db: bindingDb,
      owner: { id: input.ownerUserId, kind: "owner_account" },
    }),
    resolveAgentProfileWorkRecoveryAuthScope({
      agentProfileId: input.targetProfileId,
      authWorker: input.env.OPENMELD_AUTH_WORKER,
    }),
  ]);
  const agentControllerRef = binding
    ? parseAgentControllerRef(binding.agentControllerRef)
    : null;
  if (
    binding?.bindingState !== "enabled_primary" ||
    binding.runtimeKind !== "openmeld_service" ||
    !agentControllerRef ||
    authScope.status === "invalid" ||
    (authScope.status === "valid" &&
      authScope.scope.ownerUserId !== input.ownerUserId)
  ) {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.continuation_unavailable",
      reason:
        "This Agent’s setup changed after the task was interrupted. Review the interrupted work before continuing.",
      status: 409,
    });
  }
  if (authScope.status !== "valid") {
    throw createCoreRpcHttpError({
      code: "agent_profile_work_recovery.temporarily_unavailable",
      reason: "OpenMeld could not verify this Agent’s current setup yet.",
      status: 503,
    });
  }
  return {
    agentControllerRef: agentControllerRef.ref,
    bindingId: binding.bindingId,
    configurationRevision: binding.configurationRevision,
    defaultProjectId: authScope.scope.defaultProjectId,
  };
}
async function buildAgentProfileWorkContinuationIdentity(input: {
  interruptedClientMessageId: string;
  targetProfileId: string;
}): Promise<{
  continuationClientMessageId: string;
  operationId: string;
}> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        "agent_profile_work_usage_continuation_v1",
        input.targetProfileId,
        input.interruptedClientMessageId,
      ])
    )
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return {
    continuationClientMessageId: `agent-profile-work-continuation-${hex}`,
    operationId: `agent-profile-work-continuation:${hex}`,
  };
}
export async function rpcGetAgentProfileControllerChangeEligibility(
  env: CoreBindings,
  input: GetAgentProfileControllerChangeEligibilityInput
): Promise<GetAgentProfileControllerChangeEligibilityResponse> {
  const { request } = await requireAgentProfileWorkspaceScope(env, input);
  await assertAgentProfileOwnerMatchesRequest({
    agentProfileId: request.agentProfileId,
    env,
    owner: request.owner,
  });
  return await resolveAgentProfileControllerChangeEligibility({
    agentProfileId: request.agentProfileId,
    env,
    ownerUserId: request.owner.id,
    requestId: request.context.actorContext.requestId,
  });
}
// Contract: developing/architecture/agent-transport-contract.md ("Expected Routes Projection")
// One Core-owned projection read replaces the CLI's per-profile
// primary-binding fan-out: owner from auth, runtime resolved from
// deviceId+lane, eligibility (enabled_primary, this runtime, active agent
// profile) decided server-side. Missing/conflict runtime resolution is a
// device-level fact returned with empty lists.
export async function rpcGetLocalRuntimeExpectedRoutes(
  env: CoreBindings,
  input: GetLocalRuntimeExpectedRoutesInput
): Promise<GetLocalRuntimeExpectedRoutesResponse> {
  const context = requireRpcContext(input.context);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  const query = getLocalRuntimeExpectedRoutesQuerySchema.safeParse({
    contractVersion: input.contractVersion,
    deviceId: input.deviceId,
    lane: input.lane,
  });
  if (!query.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: query.error.issues[0]?.message ?? "invalid expected-routes query",
      code: "invalid_payload",
    });
  }
  const db = requireAgentProfileBindingDb(env);
  const result = await readLocalRuntimeExpectedRoutes({
    authWorker: env.OPENMELD_AUTH_WORKER,
    contractVersion: query.data.contractVersion,
    db,
    deviceId: query.data.deviceId,
    ownerUserId,
    lane: query.data.lane as DaemonServiceLane,
  });
  if (result.status === "invalid_identity") {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "runtime identity is invalid",
      code: "invalid_payload",
    });
  }
  if (result.status === "profile_facts_unavailable") {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "agent profile facts are temporarily unavailable",
      code: "profile_facts_unavailable",
    });
  }
  return result.response;
}
export async function rpcDisableAgentProfilePrimaryBinding(
  env: CoreBindings,
  input: DisableAgentProfilePrimaryBindingInput
): Promise<DisableAgentProfilePrimaryBindingResponse> {
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  if (profileOwnerValidation.status !== "valid") {
    return buildDisableAgentProfilePrimaryBindingResponse({
      agentProfileId: request.agentProfileId,
      disabled: false,
      reasonCodes: [profileOwnerValidation.reasonCode],
      status: "unavailable",
    });
  }
  if (!ownersEqual(profileOwnerValidation.owner, request.owner)) {
    return buildDisableAgentProfilePrimaryBindingResponse({
      agentProfileId: request.agentProfileId,
      disabled: false,
      reasonCodes: ["agent_profile_binding.owner_mismatch"],
      status: "unavailable",
    });
  }
  const currentBinding = await readPrimaryAgentProfileBindingRecord({
    db,
    agentProfileId: request.agentProfileId,
    owner: request.owner,
  });
  if (isHostedAgentControllerRef(currentBinding?.agentControllerRef)) {
    return buildDisableAgentProfilePrimaryBindingResponse({
      agentProfileId: request.agentProfileId,
      disabled: false,
      reasonCodes: ["agent_profile_binding.primary_conflict"],
      status: "unavailable",
    });
  }
  let controllerMutationOperationId: string | null = null;
  const controllerMutationAdmission =
    await acquireAgentProfileExecutionTargetMutationAdmission({
      agentProfileId: request.agentProfileId,
      env,
      ownerUserId: request.owner.id,
    });
  if (controllerMutationAdmission.status !== "acquired") {
    return buildDisableAgentProfilePrimaryBindingResponse({
      agentProfileId: request.agentProfileId,
      disabled: false,
      reasonCodes: [
        resolveControllerChangeAdmissionReasonCode(controllerMutationAdmission),
      ],
      status: "unavailable",
    });
  }
  controllerMutationOperationId = controllerMutationAdmission.operationId;
  try {
    const disabledBinding = await disablePrimaryAgentProfileBindingRecord({
      agentProfileId: request.agentProfileId,
      db,
      disabledAtMs: Date.now(),
      owner: request.owner,
      reasonCode: "agent_profile_binding.primary_binding_disabled",
    });
    if (disabledBinding) {
      await notifyRuntimeTransportRouteCatalogChanged({
        affectedProfileIds: [request.agentProfileId],
        env,
        ownerUserId: request.owner.id,
        reason: "agent_profile_binding_changed",
      }).catch((error) => {
        console.warn(
          "[core.agent_profile_binding.route_catalog_notify_failed]",
          {
            event: "core.agent_profile_binding.route_catalog_notify_failed",
            agentProfileId: request.agentProfileId,
            ownerUserId: request.owner.id,
            error: toErrorMessage(error),
          }
        );
      });
    }
    // Reconcile even on a no-op retry: the Binding write may have succeeded
    // before an earlier Inbox projection failed. Keep target-mutation admission
    // until this current-owner read finishes; never clear by an old model id.
    await reconcileAgentModelInbox({
      env,
      ownerUserId: request.owner.id,
      agentProfileId: request.agentProfileId,
      nowMs: Date.now(),
    }).catch((error) =>
      console.warn("[core.model_inbox.reconcile_failed]", {
        agentProfileId: request.agentProfileId,
        error,
      })
    );
    return buildDisableAgentProfilePrimaryBindingResponse({
      agentProfileId: request.agentProfileId,
      disabled: Boolean(disabledBinding),
    });
  } finally {
    if (controllerMutationOperationId) {
      await releaseAgentProfileExecutionTargetMutationAdmission({
        agentProfileId: request.agentProfileId,
        env,
        operationId: controllerMutationOperationId,
        ownerUserId: request.owner.id,
      });
    }
  }
}
export async function rpcGetAgentProfileCreationDefaults(
  env: CoreBindings,
  input: GetAgentProfileCreationDefaultsInput
): Promise<GetAgentProfileCreationDefaultsResponse> {
  const context = requireRpcContext(input.context);
  const organizationId = requireOrganizationId(input.organizationId);
  const agentControllerRef = requireCanonicalAgentControllerRef(
    input.agentControllerRef
  );
  const membership = await requireOrganizationMembershipOrThrow({
    context,
    env,
    organizationId,
  });
  const preference = await readAgentProfileCreationDefaultsRecord({
    agentControllerRef,
    db: requireAgentProfileBindingDb(env),
    organizationId,
    userId: membership.userId,
  });
  const firstUseDefaults = preference
    ? null
    : resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef,
        modelCatalog: readAuthoredModelCatalog(),
      });
  return buildAgentProfileCreationDefaultsResponse({
    agentControllerCollaborationMode:
      preference?.agentControllerCollaborationMode ?? null,
    agentControllerPermissionMode:
      preference?.agentControllerPermissionMode ?? null,
    agentControllerRef,
    defaultProjectId: preference?.defaultProjectId ?? null,
    modelId: preference?.modelId ?? firstUseDefaults?.modelId ?? null,
    openCodePermission: preference?.openCodePermission ?? null,
    organizationId,
    reasoningLevel:
      preference?.reasoningLevel ?? firstUseDefaults?.reasoningLevel ?? null,
    updatedAtMs: preference?.updatedAtMs ?? null,
    userId: membership.userId,
  });
}
export async function rpcSetAgentProfileCreationDefaults(
  env: CoreBindings,
  input: SetAgentProfileCreationDefaultsInput
): Promise<SetAgentProfileCreationDefaultsResponse> {
  const context = requireRpcContext(input.context);
  const organizationId = requireOrganizationId(input.organizationId);
  const agentControllerRef = requireCanonicalAgentControllerRef(
    input.agentControllerRef
  );
  const body = setAgentProfileCreationDefaultsBodySchema.safeParse({
    agentControllerCollaborationMode: input.agentControllerCollaborationMode,
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    defaultProjectId: input.defaultProjectId,
    modelId: input.modelId,
    openCodePermission: input.openCodePermission,
    reasoningLevel: input.reasoningLevel,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        body.error.issues[0]?.message ??
        "invalid Agent Profile creation defaults payload",
      status: 400,
    });
  }
  const membership = await requireOrganizationMembershipOrThrow({
    context,
    env,
    organizationId,
  });
  const db = requireAgentProfileBindingDb(env);
  const preference = await rememberAgentProfileCreationDefaults({
    localComponentsManifest: (
      await readCoreLocalComponentsRelease(env.OPENMELD_CLI_RELEASES)
    ).manifest,
    agentControllerRef,
    db,
    nowMs: Date.now(),
    organizationId,
    selection: {
      ...body.data,
      agentControllerCollaborationMode:
        body.data.agentControllerCollaborationMode ?? null,
    },
    userId: membership.userId,
  });
  return buildAgentProfileCreationDefaultsResponse({
    ...preference,
  });
}
export async function rpcCenterAgentListAgentProfileCreationDefaults(
  env: CoreBindings,
  input: CenterAgentListAgentProfileCreationDefaultsInput
): Promise<CenterAgentListAgentProfileCreationDefaultsResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const body = centerAgentListAgentProfileCreationDefaultsBodySchema.safeParse({
    onBehalfOf: input.onBehalfOf,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        body.error.issues[0]?.message ??
        "invalid Agent Profile creation defaults read payload",
      status: 400,
    });
  }
  if (!body.data.onBehalfOf) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_defaults.represented_member_required",
      reason:
        "Reading Agent Profile creation defaults requires a represented Organization member.",
      status: 403,
    });
  }
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization,
    onBehalfOfProfileId: body.data.onBehalfOf.profileId,
  });
  if (!attribution.onBehalfOf?.userId) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_defaults.represented_member_required",
      reason:
        "Reading Agent Profile creation defaults requires a represented Organization member.",
      status: 403,
    });
  }
  const organizationId = authorization.activeOrganization.organizationId;
  const userId = attribution.onBehalfOf.userId;
  const defaults = await listAgentProfileCreationDefaultsRecords({
    db: requireAgentProfileBindingDb(env),
    organizationId,
    userId,
  });
  return buildListAgentProfileCreationDefaultsResponse({
    defaults,
    organizationId,
    userId,
  });
}
export async function rpcGetCurrentOrganizationDirectory(
  env: CoreBindings,
  input: GetCurrentOrganizationDirectoryInput
): Promise<OrganizationDirectoryResponse> {
  const context = requireRpcContext(input.context);
  const organizationAgent =
    context.actorContext.agentControllerRef ===
    HOSTED_CENTER_AGENT_CONTROLLER_REF
      ? await requireCurrentDesignatedCenterAgentCaller({ context, env })
      : null;
  const activeOrganization = organizationAgent
    ? {
        organizationId: organizationAgent.activeOrganization.organizationId,
        userId: null,
      }
    : await requireActiveOrganizationMembershipOrThrow({ context, env });
  const generatedAt = new Date().toISOString();
  const organizationId = activeOrganization.organizationId;
  const requestId = context.actorContext.requestId;
  const [members, eligibleAgentProfiles] = await Promise.all([
    input.centerAgentOnly
      ? Promise.resolve([])
      : resolveOrganizationDirectoryMembersWithActivity({
          env,
          includeMemberLastActiveAt: input.includeMemberLastActiveAt === true,
          organizationId,
          requestId,
        }),
    resolveEligibleOrganizationAgentProfiles({
      env,
      organizationId,
      requestId,
    }).then((profiles) =>
      input.centerAgentOnly
        ? profiles.filter((profile) => profile.isCenterAgent)
        : profiles
    ),
  ]);
  const runtimeOverview = await resolveOrganizationAgentRuntimeOverview({
    agentProfileWorkRecoveryVersion: input.agentProfileWorkRecoveryVersion,
    eligibleAgentProfiles,
    env,
    generatedAt,
    organizationId,
    requestId,
    viewerUserId: activeOrganization.userId,
  });
  const runtimeByProfileId = new Map(
    runtimeOverview.agentProfiles.map((profile) => [profile.profileId, profile])
  );
  const agentProfiles = eligibleAgentProfiles.map((agent) => {
    const runtime = runtimeByProfileId.get(agent.profileId);
    if (!runtime) {
      throw new Error(
        `missing Organization Agent runtime overview for ${agent.profileId}`
      );
    }
    return {
      ...agent,
      ...(runtime.operationalContext
        ? { operationalContext: runtime.operationalContext }
        : {}),
      readiness: runtime.readiness,
    };
  });
  const response = {
    organizationId,
    generatedAt,
    members,
    agentProfiles,
  };
  const validated = organizationDirectoryResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization directory response: ${validated.error.message}`
    );
  }
  console.info("[core.organization_directory.read]", {
    actorProfileKind: context.actorContext.profileKind,
    agentProfileCount: validated.data.agentProfiles.length,
    event: "organization_directory.read",
    includeMemberLastActiveAt: input.includeMemberLastActiveAt === true,
    memberCount: validated.data.members.length,
    organizationId,
    requestId,
  });
  return validated.data;
}
export async function rpcGetCurrentOrganizationProfileDirectory(
  env: CoreBindings,
  input: GetCurrentOrganizationProfileDirectoryInput
): Promise<OrganizationProfileDirectoryResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const generatedAt = new Date().toISOString();
  const organizationId = activeOrganization.organizationId;
  const requestId = context.actorContext.requestId;
  const [members, eligibleAgentProfiles] = await Promise.all([
    resolveOrganizationDirectoryMembersWithActivity({
      env,
      includeMemberLastActiveAt: input.includeMemberLastActiveAt === true,
      organizationId,
      requestId,
    }),
    resolveEligibleOrganizationAgentProfiles({
      env,
      organizationId,
      requestId,
    }),
  ]);
  const directory = {
    agentProfiles: eligibleAgentProfiles,
    generatedAt,
    members,
    organizationId,
  };
  const activityDb =
    input.includeTaskActivity === true ? getPostgresDatabase(env) : null;
  if (input.includeTaskActivity === true && !activityDb) {
    throw new Error("Agent task activity evidence store is unavailable.");
  }
  const [configurationsByProfileId, directoryWithActivity] = await Promise.all([
    readProfileDirectoryAgentConfigurations({
      agentProfiles: eligibleAgentProfiles,
      includeModelSelection: input.includeModelSelection === true,
      env,
      organizationId,
    }),
    activityDb
      ? withOrganizationAgentTaskActivity({
          db: activityDb,
          overview: directory,
        })
      : directory,
  ]);
  const response = {
    ...directoryWithActivity,
    agentProfiles: directoryWithActivity.agentProfiles.map((profile) => ({
      ...profile,
      agentControllerRef:
        configurationsByProfileId?.get(profile.profileId)?.agentControllerRef ??
        null,
      avatarModelId:
        configurationsByProfileId?.get(profile.profileId)?.modelSelection
          ?.modelId ??
        (configurationsByProfileId?.get(profile.profileId)
          ?.agentControllerRef === "hosted:remote-agent"
          ? getPersonalRemoteAgentDefaultModelId(readModelCatalog())
          : null),
      ...(input.includeModelSelection === true &&
      configurationsByProfileId !== null
        ? {
            modelSelection:
              configurationsByProfileId.get(profile.profileId)
                ?.modelSelection ?? null,
          }
        : {}),
    })),
  };
  const validated =
    organizationProfileDirectoryResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Profile Directory response: ${validated.error.message}`
    );
  }
  console.info("[core.organization_profile_directory.read]", {
    actorProfileKind: context.actorContext.profileKind,
    agentProfileCount: validated.data.agentProfiles.length,
    event: "organization_profile_directory.read",
    includeMemberLastActiveAt: input.includeMemberLastActiveAt === true,
    memberCount: validated.data.members.length,
    organizationId,
    requestId,
  });
  return validated.data;
}
export async function rpcGetCurrentOrganizationAgentRuntimeOverview(
  env: CoreBindings,
  input: GetCurrentOrganizationAgentRuntimeOverviewInput
): Promise<OrganizationAgentRuntimeOverviewResponse> {
  const startedAtMs = Date.now();
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const generatedAt = new Date().toISOString();
  const organizationId = activeOrganization.organizationId;
  const allEligibleAgentProfiles =
    await resolveEligibleOrganizationAgentProfiles({
      env,
      organizationId,
      requestId: context.actorContext.requestId,
    });
  const eligibleAgentProfiles = input.workloadProfileId
    ? allEligibleAgentProfiles.filter(
        (profile) => profile.profileId === input.workloadProfileId
      )
    : allEligibleAgentProfiles;
  if (input.workloadProfileId && eligibleAgentProfiles.length === 0) {
    throw createCoreRpcHttpError({
      status: 404,
      code: "profile.not_found",
      reason: "Agent not found in this Organization.",
    });
  }
  const response = await resolveOrganizationAgentRuntimeOverview({
    includeUsageLimits: input.includeUsageLimits,
    agentProfileWorkRecoveryVersion: input.agentProfileWorkRecoveryVersion,
    eligibleAgentProfiles,
    env,
    generatedAt,
    organizationId,
    requestId: context.actorContext.requestId,
    viewerUserId: activeOrganization.userId,
  });
  let result = response;
  if (input.workloadProfileId) {
    let workload: AgentWorkloadSnapshot;
    try {
      const spaceIds = await listAgentWorkloadSpaceIds({
        db: requireSpaceIndexDb(env),
        organizationId,
        profileId: input.workloadProfileId,
      });
      const snapshots = await mapWithConcurrency(
        spaceIds,
        ORGANIZATION_AGENT_RUNTIME_PROFILE_CONCURRENCY,
        async (spaceId) => {
          const { stub } = resolveRpcSpaceStubOrThrow(env, spaceId);
          return await stub.rpcAgentWorkload({
            spaceId,
            organizationId,
            targetProfileId: input.workloadProfileId as string,
            context: { ...context, activeOrganizationId: organizationId },
          });
        }
      );
      workload = combineAgentWorkloads(snapshots);
    } catch (error) {
      console.warn("[core.agent_workload.unavailable]", {
        organizationId,
        profileId: input.workloadProfileId,
        error: error instanceof Error ? error.message : String(error),
      });
      workload = { status: "unavailable" };
    }
    result = {
      ...result,
      agentProfiles: result.agentProfiles.map((profile) => ({
        ...profile,
        workload,
      })),
    };
  }
  if (input.includeTaskActivity === true) {
    const db = getPostgresDatabase(env);
    if (!db) {
      throw new Error("Agent task activity evidence store is unavailable.");
    }
    result = await withOrganizationAgentTaskActivity({
      db,
      overview: result,
    });
  }
  console.info("[core.organization_agent_runtime_overview.read]", {
    durationMs: Math.max(0, Date.now() - startedAtMs),
    actorProfileKind: context.actorContext.profileKind,
    agentProfileCount: response.agentProfiles.length,
    event: "organization_agent_runtime_overview.read",
    organizationId,
    requestId: context.actorContext.requestId,
  });
  return result;
}
type EligibleOrganizationAgentProfile =
  OrganizationDirectoryAgentProfileIdentity & {
    isCenterAgent: boolean;
  };
async function resolveOrganizationDirectoryMembersWithActivity(input: {
  env: CoreBindings;
  includeMemberLastActiveAt: boolean;
  organizationId: string;
  requestId?: string | null;
}) {
  const [directoryMembers, memberActivity] = await Promise.all([
    resolveOrganizationDirectoryMembers({
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      organizationId: input.organizationId,
      requestId: input.requestId,
    }),
    input.includeMemberLastActiveAt
      ? listOrganizationMemberActivity({
          db: requireIdentityDb(input.env),
          organizationId: input.organizationId,
        })
      : Promise.resolve([]),
  ]);
  const memberActivityByUserId = new Map(
    memberActivity.map((activity) => [activity.userId, activity])
  );
  return directoryMembers.map((member) => {
    const activity = memberActivityByUserId.get(member.userId);
    if (
      !activity ||
      activity.humanProfileId !== member.humanProfile?.profileId
    ) {
      return member;
    }
    return {
      ...member,
      lastActiveAt: new Date(activity.lastActiveAtMs).toISOString(),
    };
  });
}
async function resolveEligibleOrganizationAgentProfiles(input: {
  env: CoreBindings;
  organizationId: string;
  requestId?: string | null;
}): Promise<EligibleOrganizationAgentProfile[]> {
  const db = requireAgentProfileBindingDb(input.env);
  const [centerAgentDesignation, agentProfileProjection] = await Promise.all([
    readCenterAgentDesignationRecord({
      db,
      organizationId: input.organizationId,
    }),
    resolveOrganizationDirectoryAgentProfiles({
      additionalAgentProfileIds: [],
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      organizationId: input.organizationId,
      requestId: input.requestId,
    }),
  ]);
  return agentProfileProjection.organizationAgentProfiles
    .filter((agent) =>
      isAgentProfileEligibleForOrganization({
        managedRole: agent.managedRole,
        profileOrganizationId: agent.organizationId,
        targetOrganizationId: input.organizationId,
      })
    )
    .map((agent) => ({
      ...agent,
      isCenterAgent: centerAgentDesignation?.agentProfileId === agent.profileId,
    }))
    .sort(
      (left, right) =>
        left.profileName.localeCompare(right.profileName, undefined, {
          sensitivity: "base",
        }) || left.profileId.localeCompare(right.profileId)
    );
}
async function readProfileDirectoryAgentConfigurations(input: {
  agentProfiles: readonly EligibleOrganizationAgentProfile[];
  env: CoreBindings;
  organizationId: string;
  includeModelSelection: boolean;
}): Promise<Awaited<
  ReturnType<typeof listPrimaryAgentProfileConfigurations>
> | null> {
  try {
    return await listPrimaryAgentProfileConfigurations({
      profiles: input.agentProfiles,
      includeModelSelection: input.includeModelSelection,
      db: requireAgentProfileBindingDb(input.env),
    });
  } catch (error) {
    console.warn(
      "[core.organization_profile_directory.binding_summary_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        organizationId: input.organizationId,
        profileCount: input.agentProfiles.length,
      }
    );
    return null;
  }
}
const ORGANIZATION_AGENT_RUNTIME_OWNER_CONCURRENCY = 4;
const ORGANIZATION_AGENT_RUNTIME_PROFILE_CONCURRENCY = 8;
async function resolveOrganizationAgentRuntimeOverview(input: {
  includeUsageLimits?: boolean;
  agentProfileWorkRecoveryVersion?: 2;
  eligibleAgentProfiles: readonly EligibleOrganizationAgentProfile[];
  env: CoreBindings;
  generatedAt: string;
  organizationId: string;
  requestId?: string | null;
  viewerUserId: string | null;
}): Promise<OrganizationAgentRuntimeOverviewResponse> {
  const [readinessByProfileId, operationalContextsByProfileId] =
    await Promise.all([
      resolveOrganizationAgentReadinessByProfileId(input),
      readOrganizationDirectoryAgentProfileOperationalContexts({
        eligibleAgentProfiles: input.eligibleAgentProfiles,
        env: input.env,
        requestId: input.requestId,
        viewerUserId: input.viewerUserId,
      }).catch((error) => {
        console.warn(
          "[core.organization_agent_runtime_overview.activity_unavailable]",
          {
            error: error instanceof Error ? error.message : String(error),
            organizationId: input.organizationId,
          }
        );
        return new Map<string, DirectoryOperationalContextRead>();
      }),
    ]);
  const ownerWorkSpaceIds = [
    ...operationalContextsByProfileId.values(),
  ].flatMap(({ exposeWorkReferences, operationalContext }) => {
    if (
      !exposeWorkReferences ||
      (operationalContext.status !== "working" &&
        operationalContext.status !== "paused")
    ) {
      return [];
    }
    return [
      ...(operationalContext.currentWorkReference
        ? [operationalContext.currentWorkReference.spaceId]
        : []),
      ...(operationalContext.queuedWorkReferences ?? []).map(
        (reference) => reference.spaceId
      ),
    ];
  });
  let spaceNamesById = new Map<string, string>();
  try {
    spaceNamesById = await readSpaceIndexNamesByIds({
      db: requireSpaceIndexDb(input.env),
      organizationId: input.organizationId,
      spaceIds: ownerWorkSpaceIds,
    });
  } catch (error) {
    console.warn(
      "[core.organization_agent_runtime_overview.space_names_unavailable]",
      {
        error: error instanceof Error ? error.message : String(error),
        organizationId: input.organizationId,
      }
    );
  }
  const response = {
    agentProfiles: input.eligibleAgentProfiles.map((agent) => {
      const readiness = readinessByProfileId.get(agent.profileId);
      if (!readiness) {
        throw new Error(
          `missing Agent readiness overview for ${agent.profileId}`
        );
      }
      if (agent.isCenterAgent) {
        return { profileId: agent.profileId, readiness };
      }
      const projected = operationalContextsByProfileId.get(agent.profileId);
      return {
        operationalContext:
          projectOrganizationDirectoryAgentProfileOperationalContext({
            exposeRecoveryVersion2: input.agentProfileWorkRecoveryVersion === 2,
            exposeWorkReferences: projected?.exposeWorkReferences === true,
            operationalContext: projected?.operationalContext ?? {
              reasonCode: "runtime_coordinator.operational_context_unavailable",
              status: "checking",
            },
            spaceNamesById,
          }),
        profileId: agent.profileId,
        readiness,
      };
    }),
    generatedAt: input.generatedAt,
    organizationId: input.organizationId,
  };
  const validated =
    organizationAgentRuntimeOverviewResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Agent runtime overview response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function resolveOrganizationAgentReadinessByProfileId(input: {
  includeUsageLimits?: boolean;
  eligibleAgentProfiles: readonly EligibleOrganizationAgentProfile[];
  env: CoreBindings;
  generatedAt: string;
  organizationId: string;
  requestId?: string | null;
  viewerUserId: string | null;
}): Promise<
  ReadonlyMap<
    string,
    OrganizationDirectoryResponse["agentProfiles"][number]["readiness"]
  >
> {
  const profilesByOwner = new Map<
    string | null,
    EligibleOrganizationAgentProfile[]
  >();
  const reads = createAgentExecutionReadinessReads({
    profileFacts: await readAuthProfileFacts({
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      profileIds: input.eligibleAgentProfiles.map(
        (profile) => profile.profileId
      ),
    }),
  });
  for (const profile of input.eligibleAgentProfiles) {
    const profiles = profilesByOwner.get(profile.ownerUserId) ?? [];
    profiles.push(profile);
    profilesByOwner.set(profile.ownerUserId, profiles);
  }
  const ownerResults = await mapWithConcurrency(
    [...profilesByOwner],
    ORGANIZATION_AGENT_RUNTIME_OWNER_CONCURRENCY,
    async ([ownerUserId, profiles]) => {
      const db = getPostgresDatabase(input.env);
      const readinessPreload =
        db && ownerUserId
          ? reads
              .preloadPrimaryBindings({
                db,
                nowMs: Date.parse(input.generatedAt),
                owner: { id: ownerUserId, kind: "owner_account" },
                profileIds: profiles.map((profile) => profile.profileId),
              })
              .catch((error) => {
                // Preserve the per-Profile readiness owner's unavailable outcome.
                // An optional batch preload must not fail the entire Team directory.
                console.warn("[core.organization.readiness_preload_failed]", {
                  ownerUserId,
                  error,
                });
              })
          : null;
      const [preloadedRoutes, preloadedOwnerService] = ownerUserId
        ? await Promise.all([
            lookupRuntimeTransportRoutesBatch({
              blockForgottenDevices: true,
              env: input.env,
              ownerUserId,
              requestId: input.requestId,
              profileIds: profiles.map((profile) => profile.profileId),
            }),
            lookupRuntimeTransportOwnerService({
              blockForgottenDevices: true,
              env: input.env,
              ownerUserId,
              requestId: input.requestId,
            }).catch(() => null),
          ])
        : [null, null];
      const onlineTargets = preloadedRoutes
        ? Object.values(preloadedRoutes.routes).flatMap((route) =>
            route.online
              ? [{ deviceId: route.deviceId, runtimeLane: route.lane }]
              : []
          )
        : [];
      const displayNames =
        preloadedRoutes && ownerUserId
          ? await preloadRuntimeDeviceDisplayNamesForOwner({
              env: input.env,
              ownerUserId,
              targets: onlineTargets,
            })
          : null;
      await readinessPreload;
      return await mapWithConcurrency(
        profiles,
        ORGANIZATION_AGENT_RUNTIME_PROFILE_CONCURRENCY,
        async (agent) => {
          const preloadedRoute = preloadedRoutes
            ? (preloadedRoutes.routes[agent.profileId] ?? null)
            : undefined;
          const readiness = await resolveCoreAgentExecutionReadinessForProfile({
            reads,
            activeOrganizationId: input.organizationId,
            env: input.env,
            generatedAt: input.generatedAt,
            ...(preloadedRoute === undefined
              ? {}
              : { preloadedDaemonRoute: preloadedRoute }),
            ...(preloadedOwnerService === null
              ? {}
              : { preloadedOwnerService }),
            ...(preloadedRoute?.online
              ? {
                  preloadedRuntimeDeviceDisplayName: displayNames
                    ? readPreloadedRuntimeDeviceDisplayName({
                        deviceId: preloadedRoute.deviceId,
                        preloaded: displayNames,
                        runtimeLane: preloadedRoute.lane,
                      })
                    : null,
                }
              : {}),
            profileId: agent.profileId,
          });
          const projectedReadiness =
            buildOrganizationDirectoryAgentExecutionReadinessResponse({
              generatedAt: input.generatedAt,
              isOwner: agent.ownerUserId === input.viewerUserId,
              readiness,
              usageResetAt: await readPublicUsageExhaustedResetAt({
                env: input.env,
                generatedAt: input.generatedAt,
                profileId: agent.profileId,
                readiness,
                reads,
              }),
            });
          if (canReadAgentQuota(input, agent.ownerUserId)) {
            projectedReadiness.usageLimits = await readAgentProfileUsage({
              db: getPostgresDatabase(input.env),
              binding: readiness.primaryBinding,
              reads,
              nowMs: Date.parse(input.generatedAt),
            }).catch((error) => {
              console.warn("[core.agent_profile.usage_unavailable]", {
                profileId: agent.profileId,
                error,
              });
              return [];
            });
          }
          return [agent.profileId, projectedReadiness] as const;
        }
      );
    }
  );
  return new Map(ownerResults.flat());
}
/**
 * Quota numbers are owner-only (member-agent-program.md §4.10); other
 * members see only the public usage reason.
 */
function canReadAgentQuota(
  input: { includeUsageLimits?: boolean; viewerUserId: string | null },
  ownerUserId: string | null
): boolean {
  return (
    input.includeUsageLimits === true &&
    ownerUserId !== null &&
    ownerUserId === input.viewerUserId
  );
}
async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  worker: (input: Input) => Promise<Output>
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), inputs.length) },
      async () => {
        while (nextIndex < inputs.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await worker(inputs[index] as Input);
        }
      }
    )
  );
  return results;
}
type DirectoryOperationalContextRead = {
  exposeWorkReferences: boolean;
  operationalContext: import("@openmeld/schemas/types").RuntimeTransportAgentProfileOperationalContext;
};
async function readOrganizationDirectoryAgentProfileOperationalContexts(input: {
  eligibleAgentProfiles: readonly {
    managedRole: string | null;
    ownerUserId: string | null;
    profileId: string;
  }[];
  env: CoreBindings;
  requestId?: string | null;
  viewerUserId: string | null;
}): Promise<Map<string, DirectoryOperationalContextRead>> {
  const profileIdsByOwner = new Map<string, string[]>();
  for (const profile of input.eligibleAgentProfiles) {
    if (
      profile.managedRole === CENTER_AGENT_MANAGED_ROLE ||
      !profile.ownerUserId
    ) {
      continue;
    }
    const profileIds = profileIdsByOwner.get(profile.ownerUserId) ?? [];
    profileIds.push(profile.profileId);
    profileIdsByOwner.set(profile.ownerUserId, profileIds);
  }
  const resolved = new Map<string, DirectoryOperationalContextRead>();
  await mapWithConcurrency(
    [...profileIdsByOwner],
    ORGANIZATION_AGENT_RUNTIME_OWNER_CONCURRENCY,
    async ([ownerUserId, targetProfileIds]) => {
      const exposeWorkReferences = ownerUserId === input.viewerUserId;
      for (let start = 0; start < targetProfileIds.length; start += 100) {
        const response =
          await readRuntimeTransportAgentProfileOperationalContexts({
            env: input.env,
            includeWorkReferences: exposeWorkReferences,
            ownerUserId,
            requestId: input.requestId,
            targetProfileIds: targetProfileIds.slice(start, start + 100),
          });
        for (const context of response.contexts) {
          resolved.set(context.targetProfileId, {
            exposeWorkReferences,
            operationalContext: context.operationalContext,
          });
        }
      }
    }
  );
  return resolved;
}
export async function rpcGetCurrentOrganizationMemberPresence(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
  }
): Promise<
  import("@openmeld/schemas/types").OrganizationMemberPresenceResponse
> {
  const context = requireRpcContext(input.context);
  const active = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const nowMs = Date.now();
  const [members, online] = await Promise.all([
    resolveOrganizationDirectoryMembers({
      authWorker: env.OPENMELD_AUTH_WORKER,
      organizationId: active.organizationId,
      requestId: context.actorContext.requestId,
    }),
    listOnlineOrganizationMembers({
      db: requireIdentityDb(env),
      organizationId: active.organizationId,
      nowMs,
    }),
  ]);
  return organizationMemberPresenceResponseSchema.parse({
    organizationId: active.organizationId,
    generatedAt: new Date(nowMs).toISOString(),
    members: members.map((member) => ({
      userId: member.userId,
      profileId: member.humanProfile?.profileId ?? null,
      status:
        member.humanProfile?.status === "active" &&
        online.some(
          (row) =>
            row.user_id === member.userId &&
            row.human_profile_id === member.humanProfile?.profileId
        )
          ? "online"
          : "offline",
    })),
  });
}
export async function rpcRecordCurrentOrganizationMemberPresence(
  env: CoreBindings,
  input: RecordCurrentOrganizationMemberPresenceInput
) {
  const report = organizationMemberPresenceBodySchema.safeParse(input.report);
  if (!report.success) {
    throw createCoreRpcHttpError({
      code: "invalid_input",
      reason: "Invalid member presence report.",
      status: 400,
    });
  }
  const { activeOrganization, humanProfileId } =
    await requireCurrentHumanActivityContext(env, input);
  await recordOrganizationMemberPresence({
    db: requireIdentityDb(env),
    organizationId: activeOrganization.organizationId,
    userId: activeOrganization.userId,
    humanProfileId,
    nowMs: Date.now(),
    report: report.data,
  });
  return {
    organizationId: activeOrganization.organizationId,
    userId: activeOrganization.userId,
  };
}
async function requireCurrentHumanActivityContext(
  env: CoreBindings,
  input: RecordCurrentOrganizationWebActivityInput
) {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const humanProfileId = normalizeOptionalText(
    context.actorContext.openMeldProfileId
  );
  if (!humanProfileId || context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "organization.context_required",
      reason: "Web activity requires an authenticated Human Profile.",
      status: 403,
    });
  }
  const members = await resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  const currentMember = members.find(
    (member) => member.userId === activeOrganization.userId
  );
  if (
    currentMember?.humanProfile?.profileId !== humanProfileId ||
    currentMember.humanProfile.status !== "active"
  ) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason: "Web activity requires the member's current Human Profile.",
      status: 409,
    });
  }
  return { context, activeOrganization, humanProfileId };
}
export async function rpcRecordCurrentOrganizationWebActivity(
  env: CoreBindings,
  input: RecordCurrentOrganizationWebActivityInput
): Promise<OrganizationMemberWebActivityResponse> {
  const { context, activeOrganization, humanProfileId } =
    await requireCurrentHumanActivityContext(env, input);
  const nowMs = Date.now();
  if (context.userTimeZoneObservation) {
    await recordUserTimeZoneObservation({
      db: requireIdentityDb(env),
      userId: activeOrganization.userId,
      observation: context.userTimeZoneObservation,
      nowMs,
    });
  }
  try {
    await recordOrganizationMemberActivity({
      db: requireIdentityDb(env),
      humanProfileId,
      lastActiveAtMs: nowMs,
      organizationId: activeOrganization.organizationId,
      updatedAtMs: nowMs,
      userId: activeOrganization.userId,
    });
  } catch (error) {
    console.warn("[core.organization_member_activity.record_failed]", {
      error: error instanceof Error ? error.message : String(error),
      event: "organization_member_activity.record_failed",
      organizationId: activeOrganization.organizationId,
      profileId: humanProfileId,
      requestId: context.actorContext.requestId,
      source: "web",
      userId: activeOrganization.userId,
    });
    throw error;
  }
  const response = organizationMemberWebActivityResponseSchema.parse({
    lastActiveAt: new Date(nowMs).toISOString(),
    organizationId: activeOrganization.organizationId,
    userId: activeOrganization.userId,
  });
  if (input.spaceId) {
    const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
    await stub.rpcRecordMemberWebActivity({
      ...response,
      profileId: humanProfileId,
    });
  }
  console.info("[core.organization_member_activity.recorded]", {
    event: "organization_member_activity.recorded",
    lastActiveAt: response.lastActiveAt,
    organizationId: response.organizationId,
    profileId: humanProfileId,
    requestId: context.actorContext.requestId,
    source: "web",
    userId: response.userId,
  });
  return response;
}
export async function rpcGetCurrentOrganizationMemberOpenMeldServiceStatuses(
  env: CoreBindings,
  input: GetCurrentOrganizationMemberOpenMeldServiceStatusesInput
): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const generatedAt = new Date().toISOString();
  const members = await resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  return await buildOrganizationMemberOpenMeldServiceStatusesResponse({
    env,
    generatedAt,
    memberUserIds: members.map((member) => member.userId),
    organizationId: activeOrganization.organizationId,
  });
}
export async function rpcGetCurrentOrganizationComputers(
  env: CoreBindings,
  input: GetCurrentOrganizationComputersInput
): Promise<OrganizationComputersResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const generatedAt = new Date().toISOString();
  const members = await resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  return await buildOrganizationComputersResponse({
    env,
    generatedAt,
    includeUsageLimits: input.includeUsageLimits === "true",
    memberUserIds: members.map((member) => member.userId),
    organizationId: activeOrganization.organizationId,
  });
}
async function buildOrganizationComputersResponse(input: {
  env: CoreBindings;
  generatedAt: string;
  includeUsageLimits?: boolean;
  memberUserIds: string[];
  organizationId: string;
}): Promise<OrganizationComputersResponse> {
  const { env, generatedAt, memberUserIds, organizationId } = input;
  const nowMs = Date.parse(generatedAt);
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "organization_computers.store_unavailable",
      reason: "Organization computers are temporarily unavailable.",
      status: 503,
    });
  }
  const [devices, targetsByOwner] = await Promise.all([
    listOwnedDeviceRegistryRecordsForUsers({ db, userIds: memberUserIds }),
    listOwnedDeviceExecutionTargetRecordsForUsers({
      db,
      nowMs,
      userIds: memberUserIds,
    }),
  ]);
  const devicesByOwner = Map.groupBy(devices, (device) => device.ownerUserId);
  const localComponentsRelease = await readCoreLocalComponentsRelease(
    env.OPENMELD_CLI_RELEASES
  );
  const response = await listOrganizationComputers({
    generatedAt,
    includeUsageLimits: input.includeUsageLimits,
    lookupMemberComputerInventory: async ({ userId }) => {
      const memberDevices = devicesByOwner.get(userId) ?? [];
      const executionTargets = targetsByOwner.get(userId) ?? [];
      // The registry owns the rows in this projection. Live sessions only
      // enrich registered devices; an owner without devices has no rows.
      if (memberDevices.length === 0) {
        return { devices: memberDevices, executionTargets, liveSessions: [] };
      }
      let liveSessions: Awaited<
        ReturnType<typeof lookupRuntimeTransportOwnerService>
      > | null = null;
      try {
        liveSessions = await lookupRuntimeTransportOwnerService({
          blockForgottenDevices: true,
          env,
          ownerUserId: userId,
        });
      } catch (error) {
        console.warn("[core.organization.computers_service_lookup_failed]", {
          error: error instanceof Error ? error.message : String(error),
          event: "organization.computers_service_lookup_failed",
          organizationId,
          userId,
        });
      }
      return {
        devices: memberDevices,
        executionTargets,
        liveSessions: projectOrganizationComputerLiveSessions({
          generatedAt,
          liveSessions,
          localComponentsRelease,
        }),
      };
    },
    memberUserIds,
    modelCatalog: readModelCatalog(),
    organizationId,
  });
  const validated = organizationComputersResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization computers response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function projectOrganizationComputerLiveSessions(input: {
  generatedAt: string;
  localComponentsRelease: CoreLocalComponentsRelease;
  liveSessions: Awaited<
    ReturnType<typeof lookupRuntimeTransportOwnerService>
  > | null;
}): OrganizationComputerLiveSession[] | null {
  if (input.liveSessions === null) {
    return null;
  }
  if (!input.liveSessions.online) {
    return resolvePeopleComputerConnectionStatus({
      deviceIds: [],
      ownerService: input.liveSessions,
    }).status === "disconnected"
      ? []
      : null;
  }
  return selectCurrentOwnerServiceSessionsByDeviceLane(input.liveSessions).map(
    (session) => {
      const localComponents = resolveLocalComponentUpdateProjection({
        release: input.localComponentsRelease,
        generatedAt: input.generatedAt,
        runtimeLane: session.lane,
        localComponentsStatus: session.capabilities.localComponents ?? null,
        serviceConnected: true,
        serviceVersion: session.serviceVersion ?? null,
      });
      return {
        deviceId: session.deviceId,
        executionCompatibility: session.executionCompatibility,
        openMeldTools: {
          ...(localComponents.maintenance
            ? { maintenance: localComponents.maintenance }
            : {}),
          ...(localComponents.updateOperation
            ? { updateOperation: localComponents.updateOperation }
            : {}),
          cli: {
            installedPackageVersion:
              localComponents.cli.installedPackageVersion,
            latestPackageVersion: localComponents.cli.latestPackageVersion,
            reasonCodes: localComponents.cli.reasonCodes,
            status: localComponents.cli.status,
            updatePolicy: localComponents.cli.updatePolicy,
            wakeBlocked: localComponents.cli.wakeBlocked,
          },
          service: {
            installedVersion: localComponents.service.installedVersion,
            latestVersion: localComponents.service.latestVersion,
            reasonCodes: localComponents.service.reasonCodes,
            requiredVersion: localComponents.service.requiredVersion,
            status: localComponents.service.status,
            updatePolicy: localComponents.service.updatePolicy,
            wakeBlocked: localComponents.service.wakeBlocked,
          },
          skills: {
            reasonCodes: localComponents.skills.reasonCodes,
            status: localComponents.skills.status,
            targetCount: localComponents.skills.targetCount,
            updatePolicy: localComponents.skills.updatePolicy,
            wakeBlocked: localComponents.skills.wakeBlocked,
          },
        },
        serviceUpdateWakeBlocked: localComponents.service.wakeBlocked,
      };
    }
  );
}
async function buildOrganizationMemberOpenMeldServiceStatusesResponse(input: {
  env: CoreBindings;
  generatedAt: string;
  memberUserIds: readonly string[];
  organizationId: string;
}): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
  const localComponentsRelease = await readCoreLocalComponentsRelease(
    input.env.OPENMELD_CLI_RELEASES
  );
  const response = await listOrganizationMemberOpenMeldServiceStatuses({
    generatedAt: input.generatedAt,
    lookupMemberServiceSessions: async ({ userId }) => {
      const ownerService = await lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env: input.env,
        ownerUserId: userId,
      });
      if (!ownerService.online) {
        return [];
      }
      return selectCurrentOwnerServiceSessionsByDeviceLane(ownerService).map(
        (session) => ({
          executionCompatibility: session.executionCompatibility,
          serviceUpdateWakeBlocked: resolveLocalComponentUpdateProjection({
            release: localComponentsRelease,
            generatedAt: input.generatedAt,
            localComponentsStatus: session.capabilities.localComponents ?? null,
            serviceConnected: true,
            serviceVersion: session.serviceVersion ?? null,
          }).service.wakeBlocked,
        })
      );
    },
    memberUserIds: input.memberUserIds,
    onLookupError: ({ error, userId }) => {
      console.warn("[core.organization.member_service_status_lookup_failed]", {
        error: error instanceof Error ? error.message : String(error),
        event: "organization.member_service_status_lookup_failed",
        organizationId: input.organizationId,
        userId,
      });
    },
    organizationId: input.organizationId,
  });
  const validated =
    organizationMemberOpenMeldServiceStatusesResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization member OpenMeld Service statuses response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcGetCurrentOrganizationSpaceDirectory(
  env: CoreBindings,
  input: GetCurrentOrganizationSpaceDirectoryInput
): Promise<OrganizationSpaceDirectoryResponse> {
  const response = await readCurrentOrganizationSpaceDirectoryWithMemberCounts(
    env,
    input
  );
  const compatibilityResponse: OrganizationSpaceDirectoryResponse = {
    generatedAt: response.generatedAt,
    organizationId: response.organizationId,
    spaces: response.spaces.map(
      ({
        activeMemberCount: _activeMemberCount,
        memberPreviews: _memberPreviews,
        ...space
      }) => space
    ),
  };
  const validated = organizationSpaceDirectoryResponseSchema.safeParse(
    compatibilityResponse
  );
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Space directory response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcGetCurrentOrganizationSpaceDirectoryWithMemberCounts(
  env: CoreBindings,
  input: GetCurrentOrganizationSpaceDirectoryInput
): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
  const response = await readCurrentOrganizationSpaceDirectoryWithMemberCounts(
    env,
    input
  );
  const validated =
    organizationSpaceDirectoryWithMemberCountsResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Space directory with member counts response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function readCurrentOrganizationSpaceDirectoryWithMemberCounts(
  env: CoreBindings,
  input: GetCurrentOrganizationSpaceDirectoryInput
): Promise<OrganizationSpaceDirectoryWithMemberCountsResponse> {
  const context = requireRpcContext(input.context);
  const organizationAgent =
    context.actorContext.agentControllerRef ===
    HOSTED_CENTER_AGENT_CONTROLLER_REF
      ? await requireCurrentDesignatedCenterAgentCaller({ context, env })
      : null;
  const directoryCaller = organizationAgent
    ? {
        organizationId: organizationAgent.activeOrganization.organizationId,
        userId: null,
      }
    : await requireActiveOrganizationMembershipOrThrow({ context, env });
  const response = await listOrganizationSpacesFromSpaceIndex({
    db: requireSpaceIndexDb(env),
    generatedAt: new Date().toISOString(),
    includeMemberPreviews: input.includeMemberPreviews,
    limit: ORGANIZATION_SPACE_DIRECTORY_LIMIT,
    organizationId: directoryCaller.organizationId,
    ownerUserId: directoryCaller.userId,
    ...(organizationAgent
      ? { profileId: organizationAgent.actorProfileId }
      : {}),
  });
  return response;
}
export async function rpcJoinOrganizationPublicSpace(
  env: CoreBindings,
  input: JoinOrganizationPublicSpaceInput
): Promise<PostSpaceMembersResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const { joinTarget, spaceId } = await requireActiveOrganizationSpaceTarget({
    env,
    organizationId: activeOrganization.organizationId,
    spaceId: input.spaceId,
  });
  if (joinTarget.visibility !== "public") {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Only public Organization Spaces can be joined this way.",
      code: "space.join.private",
    });
  }
  const member = requireHumanSpaceMemberFromContext({
    context,
    userId: activeOrganization.userId,
  });
  await assertAdditionalMembersCanBeAddedToSpace({
    env,
    members: [member],
    spaceId,
  });
  const { stub } = resolveRpcSpaceStubOrThrow(env, spaceId);
  return await stub.rpcPostMembers({
    spaceId,
    members: [member],
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcAddCenterAgentToSpace(
  env: CoreBindings,
  input: AddCenterAgentToSpaceInput
): Promise<PostSpaceMembersResponse> {
  const body = addCenterAgentToSpaceBodySchema.safeParse({
    expectedCenterAgentProfileId: input.expectedCenterAgentProfileId,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "Invalid Center Agent Space member payload.",
      code: "invalid_payload",
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const { spaceId } = await requireActiveOrganizationSpaceTarget({
    env,
    organizationId: activeOrganization.organizationId,
    spaceId: input.spaceId,
  });
  const designation = await readOrInitializeCenterAgentDesignation({
    activeOrganization,
    context,
    env,
  });
  if (!designation) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "This Organization has no designated Center Agent.",
      code: "center_agent.not_designated",
    });
  }
  if (designation.agentProfileId !== body.data.expectedCenterAgentProfileId) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "The Center Agent changed after this page loaded. Refresh members and try again.",
      code: "center_agent.designation_changed",
    });
  }
  const member = await readResolvedOrganizationSpaceMember({
    db: requireCenterAgentDb(env),
    organizationId: activeOrganization.organizationId,
    profileId: designation.agentProfileId,
  });
  if (!member) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "The Center Agent profile could not be resolved.",
      code: "center_agent.space_member_profile_not_found",
    });
  }
  return await rpcAddSpaceMembers(env, {
    spaceId,
    members: [member],
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcAddOrganizationDirectoryProfilesToSpace(
  env: CoreBindings,
  input: AddOrganizationDirectoryProfilesToSpaceInput
): Promise<PostSpaceMembersResponse> {
  const body = addOrganizationDirectoryProfilesToSpaceBodySchema.safeParse({
    directoryProfileIds: input.directoryProfileIds,
    ...(input.expectedCenterAgentProfileId === undefined
      ? {}
      : {
          expectedCenterAgentProfileId: input.expectedCenterAgentProfileId,
        }),
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "Invalid Organization Directory Space member payload.",
      code: "invalid_payload",
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const { spaceId } = await requireActiveOrganizationSpaceTarget({
    env,
    organizationId: activeOrganization.organizationId,
    spaceId: input.spaceId,
  });
  if (body.data.expectedCenterAgentProfileId) {
    const designation = await readCenterAgentDesignationRecord({
      db: requireIdentityDb(env),
      organizationId: activeOrganization.organizationId,
    });
    if (
      designation?.agentProfileId !== body.data.expectedCenterAgentProfileId
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        reason:
          "The Center Agent changed after this page loaded. Refresh members and try again.",
        code: "center_agent.designation_changed",
      });
    }
  }
  const members = await Promise.all(
    body.data.directoryProfileIds.map(
      async (profileId) =>
        await readResolvedOrganizationDirectorySpaceMember({
          db: requireIdentityDb(env),
          organizationId: activeOrganization.organizationId,
          profileId,
        })
    )
  );
  if (members.some((member) => member === null)) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "One or more selected profiles are no longer available in this Organization. Refresh members and try again.",
      code: "organization_directory.profile_unavailable",
    });
  }
  const resolvedMembers = members.filter(
    (member): member is ResolvedSpaceMemberProfile => member !== null
  );
  return await rpcAddSpaceMembers(env, {
    context,
    members: resolvedMembers,
    requireActorMembership: true,
    ...(input.password === undefined ? {} : { password: input.password }),
    spaceId,
  });
}
async function requireActiveOrganizationSpaceTarget(input: {
  env: CoreBindings;
  organizationId: string;
  spaceId: string;
}) {
  const spaceId = normalizeSpaceId(input.spaceId);
  const joinTarget = await readSpaceIndexOrganizationJoinTarget({
    db: requireSpaceIndexDb(input.env),
    spaceId,
  });
  if (!joinTarget) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Space was not found in the active Organization.",
      code: "space.not_found",
    });
  }
  if (joinTarget.organizationId !== input.organizationId) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Space does not belong to the active Organization.",
      code: "space.organization_mismatch",
    });
  }
  return { joinTarget, spaceId };
}
export async function rpcBeginCurrentMemberConnectorAuthorization(
  env: CoreBindings,
  input: BeginCurrentMemberConnectorAuthorizationInput
): Promise<ConnectorConnection> {
  return await beginConnectorAuthorization({ env, input, scope: "member" });
}
export async function rpcBeginCurrentOrganizationSharedConnectorAuthorization(
  env: CoreBindings,
  input: BeginCurrentOrganizationSharedConnectorAuthorizationInput
): Promise<ConnectorConnection> {
  return await beginConnectorAuthorization({ env, input, scope: "shared" });
}
export async function rpcBeginCurrentOrganizationGitHubAppInstallation(
  env: CoreBindings,
  input: BeginCurrentOrganizationGitHubAppInstallationInput
): Promise<GitHubAppInstallationStartResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  const actorProfileId = normalizeOptionalText(
    context.actorContext.openMeldProfileId
  );
  if (!actorProfileId || context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      status: 403,
      reason:
        "GitHub App installation requires an authenticated human profile.",
      code: "organization.context_required",
    });
  }
  const connection =
    await rpcBeginCurrentOrganizationSharedConnectorAuthorization(env, {
      context,
      expectedOrganizationId: input.expectedOrganizationId,
      service: "github",
    });
  const state = await createGitHubAppInstallationState({
    actorProfileId,
    db: requireConnectorConnectionDb(env),
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    targetConnectionName: connection.connectionName,
    userId: activeOrganization.userId,
  });
  return githubAppInstallationStartResponseSchema.parse({
    connection,
    ...state,
  });
}
export async function rpcBeginGitHubAppInstallationVerification(
  env: CoreBindings,
  input: BeginGitHubAppInstallationVerificationInput
): Promise<GitHubAppInstallationVerificationResponse> {
  const parsedState = githubAppInstallationStateSchema.safeParse(input.state);
  if (!parsedState.success) {
    return { status: "invalid" };
  }
  const result = await beginGitHubAppInstallationVerification({
    db: requireConnectorConnectionDb(env),
    installationId: input.installationId,
    nowMs: Date.now(),
    state: parsedState.data,
  });
  return githubAppInstallationVerificationResponseSchema.parse(result);
}
export async function rpcReadPendingGitHubAppInstallation(
  env: CoreBindings,
  input: ReadPendingGitHubAppInstallationInput
): Promise<PendingGitHubAppInstallation> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  assertSharedConnectorManagementPermission(activeOrganization);
  const pending = await readPendingGitHubAppInstallation({
    db: requireConnectorConnectionDb(env),
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    userId: activeOrganization.userId,
  });
  return pendingGitHubAppInstallationSchema.parse(pending);
}
export async function rpcBeginExistingGitHubAppInstallationVerification(
  env: CoreBindings,
  input: BeginExistingGitHubAppInstallationVerificationInput
): Promise<boolean> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  assertSharedConnectorManagementPermission(activeOrganization);
  return await beginExistingGitHubAppInstallationVerification({
    db: requireConnectorConnectionDb(env),
    installationId: input.installationId,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    userId: activeOrganization.userId,
    verificationConnectionName: input.verificationConnectionName,
  });
}
export async function rpcCompleteGitHubAppInstallation(
  env: CoreBindings,
  input: CompleteGitHubAppInstallationInput
): Promise<boolean> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  assertSharedConnectorManagementPermission(activeOrganization);
  return await completeGitHubAppInstallation({
    db: requireConnectorConnectionDb(env),
    installationId: input.installationId,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    targetConnectionName: input.targetConnectionName,
    userId: activeOrganization.userId,
    verificationConnectionName: input.verificationConnectionName,
  });
}
async function beginConnectorAuthorization(input: {
  env: CoreBindings;
  input: BeginCurrentMemberConnectorAuthorizationInput;
  scope: "member" | "shared";
}): Promise<ConnectorConnection> {
  const { env, scope } = input;
  const context = requireRpcContext(input.input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.input.expectedOrganizationId,
  });
  const service = requireConnectorService(input.input.service);
  if (scope === "shared") {
    assertSharedConnectorManagementPermission(activeOrganization);
  }
  const connectionName =
    scope === "shared"
      ? await createSharedConnectorConnectionName({
          organizationId: activeOrganization.organizationId,
          service,
        })
      : await createConnectorConnectionName({
          organizationId: activeOrganization.organizationId,
          service,
          userId: activeOrganization.userId,
        });
  const db = requireConnectorConnectionDb(env);
  const nowMs = Date.now();
  const pendingConnectionInput = {
    ...(scope === "shared"
      ? {
          auditStatement: prepareSharedConnectorAuditStatement({
            action: "start_shared_app_authorization",
            connectionName,
            context,
            db,
            nowMs,
            organizationId: activeOrganization.organizationId,
          }),
        }
      : {}),
    connectionName,
    db,
    nowMs,
    organizationId: activeOrganization.organizationId,
    service,
    userId: activeOrganization.userId,
  };
  const connection =
    scope === "shared"
      ? await upsertPendingSharedConnectorConnection(pendingConnectionInput)
      : await upsertPendingConnectorConnection(pendingConnectionInput);
  return await toConnectorConnectionDto({
    canDisconnect: true,
    connection,
    env,
  });
}
export async function rpcListCurrentOrganizationConnectorConnections(
  env: CoreBindings,
  input: ListCurrentOrganizationConnectorConnectionsInput
): Promise<ConnectorConnectionListResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  return await listVisibleConnectorConnections({
    activeOrganization,
    db: requireConnectorConnectionDb(env),
    env,
    service:
      input.service === undefined
        ? undefined
        : requireConnectorService(input.service),
  });
}
export async function rpcListCurrentOrganizationConnectorAppRequests(
  env: CoreBindings,
  input: ListCurrentOrganizationConnectorAppRequestsInput
): Promise<ConnectorAppRequestListResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  const requests = await listConnectorAppRequestsForRequester({
    db: requireConnectorConnectionDb(env),
    organizationId: activeOrganization.organizationId,
    requesterUserId: activeOrganization.userId,
  });
  return connectorAppRequestListResponseSchema.parse({
    currentUserId: activeOrganization.userId,
    organizationId: activeOrganization.organizationId,
    requests,
  });
}
export async function rpcCreateCurrentOrganizationConnectorAppRequest(
  env: CoreBindings,
  input: CreateCurrentOrganizationConnectorAppRequestInput
): Promise<ConnectorAppRequestResponse> {
  const parsed = createConnectorAppRequestBodySchema.safeParse({
    providerId: input.providerId,
    providerName: input.providerName,
    requestedCapabilities: input.requestedCapabilities,
    source: input.source,
    useCase: input.useCase,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ?? "Invalid connector App request.",
      status: 400,
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  const request = await upsertConnectorAppRequest({
    db: requireConnectorConnectionDb(env),
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    providerId: parsed.data.providerId ?? null,
    providerName: parsed.data.providerName,
    requestedCapabilities: parsed.data.requestedCapabilities ?? [],
    requesterMemberId: requireActiveOrganizationMemberId(activeOrganization),
    requesterUserId: activeOrganization.userId,
    source: parsed.data.source,
    useCase: parsed.data.useCase ?? null,
  });
  return connectorAppRequestResponseSchema.parse({ request });
}
export async function rpcReconcileCurrentOrganizationConnectorConnections(
  env: CoreBindings,
  input: ReconcileCurrentOrganizationConnectorConnectionsInput
): Promise<ConnectorConnectionListResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  const parsedInput = connectorConnectionReconcileInputSchema.safeParse({
    availableConnectionNames: input.availableConnectionNames,
    service: input.service,
  });
  if (!parsedInput.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsedInput.error.issues[0]?.message ?? "Invalid connector state.",
      code: "invalid_payload",
    });
  }
  const db = requireConnectorConnectionDb(env);
  await reconcileConnectorConnections({
    availableConnectionNames: parsedInput.data.availableConnectionNames,
    db,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    service: parsedInput.data.service,
  });
  return await listVisibleConnectorConnections({
    activeOrganization,
    db,
    env,
    service: parsedInput.data.service,
  });
}
export async function rpcAuthorizeConnectorDisconnect(
  env: CoreBindings,
  input: AuthorizeConnectorDisconnectInput
): Promise<ConnectorConnection> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  requireExpectedConnectorOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
  const scope = input.scope ?? "member";
  const service = requireConnectorService(input.service);
  let connection: ConnectorConnectionRecord | null;
  if (scope === "shared") {
    assertSharedConnectorManagementPermission(activeOrganization);
    connection = await readSharedConnectorConnection({
      db: requireConnectorConnectionDb(env),
      organizationId: activeOrganization.organizationId,
      service,
    });
  } else {
    const targetUserId = requireConnectorUserId(input.userId);
    assertConnectorDisconnectPermission({
      activeOrganization,
      targetUserId,
    });
    connection = await readConnectorConnectionForUser({
      db: requireConnectorConnectionDb(env),
      organizationId: activeOrganization.organizationId,
      service,
      userId: targetUserId,
    });
  }
  if (!connection || connection.status === "disconnected") {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "The connector connection was not found.",
      code: "connector.connection_not_found",
    });
  }
  return await toConnectorConnectionDto({
    canDisconnect: true,
    connection,
    env,
  });
}
export async function rpcCompleteConnectorDisconnect(
  env: CoreBindings,
  input: CompleteConnectorDisconnectInput
): Promise<ConnectorConnection> {
  const authorized = await rpcAuthorizeConnectorDisconnect(env, input);
  const parsedConnectionName = connectorConnectionNameSchema.safeParse(
    input.connectionName
  );
  if (!parsedConnectionName.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid connector connection name.",
      code: "invalid_payload",
    });
  }
  if (authorized.connectionName !== parsedConnectionName.data) {
    throw createCoreRpcHttpError({
      status: 409,
      reason: "The connector connection changed before it was disconnected.",
      code: "connector.connection_changed",
    });
  }
  const context = requireRpcContext(input.context);
  const db = requireConnectorConnectionDb(env);
  const nowMs = Date.now();
  const connection = await markConnectorConnectionDisconnected({
    ...(input.scope === "shared"
      ? {
          auditStatement: prepareSharedConnectorAuditStatement({
            action: "disconnect_shared_app",
            connectionName: parsedConnectionName.data,
            context,
            db,
            nowMs,
            organizationId: authorized.organizationId,
          }),
        }
      : {}),
    connectionName: parsedConnectionName.data,
    db,
    nowMs,
    organizationId: authorized.organizationId,
  });
  return await toConnectorConnectionDto({
    canDisconnect: true,
    connection,
    env,
  });
}
export async function rpcCenterAgentListConnectorServices(
  env: CoreBindings,
  input: Pick<
    CenterAgentResolveConnectorConnectionInput,
    "context" | "requesterUserId" | "includeDelegatedRequester"
  >
) {
  const context = requireRpcContext(input.context);
  const authorization = await requireRemoteAgentToolCaller({ context, env });
  const representedUserId = await resolveRemoteAgentConnectorRequester({
    env,
    authorization,
    service: "github",
    requesterUserId: input.requesterUserId,
    includeDelegatedRequester: input.includeDelegatedRequester,
  });
  let requesterUserId = normalizeOptionalText(input.requesterUserId);
  if ("personalExecution" in authorization) {
    requesterUserId =
      representedUserId ===
      authorization.personalExecution.request.agentProfileOwnerUserId
        ? representedUserId
        : null;
  }
  if (requesterUserId) {
    await requireConnectorRequesterMembership({
      env,
      organizationId: authorization.activeOrganization.organizationId,
      userId: requesterUserId,
    });
  }
  const records = await listConnectorConnections({
    db: requireConnectorConnectionDb(env),
    organizationId: authorization.activeOrganization.organizationId,
  });
  return {
    services: [
      ...new Set(
        records
          .filter(
            (record) =>
              record.status === "active" &&
              (record.scope === "shared" || record.userId === requesterUserId)
          )
          .map((record) => record.service)
      ),
    ],
  };
}

export async function rpcCenterAgentResolveConnectorConnection(
  env: CoreBindings,
  input: CenterAgentResolveConnectorConnectionInput
): Promise<CenterAgentConnectorConnectionSelection> {
  const context = requireRpcContext(input.context);
  const authorization = await requireRemoteAgentToolCaller({
    context,
    env,
  });
  const service = requireConnectorService(input.service);
  const requestedPreference = requireConnectorConnectionPreference(
    input.connectionPreference
  );
  const personal = "personalExecution" in authorization;
  const personalRequest = personal
    ? authorization.personalExecution.request
    : null;
  const representedUserId = await resolveRemoteAgentConnectorRequester({
    env,
    authorization,
    service,
    includeDelegatedRequester: input.includeDelegatedRequester,
    requesterUserId: input.requesterUserId,
  });
  const personalOwnerRequest =
    personalRequest &&
    representedUserId === personalRequest.agentProfileOwnerUserId;
  const binding = await readPluginConnectionExecutionBinding(
    env,
    context,
    service
  );
  const connectionPreference = boundPluginConnectionPreference(
    binding,
    service,
    personal && !personalOwnerRequest ? "shared" : requestedPreference
  );
  if (service === "github" && connectionPreference === "automatic") {
    throw createCoreRpcHttpError({
      code: "connector.github_identity_required",
      reason:
        "GitHub actions must explicitly choose Organization access or the requester's GitHub.",
      status: 400,
    });
  }
  let requesterUserId = normalizeOptionalText(input.requesterUserId);
  if (personal) {
    requesterUserId = personalOwnerRequest ? representedUserId : null;
  }
  if (requesterUserId) {
    await requireConnectorRequesterMembership({
      env,
      organizationId: authorization.activeOrganization.organizationId,
      requestId: context.actorContext.requestId,
      userId: requesterUserId,
    });
  }
  const selected = await selectPluginConnection({
    db: requireConnectorConnectionDb(env),
    organizationId: authorization.activeOrganization.organizationId,
    preference: connectionPreference,
    consumer: personal ? "remote_agent" : "center_agent",
    requesterUserId,
    service,
  });
  assertBoundPluginConnection(binding, service, selected?.connection ?? null);
  await requireDelegatedConnectionSelection({
    env,
    authorization,
    includeDelegatedRequester: input.includeDelegatedRequester,
    connection: selected?.connection ?? null,
  });
  const response = await presentPluginSelection(
    env,
    selected,
    input.includeAccessPolicy
  );
  const unavailableReason = selected
    ? null
    : await resolveConnectorConnectionUnavailableReason({
        db: requireConnectorConnectionDb(env),
        organizationId: authorization.activeOrganization.organizationId,
        preference: connectionPreference,
        requesterUserId,
        service,
      });
  console.info("[core.center_agent.connector_connection_selected]", {
    connectionName: response.connection?.connectionName ?? null,
    connectionOwnerUserId: response.connection?.userId ?? null,
    organizationId: authorization.activeOrganization.organizationId,
    preference: connectionPreference,
    requestId: context.actorContext.requestId ?? null,
    requesterUserId,
    selection: response.selection,
    service: input.service,
    unavailableReason,
  });
  return response;
}
async function presentPluginSelection(
  env: CoreBindings,
  selected: Awaited<ReturnType<typeof selectPluginConnection>>,
  includeAccessPolicy?: true
): Promise<CenterAgentConnectorConnectionSelection> {
  if (!selected) {
    return { connection: null, selection: null };
  }
  return {
    connection: await toConnectorConnectionDto({
      canDisconnect: false,
      connection: selected.connection,
      env,
    }),
    selection: selected.selection,
    ...(includeAccessPolicy ? { permission: selected.permission } : {}),
  };
}
function requireExpectedConnectorOrganization(input: {
  activeOrganizationId: string;
  expectedOrganizationId: string;
}): void {
  const expectedOrganizationId = normalizeOptionalText(
    input.expectedOrganizationId
  );
  if (!expectedOrganizationId) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "The expected Organization is required.",
      status: 400,
    });
  }
  requireExpectedOrganizationContext({
    actualOrganizationId: input.activeOrganizationId,
    errorCode: "connector.organization_context_changed",
    expectedOrganizationId,
  });
}
async function resolveConnectorConnectionUnavailableReason(input: {
  db: PostgresDatabase;
  organizationId: string;
  preference: ConnectorConnectionPreference;
  requesterUserId: string | null;
  service: ConnectorService;
}): Promise<
  | "member_authorization_pending"
  | "shared_authorization_pending"
  | "not_connected"
> {
  if (input.preference !== "shared" && input.requesterUserId) {
    const memberConnection = await readConnectorConnectionForUser({
      db: input.db,
      organizationId: input.organizationId,
      service: input.service,
      userId: input.requesterUserId,
    });
    if (memberConnection?.status === "pending") {
      return "member_authorization_pending";
    }
    if (input.preference === "requester") {
      return "not_connected";
    }
  }
  if (input.preference === "requester") {
    return "not_connected";
  }
  const sharedConnection = await readSharedConnectorConnection({
    db: input.db,
    organizationId: input.organizationId,
    service: input.service,
  });
  return sharedConnection?.status === "pending"
    ? "shared_authorization_pending"
    : "not_connected";
}
export async function rpcGetCenterAgentDesignation(
  env: CoreBindings,
  input: GetCenterAgentDesignationInput
): Promise<GetCenterAgentDesignationResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const designation = await readCenterAgentDesignationRecord({
    db: requireCenterAgentDb(env),
    organizationId: activeOrganization.organizationId,
  });
  const response: GetCenterAgentDesignationResponse = {
    organizationId: activeOrganization.organizationId,
    designation: designation ? toCenterAgentDesignationDto(designation) : null,
    remoteRuntimeAvailability:
      resolveCenterAgentRemoteRuntimeAvailabilityProjection({
        env,
        organizationId: activeOrganization.organizationId,
      }),
    slackConnection: await readCenterAgentSlackConnectionProjection({
      env,
      organizationId: activeOrganization.organizationId,
    }),
  };
  const validated = getCenterAgentDesignationResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent designation response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcGetCenterAgentModel(
  env: CoreBindings,
  input: GetCenterAgentModelInput
): Promise<CenterAgentModelConfigurationResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const binding = await readCenterAgentHostedBindingOrThrow({
    env,
    organizationId: activeOrganization.organizationId,
  });
  return projectCenterAgentModelConfiguration({
    binding,
    canManage: memberRoleHasOrganizationPermission(activeOrganization.role, {
      centerAgent: ["update"],
    }),
    catalog: readModelCatalog(),
    organizationId: activeOrganization.organizationId,
  });
}
export async function rpcUpdateCenterAgentModel(
  env: CoreBindings,
  input: UpdateCenterAgentModelInput
): Promise<UpdateCenterAgentModelResponse> {
  const context = requireRpcContext(input.context);
  const parsed = updateCenterAgentModelBodySchema.safeParse({
    expectedConfigurationRevision: input.expectedConfigurationRevision,
    preference: input.preference,
    reasoningLevel: input.reasoningLevel,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Center Agent model selection is invalid.",
      status: 400,
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { centerAgent: ["update"] },
  });
  const current = await readCenterAgentHostedBindingOrThrow({
    env,
    organizationId: activeOrganization.organizationId,
  });
  let requestedModelId =
    parsed.data.preference.kind === "system_default"
      ? null
      : parsed.data.preference.modelId;
  try {
    const route = resolveCenterAgentModelRouteForBinding({
      binding: {
        configurationRevision: current.configurationRevision,
        modelId: requestedModelId,
        reasoningLevel: parsed.data.reasoningLevel ?? null,
      },
      catalog: readModelCatalog(),
    });
    if (parsed.data.reasoningLevel) {
      // An independent effort belongs to a concrete model, not a moving default.
      requestedModelId = route.modelId;
    }
  } catch (error) {
    throw createCoreRpcHttpError({
      code: "center_agent.model_invalid",
      reason: error instanceof Error ? error.message : "Unsupported model.",
      status: 400,
    });
  }
  const result =
    await compareAndSetPrimaryAgentProfileBindingModelSelectionRecord({
      agentProfileId: current.agentProfileId,
      db: requireAgentProfileBindingDb(env),
      expectedConfigurationRevision: parsed.data.expectedConfigurationRevision,
      modelSelectionPatch: {
        modelId: requestedModelId,
        reasoningLevel: parsed.data.reasoningLevel ?? null,
      },
      owner: current.owner,
      updatedAtMs: Date.now(),
    });
  if (result.status === "conflict") {
    throw createCoreRpcHttpError({
      code: "center_agent.model_configuration_changed",
      reason:
        "The Center Agent model changed in another session. Reload and try again.",
      status: 409,
    });
  }
  if (result.status === "not_found") {
    throw createCoreRpcHttpError({
      code: "center_agent.binding_not_found",
      reason: "The Center Agent hosted runtime Binding is unavailable.",
      status: 409,
    });
  }
  return updateCenterAgentModelResponseSchema.parse({
    ...projectCenterAgentModelConfiguration({
      binding: result.binding,
      canManage: true,
      catalog: readModelCatalog(),
      organizationId: activeOrganization.organizationId,
    }),
    changed: result.status === "updated",
  });
}
export async function rpcGetCenterAgentOperatingState(
  env: CoreBindings,
  input: GetCenterAgentOperatingStateInput
): Promise<GetCenterAgentOperatingStateResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const db = requireCenterAgentDb(env);
  const designation = await readCenterAgentDesignationRecord({
    db,
    organizationId: activeOrganization.organizationId,
  });
  if (!designation) {
    throw createCoreRpcHttpError({
      code: "center_agent.designation_required",
      reason: "This Organization has no designated Center Agent.",
      status: 409,
    });
  }
  return getCenterAgentOperatingStateResponseSchema.parse({
    canChangeOperatingState: memberRoleHasOrganizationPermission(
      activeOrganization.role,
      { centerAgent: ["update"] }
    ),
    operatingState: designation.operatingState,
    organizationId: activeOrganization.organizationId,
    pausedAt:
      designation.pausedAtMs === null
        ? null
        : toIsoDateTime(designation.pausedAtMs),
  });
}
export async function rpcListMessageChannelConnections(
  env: CoreBindings,
  input: ListMessageChannelConnectionsInput
): Promise<MessageChannelConnectionListResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const identityDatabase = requireIdentityDb(env);
  const stateDatabase = getPostgresDatabase(env);
  if (!stateDatabase) {
    throw createCoreRpcHttpError({
      code: "message_channel.store_unavailable",
      reason: "Message Channel connection state is unavailable.",
      status: 503,
    });
  }
  const connections = await listRemoteAgentMessageChannelConnectionProjections({
    identityDb: identityDatabase,
    organizationId: activeOrganization.organizationId,
    stateDb: stateDatabase,
  });
  const resolveProviderAccountEmails =
    createMessageChannelProviderAccountEmailsResolver({
      connections,
      env,
      identityDb: identityDatabase,
      organizationId: activeOrganization.organizationId,
    });
  return messageChannelConnectionListResponseSchema.parse({
    availableLarkPlatformProviders:
      listLarkPlatformProvidersEnabledForOrganization({
        env,
        organizationId: activeOrganization.organizationId,
      }),
    connections,
    identityLinks: await listRemoteAgentMessageChannelIdentityLinkProjections({
      connections,
      identityDb: identityDatabase,
      organizationId: activeOrganization.organizationId,
      resolveProviderAccountEmails,
      stateDb: stateDatabase,
    }),
    organizationId: activeOrganization.organizationId,
  });
}
export async function rpcRequestMessageChannelSetup(
  env: CoreBindings,
  input: RequestMessageChannelSetupInput
): Promise<MessageChannelSetupRequestResponse> {
  const parsed = messageChannelSetupRequestBodySchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "The Channel setup request is invalid.",
      status: 400,
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  if (activeOrganization.role !== "member") {
    throw createCoreRpcHttpError({
      code: "message_channel.setup_request_forbidden",
      reason:
        "Organization owners and admins can set up this Channel directly.",
      status: 403,
    });
  }
  await requireOrganizationForMessageChannels({
    env,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  const enabledLarkProviders = listLarkPlatformProvidersEnabledForOrganization({
    env,
    organizationId: activeOrganization.organizationId,
  });
  if (
    parsed.data.provider !== "slack" &&
    !enabledLarkProviders.includes(parsed.data.provider)
  ) {
    throw createCoreRpcHttpError({
      code: "message_channel.provider_disabled",
      reason: "This Channel provider is unavailable for this Organization.",
      status: 404,
    });
  }
  const db = requireCenterAgentDb(env);
  const stateDatabase = getPostgresDatabase(env);
  if (!stateDatabase) {
    throw createCoreRpcHttpError({
      code: "message_channel.store_unavailable",
      reason: "Message Channel connection state is unavailable.",
      status: 503,
    });
  }
  const connections = await listRemoteAgentMessageChannelConnectionProjections({
    identityDb: db,
    organizationId: activeOrganization.organizationId,
    stateDb: stateDatabase,
  });
  if (
    connections.some(
      (connection) =>
        connection.provider === parsed.data.provider &&
        connection.status === "connected"
    )
  ) {
    throw createCoreRpcHttpError({
      code: "message_channel.setup_request_already_connected",
      reason: `${formatMessageChannelProviderName(parsed.data.provider)} is already connected for this Organization.`,
      status: 409,
    });
  }
  const members = await resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  const requester = members.find(
    (member) => member.userId === activeOrganization.userId
  );
  const recipients = members
    .filter((member) => member.role === "owner" || member.role === "admin")
    .map((member) => member.userId);
  if (!(requester && recipients.length > 0)) {
    throw createCoreRpcHttpError({
      code: "message_channel.setup_request_recipient_unavailable",
      reason:
        "No Organization owner or admin is available to receive this request.",
      status: 503,
    });
  }
  const result = await createMessageChannelSetupRequest({
    db,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    provider: parsed.data.provider,
    recipients,
    requester: {
      displayName: requester.user.name,
      userId: requester.userId,
    },
  });
  return messageChannelSetupRequestResponseSchema.parse({
    organizationId: activeOrganization.organizationId,
    provider: parsed.data.provider,
    ...result,
  });
}
async function resolveMessageChannelSetupRequestsAfterConnection(input: {
  env: CoreBindings;
  db: PostgresDatabase;
  organizationId: string;
  provider: MessageChannelProvider;
  resolvedAtMs: number;
}): Promise<void> {
  try {
    await resolveMessageChannelSetupRequests(input);
    await reconcileChannelAuthorizationUpdates({
      env: input.env,
      organizationId: input.organizationId,
      nowMs: input.resolvedAtMs,
    });
  } catch (error) {
    console.error("[core.message_channel.setup_request_resolution_failed]", {
      error: toErrorMessage(error),
      organizationId: input.organizationId,
      provider: input.provider,
    });
  }
}
export async function rpcDisconnectMessageChannelIdentityLink(
  env: CoreBindings,
  input: DisconnectMessageChannelIdentityLinkInput
): Promise<MessageChannelConnectionListResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const identityLinkId = normalizeOptionalText(input.identityLinkId);
  if (
    !(
      identityLinkId &&
      messageChannelIdentityLinkIdSchema.safeParse(identityLinkId).success
    )
  ) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "The connected account reference is invalid.",
      status: 400,
    });
  }
  const identityDatabase = requireIdentityDb(env);
  const stateDatabase = getPostgresDatabase(env);
  if (!stateDatabase) {
    throw createCoreRpcHttpError({
      code: "message_channel.store_unavailable",
      reason: "Message Channel connection state is unavailable.",
      status: 503,
    });
  }
  const connections = await listRemoteAgentMessageChannelConnectionProjections({
    identityDb: identityDatabase,
    organizationId: activeOrganization.organizationId,
    stateDb: stateDatabase,
  });
  const resolveProviderAccountEmails =
    createMessageChannelProviderAccountEmailsResolver({
      connections,
      env,
      identityDb: identityDatabase,
      organizationId: activeOrganization.organizationId,
    });
  const target = await findRemoteAgentMessageChannelIdentityLinkTarget({
    connections,
    identityDb: identityDatabase,
    identityLinkId,
    organizationId: activeOrganization.organizationId,
    stateDb: stateDatabase,
  });
  if (!target) {
    throw createCoreRpcHttpError({
      code: "message_channel.identity_link_not_found",
      reason: "This connected account no longer exists.",
      status: 404,
    });
  }
  const disconnectingOwnAccount =
    target.openMeldUserId === activeOrganization.userId;
  const canManageOrganizationChannels = memberRoleHasOrganizationPermission(
    activeOrganization.role,
    { channel: ["disconnect"] }
  );
  if (!(disconnectingOwnAccount || canManageOrganizationChannels)) {
    throw createCoreRpcHttpError({
      code: "forbidden",
      reason: "You can disconnect only accounts connected to your profile.",
      status: 403,
    });
  }
  const audit = buildMessageChannelIdentityDisconnectAuditRecord({
    context,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    resourceId: target.id,
  });
  await deleteRemoteAgentMessageChannelIdentityLinkTarget({
    audit,
    identityDb: identityDatabase,
    organizationId: activeOrganization.organizationId,
    stateDb: stateDatabase,
    target,
  });
  return messageChannelConnectionListResponseSchema.parse({
    availableLarkPlatformProviders:
      listLarkPlatformProvidersEnabledForOrganization({
        env,
        organizationId: activeOrganization.organizationId,
      }),
    connections,
    identityLinks: await listRemoteAgentMessageChannelIdentityLinkProjections({
      connections,
      identityDb: identityDatabase,
      organizationId: activeOrganization.organizationId,
      resolveProviderAccountEmails,
      stateDb: stateDatabase,
    }),
    organizationId: activeOrganization.organizationId,
  });
}
function createMessageChannelProviderAccountEmailsResolver(input: {
  connections: readonly MessageChannelConnectionProjection[];
  env: CoreBindings;
  identityDb: PostgresDatabase;
  organizationId: string;
}): MessageChannelProviderAccountEmailsResolver | undefined {
  const slackTeamId = input.connections.find(
    (connection) => connection.provider === "slack"
  )?.externalAccountId;
  if (!slackTeamId) {
    return undefined;
  }
  let botTokenPromise: Promise<string> | null = null;
  return async ({ provider, providerUserIds }) => {
    if (provider !== "slack") {
      return new Map();
    }
    try {
      botTokenPromise ??= resolveSlackBotToken({
        cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
        db: input.identityDb,
        expectedOrganizationId: input.organizationId,
        fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
        slackTeamId,
      });
      const members = await readSlackWorkspaceMembersByIds({
        botToken: await botTokenPromise,
        memberIds: providerUserIds,
      });
      return new Map(
        members.map((member) => [member.slackUserId, member.email] as const)
      );
    } catch (error) {
      const event = "core.message_channel.provider_account_email_read_failed";
      console.error(`[${event}]`, {
        error: toErrorMessage(error),
        event,
        organizationId: input.organizationId,
        provider,
      });
      return new Map();
    }
  };
}
export async function rpcListActiveLarkPlatformRegistrations(
  env: CoreBindings,
  input: ListActiveLarkPlatformRegistrationsInput
): Promise<LarkPlatformActiveRegistrationListResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const stateDatabase = getPostgresDatabase(env);
  if (!stateDatabase) {
    throw createCoreRpcHttpError({
      code: "message_channel.store_unavailable",
      reason: "Message Channel registration state is unavailable.",
      status: 503,
    });
  }
  const providers = listLarkPlatformProvidersEnabledForOrganization({
    env,
    organizationId: activeOrganization.organizationId,
  });
  const viewerProfileId = normalizeOptionalText(
    context.actorContext.openMeldProfileId
  );
  return larkPlatformActiveRegistrationListResponseSchema.parse({
    organizationId: activeOrganization.organizationId,
    registrations: await listRemoteAgentActiveLarkPlatformRegistrations({
      db: stateDatabase,
      organizationId: activeOrganization.organizationId,
      providers,
      viewer: {
        canManage:
          context.actorContext.profileKind === "human" &&
          viewerProfileId !== null &&
          memberRoleHasOrganizationPermission(activeOrganization.role, {
            channel: ["connect"],
          }),
        organizationId: activeOrganization.organizationId,
        profileId: viewerProfileId ?? "",
        userId: activeOrganization.userId,
      },
    }),
  });
}
export async function rpcPreviewMessageChannelIdentityLink(
  env: CoreBindings,
  input: PreviewMessageChannelIdentityLinkInput
): Promise<MessageChannelIdentityLinkPreviewResponse> {
  const context = requireRpcContext(input.context);
  const parsed = messageChannelIdentityLinkPreviewBodySchema.safeParse({
    token: input.token,
  });
  if (!parsed.success) {
    throw createMessageChannelIdentityLinkTokenInvalidError();
  }
  const linkContext = await resolveMessageChannelIdentityLinkContext({
    context,
    env,
    nowMs: Date.now(),
    token: parsed.data.token,
  });
  const existingLink = await readRemoteAgentLarkPlatformIdentityLink({
    connectionId: linkContext.token.connectionId,
    db: linkContext.stateDb,
    provider: linkContext.token.provider,
    providerUserId: linkContext.token.providerUserId,
  });
  return messageChannelIdentityLinkPreviewResponseSchema.parse({
    alreadyMember: Boolean(linkContext.membership.role),
    continuesRequest: linkContext.token.linkPurpose === "continue_request",
    expiresAt: toIsoDateTime(linkContext.token.expiresAtMs),
    organizationId: linkContext.membership.organizationId,
    organizationName: linkContext.membership.organizationName,
    provider: linkContext.token.provider,
    providerUserDisplayName: linkContext.token.providerUserDisplayName,
    providerUserId: linkContext.token.providerUserId,
    openMeldAccountEmail: linkContext.membership.userEmail,
    replacesExistingLink: Boolean(
      existingLink &&
        existingLink.openmeldUserId !== linkContext.membership.userId
    ),
  });
}
export async function rpcConsumeMessageChannelIdentityLink(
  env: CoreBindings,
  input: ConsumeMessageChannelIdentityLinkInput
): Promise<MessageChannelIdentityLinkConsumeResponse> {
  const context = requireRpcContext(input.context);
  const parsed = messageChannelIdentityLinkConsumeBodySchema.safeParse({
    token: input.token,
  });
  if (!parsed.success) {
    throw createMessageChannelIdentityLinkTokenInvalidError();
  }
  const nowMs = Date.now();
  const linkContext = await resolveMessageChannelIdentityLinkContext({
    context,
    env,
    nowMs,
    token: parsed.data.token,
  });
  const claimedToken = linkContext.token.consumedAtMs
    ? linkContext.token
    : await claimRemoteAgentMessageChannelIdentityLinkToken({
        claimedAtMs: nowMs,
        db: linkContext.stateDb,
        token: linkContext.token,
        openmeldUserId: linkContext.membership.userId,
      });
  if (!claimedToken) {
    throw createCoreRpcHttpError({
      code: "message_channel.identity_link_claimed",
      reason:
        "This one-time setup action is already being used by another account.",
      status: 409,
    });
  }
  const ensuredMembership = await ensureMessageChannelIdentityLinkMembership({
    env,
    membership: linkContext.membership,
    provider: linkContext.token.provider,
  });
  const resourceId = await buildMessageChannelIdentityLinkId({
    connectionId: linkContext.token.connectionId,
    provider: linkContext.token.provider,
    providerUserId: linkContext.token.providerUserId,
  });
  const audit = buildMessageChannelIdentityReplacementAuditRecord({
    context,
    nowMs,
    organizationId: ensuredMembership.membership.organizationId,
    resourceId,
  });
  const consumeResult = await consumeRemoteAgentMessageChannelIdentityLinkToken(
    {
      audit,
      consumeNonce: crypto.randomUUID(),
      db: linkContext.stateDb,
      nowMs,
      token: claimedToken,
      openmeldUserId: ensuredMembership.membership.userId,
    }
  );
  if (consumeResult.status === "invalid") {
    throw createMessageChannelIdentityLinkTokenInvalidError();
  }
  let continuationStatus: "not_requested" | "retryable_failure" | "submitted" =
    "not_requested";
  if (claimedToken.linkPurpose === "continue_request") {
    const registry = createConfiguredMessageChannelProviderRegistry({
      db: linkContext.stateDb,
      env,
    });
    if (registry) {
      try {
        continuationStatus =
          await continueMessageChannelIdentityOnboardingRequest({
            connectionId: claimedToken.connectionId,
            continuationAttempt: claimedToken.continuationAttempt,
            db: linkContext.stateDb,
            env,
            nowMs,
            organizationId: claimedToken.organizationId,
            provider: claimedToken.provider,
            providerUserId: claimedToken.providerUserId,
            registry,
            sourceDeliveryId: claimedToken.sourceDeliveryId,
            tokenHash: claimedToken.tokenHash,
            openmeldUserId: ensuredMembership.membership.userId,
          });
      } catch (error) {
        console.error("[core.message_channel.identity_continuation_failed]", {
          error: toErrorMessage(error),
          organizationId: claimedToken.organizationId,
          provider: claimedToken.provider,
          sourceDeliveryId: claimedToken.sourceDeliveryId,
        });
        continuationStatus = "retryable_failure";
      }
    } else {
      continuationStatus = "retryable_failure";
    }
  }
  return messageChannelIdentityLinkConsumeResponseSchema.parse({
    continuationRetryable: continuationStatus === "retryable_failure",
    continued: continuationStatus === "submitted",
    continuesRequest: claimedToken.linkPurpose === "continue_request",
    joinedOrganization: ensuredMembership.joinedOrganization,
    linked: true,
    organizationId: ensuredMembership.membership.organizationId,
    organizationName: ensuredMembership.membership.organizationName,
    provider: linkContext.token.provider,
    providerUserDisplayName: linkContext.token.providerUserDisplayName,
    providerUserId: linkContext.token.providerUserId,
    replacedExistingLink: consumeResult.replacedExistingLink,
    openMeldUserId: ensuredMembership.membership.userId,
  });
}
export async function rpcBeginLarkPlatformRegistration(
  env: CoreBindings,
  input: BeginLarkPlatformRegistrationInput
): Promise<LarkPlatformRegistrationResponse> {
  const request = await requireLarkPlatformRegistrationRequest(env, input);
  try {
    const response = await beginRemoteAgentLarkPlatformRegistration({
      ...request,
      repairExisting: input.mode === "repair",
      reauthorize: input.mode === "reauthorize",
      env,
      restartPending: input.mode === "restart",
    });
    if (response.connection?.status === "connected") {
      await resolveMessageChannelSetupRequestsAfterConnection({
        env,
        db: requireCenterAgentDb(env),
        organizationId: response.organizationId,
        provider: request.provider,
        resolvedAtMs: Date.now(),
      });
    }
    return response;
  } catch (error) {
    throwLarkPlatformRegistrationRpcError(error, request.provider);
  }
}
export async function rpcPollLarkPlatformRegistration(
  env: CoreBindings,
  input: PollLarkPlatformRegistrationInput
): Promise<LarkPlatformRegistrationResponse> {
  const request = await requireLarkPlatformRegistrationRequest(env, input);
  const attemptId = larkPlatformRegistrationAttemptIdSchema.safeParse(
    input.attemptId
  );
  if (!attemptId.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        attemptId.error.issues[0]?.message ??
        "The registration attempt ID is invalid.",
      status: 400,
    });
  }
  try {
    const response = await pollRemoteAgentLarkPlatformRegistration({
      ...request,
      attemptId: attemptId.data,
      env,
    });
    if (response.connection?.status === "connected") {
      await resolveMessageChannelSetupRequestsAfterConnection({
        env,
        db: requireCenterAgentDb(env),
        organizationId: response.organizationId,
        provider: request.provider,
        resolvedAtMs: Date.now(),
      });
    }
    return response;
  } catch (error) {
    throwLarkPlatformRegistrationRpcError(error, request.provider);
  }
}
export async function rpcDisconnectLarkPlatformRegistration(
  env: CoreBindings,
  input: DisconnectLarkPlatformRegistrationInput
): Promise<MessageChannelConnectionListResponse> {
  const request = await requireLarkPlatformRegistrationRequest(env, input, {
    allowPersonalWorkspace: true,
  });
  try {
    const disconnected =
      await disconnectRemoteAgentLarkPlatformRegistration(request);
    if (disconnected) {
      await env.OPENMELD_LARK_CHANNEL_CONNECTOR?.getByName(
        disconnected.id
      ).disconnect();
    }
  } catch (error) {
    throwLarkPlatformRegistrationRpcError(error, request.provider);
  }
  return messageChannelConnectionListResponseSchema.parse({
    availableLarkPlatformProviders:
      listLarkPlatformProvidersEnabledForOrganization({
        env,
        organizationId: request.actor.organizationId,
      }),
    connections: await listRemoteAgentMessageChannelConnectionProjections({
      identityDb: requireIdentityDb(env),
      organizationId: request.actor.organizationId,
      stateDb: request.db,
    }),
    organizationId: request.actor.organizationId,
  });
}
export async function rpcListCenterAgentSessions(
  env: CoreBindings,
  input: ListCenterAgentSessionsInput
): Promise<ListCenterAgentSessionsResponse> {
  const parsed = listCenterAgentSessionsQuerySchema.safeParse({
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Provide a valid chat-list cursor and limit.",
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const human = requireHumanSpaceMemberFromContext({
    context,
    userId: activeOrganization.userId,
  });
  const designation = await readCenterAgentDesignationRecord({
    db: requireCenterAgentDb(env),
    organizationId: activeOrganization.organizationId,
  });
  if (!designation) {
    return {
      generatedAt: new Date().toISOString(),
      organizationId: activeOrganization.organizationId,
      sessions: [],
      nextCursor: null,
    };
  }
  return await listAuthorizedCenterAgentSessions({
    ownerUserId: activeOrganization.userId,
    ...parsed.data,
    db: requireSpaceIndexDb(env),
    organizationId: activeOrganization.organizationId,
    memberProfileId: human.profileId,
    centerAgentProfileId: designation.agentProfileId,
    pairKey: buildDirectMessagePairKey(
      human.profileId,
      designation.agentProfileId
    ),
  });
}
function requireMemberAgentsEnabledForSessions(): void {
  if (!isMemberAgentsEnabled()) {
    throw createCoreRpcHttpError({
      status: 404,
      code: MEMBER_AGENTS_DISABLED_CODE,
      reason: MEMBER_AGENTS_DISABLED_MESSAGE,
    });
  }
}
export async function rpcListAgentDirectMessageSessions(
  env: CoreBindings,
  input: ListAgentDirectMessageSessionsInput
): Promise<ListAgentDirectMessageSessionsResponse> {
  requireMemberAgentsEnabledForSessions();
  const parsed = listAgentDirectMessageSessionsQuerySchema.safeParse({
    agentProfileId: input.agentProfileId,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.archived === undefined ? {} : { archived: input.archived }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Provide a valid Agent, chat-list cursor and limit.",
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const human = requireHumanSpaceMemberFromContext({
    context,
    userId: activeOrganization.userId,
  });
  const agent = await readResolvedOrganizationSpaceMember({
    db: requireCenterAgentDb(env),
    organizationId: activeOrganization.organizationId,
    profileId: parsed.data.agentProfileId,
  });
  if (agent?.profileKind !== "agent") {
    throw createCoreRpcHttpError({
      status: 404,
      code: "direct_message_session.agent_not_found",
      reason: "That Agent is not available in this Organization.",
    });
  }
  return await listAuthorizedAgentDirectMessageSessions({
    db: requireSpaceIndexDb(env),
    organizationId: activeOrganization.organizationId,
    memberProfileId: human.profileId,
    ownerUserId: activeOrganization.userId,
    agentProfileId: agent.profileId,
    pairKey: buildDirectMessagePairKey(human.profileId, agent.profileId),
    limit: parsed.data.limit,
    archived: parsed.data.archived,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
}
/**
 * Resolves the exact Session Space in the caller's current Organization.
 * The Space then checks that the caller is the Human in its Human–Agent pair.
 */
async function requireAgentDirectMessageSessionSpace(input: {
  env: CoreBindings;
  context: CoreRpcContextInput;
  spaceId: string;
}): Promise<{ spaceId: string; organizationId: string }> {
  requireMemberAgentsEnabledForSessions();
  const selector = agentDirectMessageSessionSelectorSchema.safeParse({
    spaceId: input.spaceId,
  });
  if (!selector.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Provide a valid session ID.",
    });
  }
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context: input.context,
    env: input.env,
  });
  requireHumanSpaceMemberFromContext({
    context: input.context,
    userId: activeOrganization.userId,
  });
  const candidate =
    await readCenterAgentDirectMessageProjectionCandidateBySpaceId({
      db: requireSpaceIndexDb(input.env),
      spaceId: selector.data.spaceId,
    });
  if (
    !candidate ||
    candidate.organizationId !== activeOrganization.organizationId ||
    candidate.spacePurpose !== OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
  ) {
    // An unavailable or foreign selection never substitutes another chat.
    throw createCoreRpcHttpError({
      status: 404,
      code: "direct_message_session.not_found",
      reason: "This chat is unavailable. Open a chat you can access.",
    });
  }
  return {
    spaceId: candidate.spaceId,
    organizationId: candidate.organizationId,
  };
}
export async function rpcUpdateAgentDirectMessageSession(
  env: CoreBindings,
  input: UpdateAgentDirectMessageSessionInput
): Promise<UpdateAgentDirectMessageSessionResponse> {
  const parsed = updateAgentDirectMessageSessionBodySchema.safeParse(
    input.update
  );
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Provide a valid chat update.",
    });
  }
  const context = requireRpcContext(input.context);
  const session = await requireAgentDirectMessageSessionSpace({
    env,
    context,
    spaceId: input.spaceId,
  });
  const { stub } = resolveRpcSpaceStubOrThrow(env, session.spaceId);
  const result = await stub.rpcManageDirectMessageSession({
    spaceId: session.spaceId,
    context,
    operation:
      parsed.data.operation === "rename"
        ? { kind: "rename", name: parsed.data.name }
        : { kind: parsed.data.operation },
  });
  if (result.kind !== "updated") {
    throw new Error("Session update returned an unexpected result.");
  }
  return updateAgentDirectMessageSessionResponseSchema.parse({
    spaceId: result.spaceId,
    organizationId: result.organizationId,
    name: result.name,
    archivedAt:
      result.archivedAtMs === null
        ? null
        : new Date(result.archivedAtMs).toISOString(),
  });
}
export async function rpcDeleteAgentDirectMessageSession(
  env: CoreBindings,
  input: DeleteAgentDirectMessageSessionInput
): Promise<DeleteAgentDirectMessageSessionResponse> {
  const context = requireRpcContext(input.context);
  const session = await requireAgentDirectMessageSessionSpace({
    env,
    context,
    spaceId: input.spaceId,
  });
  const { stub } = resolveRpcSpaceStubOrThrow(env, session.spaceId);
  const result = await stub.rpcManageDirectMessageSession({
    spaceId: session.spaceId,
    context,
    operation: { kind: "delete" },
  });
  return deleteAgentDirectMessageSessionResponseSchema.parse({
    spaceId: result.spaceId,
    organizationId: result.organizationId,
    deleted: true,
  });
}
export async function rpcGetCenterAgentDirectMessageSpaceProjection(
  env: CoreBindings,
  input: GetCenterAgentDirectMessageSpaceProjectionInput
): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const projection =
    await readCurrentMemberCenterAgentDirectMessageSpaceProjection({
      activeOrganization,
      context,
      env,
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    });
  const response: GetCenterAgentDirectMessageSpaceProjectionResponse = {
    generatedAt: new Date().toISOString(),
    organizationId: activeOrganization.organizationId,
    projection,
  };
  const validated =
    getCenterAgentDirectMessageSpaceProjectionResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent DM Space projection response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCreateCenterAgentContextManifest(
  env: CoreBindings,
  input: CreateCenterAgentContextManifestInput
): Promise<CreateCenterAgentContextManifestResponse> {
  const parsed = createCenterAgentContextManifestBodySchema.safeParse({
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.maxContextTokens === undefined
      ? {}
      : { maxContextTokens: input.maxContextTokens }),
    source: input.source,
    ...(input.view === undefined ? {} : { view: input.view }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Center Agent context request.",
      status: 400,
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const humanMember = requireHumanSpaceMemberFromContext({
    context,
    userId: activeOrganization.userId,
  });
  const conversation =
    await readCurrentMemberCenterAgentDirectMessageSpaceProjection({
      activeOrganization,
      context,
      env,
      ...(parsed.data.spaceId === undefined
        ? {}
        : { spaceId: parsed.data.spaceId }),
    });
  if (!conversation) {
    throw createCoreRpcHttpError({
      code: "center_agent.context_conversation_required",
      reason:
        "The selected Center Agent conversation is unavailable. Open a conversation you can access before reading its context.",
      status: 404,
    });
  }
  let anchorSignalId: string | null = null;
  if (parsed.data.cursor) {
    try {
      anchorSignalId = decodeCenterAgentContextCursor(
        parsed.data.cursor
      ).signalId;
    } catch (error) {
      throw createCoreRpcHttpError({
        code: "center_agent.context_cursor_invalid",
        reason: error instanceof Error ? error.message : "Invalid cursor.",
        status: 400,
      });
    }
  }
  const signalPage = await rpcListSignals(env, {
    ...(anchorSignalId
      ? {
          afterCount: 0,
          aroundSignalId: anchorSignalId,
          beforeCount: parsed.data.limit + 1,
        }
      : { limit: parsed.data.limit + 1, recent: true }),
    context,
    signalTypes: ["signal.text"],
    spaceId: conversation.spaceId,
  });
  const candidateSignals = anchorSignalId
    ? signalPage.signals.filter((signal) => signal.id !== anchorSignalId)
    : signalPage.signals;
  let projection: CenterAgentContextMessageProjection;
  try {
    projection = await buildCenterAgentContextMessageProjection({
      hasOlderMessages: candidateSignals.length > parsed.data.limit,
      limit: parsed.data.limit,
      maxContextTokens: parsed.data.maxContextTokens,
      signals: candidateSignals,
      spaceId: conversation.spaceId,
    });
  } catch (error) {
    if (error instanceof CenterAgentContextTokenBudgetTooSmallError) {
      throw createCoreRpcHttpError({
        code: error.code,
        reason: error.message,
        status: 422,
      });
    }
    throw error;
  }
  const nowMs = Date.now();
  const manifestId = `center_agent_context_manifest_${crypto.randomUUID()}`;
  const auditEntryId = crypto.randomUUID();
  const db = requireCenterAgentDb(env);
  const attribution = await resolveCenterAgentAttribution({
    actorProfileId: conversation.centerAgentProfileId,
    db,
    onBehalfOfProfileId: humanMember.profileId,
    organizationId: activeOrganization.organizationId,
  });
  await insertCenterAgentContextManifest({
    actorProfileId: conversation.centerAgentProfileId,
    attribution,
    auditEntryId,
    clientName: parsed.data.source.client,
    continuationCursor: projection.continuation.cursor,
    conversationSpaceId: conversation.spaceId,
    db,
    estimatedTokenCount: projection.budget.estimatedTokens,
    includedMessageCount: projection.entries.length,
    manifestId,
    nowMs,
    organizationId: activeOrganization.organizationId,
    requestedByProfileId: humanMember.profileId,
    requestedTokenBudget: parsed.data.maxContextTokens,
    materializations: projection.materializations,
    sourceRefs: projection.sourceRefs,
    truncated: projection.budget.truncated,
    truncationReasons: projection.budget.truncationReasons,
    view: parsed.data.view,
  });
  return validateCenterAgentContextManifestResponse({
    authorization: {
      principal: "authenticated_member",
      scope: "requester_private",
    },
    availableViews: ["messages"],
    budget: projection.budget,
    continuation: projection.continuation,
    entries: projection.entries,
    generatedAt: new Date(nowMs).toISOString(),
    manifestId,
    provenance: {
      auditEntryId,
      contentProjection: "user_visible_space_signals",
    },
    request: { source: parsed.data.source },
    schemaVersion: "center_agent_context_manifest.v1",
    subject: {
      centerAgentProfileId: conversation.centerAgentProfileId,
      conversationId: conversation.spaceId,
      kind: "center_agent_conversation",
      memberProfileId: humanMember.profileId,
      organizationId: activeOrganization.organizationId,
    },
    view: parsed.data.view,
  });
}
export async function rpcCreateCenterAgentContextLoadReceipt(
  env: CoreBindings,
  input: CreateCenterAgentContextLoadReceiptInput
): Promise<CreateCenterAgentContextLoadReceiptResponse> {
  const parsed = createCenterAgentContextLoadReceiptBodySchema.safeParse({
    selection: input.selection,
    source: input.source,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Center Agent context load receipt.",
      status: 400,
    });
  }
  const manifestId = normalizeOptionalText(input.manifestId);
  if (!manifestId) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Center Agent Context Manifest ID is required.",
      status: 400,
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const humanMember = requireHumanSpaceMemberFromContext({
    context,
    userId: activeOrganization.userId,
  });
  const db = requireCenterAgentDb(env);
  const manifest = await readCenterAgentContextManifestForLoadReceipt({
    db,
    manifestId,
    organizationId: activeOrganization.organizationId,
    requestedByProfileId: humanMember.profileId,
  });
  if (!manifest) {
    throw createCoreRpcHttpError({
      code: "center_agent.context_manifest_not_found",
      reason:
        "This Center Agent Context Manifest is unavailable. Request fresh context and report that load instead.",
      status: 404,
    });
  }
  let resolvedSelection: ReturnType<
    typeof resolveCenterAgentContextLoadSelection
  >;
  try {
    resolvedSelection = resolveCenterAgentContextLoadSelection({
      manifestClient: manifest.clientName,
      materializations: manifest.materializations,
      reportedClient: parsed.data.source.client,
      selection: parsed.data.selection,
    });
  } catch (error) {
    if (error instanceof CenterAgentContextLoadReceiptError) {
      throw createCoreRpcHttpError({
        code: error.code,
        reason: error.message,
        status:
          error.code === "center_agent.context_load_selection_duplicate"
            ? 400
            : 409,
      });
    }
    throw error;
  }
  const existing = await readCenterAgentContextLoadReceiptByManifest({
    db,
    manifestId,
    organizationId: activeOrganization.organizationId,
    requestedByProfileId: humanMember.profileId,
  });
  if (existing) {
    return resolveExistingCenterAgentContextLoadReceipt({
      existing,
      requestedClient: parsed.data.source.client,
      selectedEntries: resolvedSelection.selectedEntries,
    });
  }
  const nowMs = Date.now();
  const receiptId = `center_agent_context_load_receipt_${crypto.randomUUID()}`;
  const auditEntryId = crypto.randomUUID();
  const attribution = await resolveCenterAgentAttribution({
    actorProfileId: manifest.actorProfileId,
    db,
    onBehalfOfProfileId: humanMember.profileId,
    organizationId: activeOrganization.organizationId,
  });
  try {
    await insertCenterAgentContextLoadReceipt({
      actorProfileId: manifest.actorProfileId,
      attribution,
      auditEntryId,
      clientName: parsed.data.source.client,
      db,
      estimatedTokenCount: resolvedSelection.estimatedTokens,
      id: receiptId,
      manifestId,
      nowMs,
      organizationId: activeOrganization.organizationId,
      requestedByProfileId: humanMember.profileId,
      selectedEntries: resolvedSelection.selectedEntries,
    });
  } catch (error) {
    const racedReceipt = await readCenterAgentContextLoadReceiptByManifest({
      db,
      manifestId,
      organizationId: activeOrganization.organizationId,
      requestedByProfileId: humanMember.profileId,
    });
    if (racedReceipt) {
      return resolveExistingCenterAgentContextLoadReceipt({
        existing: racedReceipt,
        requestedClient: parsed.data.source.client,
        selectedEntries: resolvedSelection.selectedEntries,
      });
    }
    throw error;
  }
  return buildCenterAgentContextLoadReceiptResponse({
    actorProfileId: manifest.actorProfileId,
    auditEntryId,
    clientName: parsed.data.source.client,
    createdAtMs: nowMs,
    estimatedTokenCount: resolvedSelection.estimatedTokens,
    id: receiptId,
    includedMessageCount: resolvedSelection.selectedEntries.length,
    manifestId,
    organizationId: activeOrganization.organizationId,
    requestedByProfileId: humanMember.profileId,
    selectedEntries: resolvedSelection.selectedEntries,
  });
}
function resolveExistingCenterAgentContextLoadReceipt(input: {
  existing: CenterAgentContextLoadReceiptRecord;
  requestedClient: string;
  selectedEntries: CenterAgentContextLoadReceiptRecord["selectedEntries"];
}): CreateCenterAgentContextLoadReceiptResponse {
  if (
    input.existing.clientName !== input.requestedClient ||
    !areCenterAgentContextLoadSelectionsEqual(
      input.existing.selectedEntries,
      input.selectedEntries
    )
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.context_load_already_recorded",
      reason:
        "This manifest already has a different Context Load Receipt. Request fresh Center Agent context before loading it again.",
      status: 409,
    });
  }
  return buildCenterAgentContextLoadReceiptResponse(input.existing);
}
function buildCenterAgentContextLoadReceiptResponse(
  record: CenterAgentContextLoadReceiptRecord
): CreateCenterAgentContextLoadReceiptResponse {
  const parsed = createCenterAgentContextLoadReceiptResponseSchema.safeParse({
    authorization: {
      principal: "authenticated_member",
      scope: "requester_private",
    },
    provenance: { auditEntryId: record.auditEntryId },
    receipt: {
      client: record.clientName,
      estimatedTokens: record.estimatedTokenCount,
      id: record.id,
      includedMessages: record.includedMessageCount,
      manifestId: record.manifestId,
      selectedEntries: record.selectedEntries,
      status: "loaded",
    },
    recordedAt: new Date(record.createdAtMs).toISOString(),
    schemaVersion: "center_agent_context_load_receipt.v1",
  });
  if (!parsed.success) {
    throw new Error(
      `failed to build Center Agent context load receipt response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}
type RemoteAgentRuntimePolicyRejectionCode = Extract<
  RemoteAgentRuntimeAvailability,
  {
    ok: false;
  }
>["code"];
function resolveCenterAgentRemoteRuntimeAvailabilityProjection(input: {
  env: CoreBindings;
  organizationId: string;
}): CenterAgentRemoteRuntimeAvailability {
  try {
    const availability = resolveRemoteAgentRuntimeAvailability(input);
    if (availability.ok) {
      return { selectable: true };
    }
    return {
      selectable: false,
      reasonCode: mapRemoteAgentRuntimePolicyRejectionCode(availability.code),
    };
  } catch (error) {
    console.warn(
      "[core.center_agent.remote_runtime_policy_projection_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        organizationId: input.organizationId,
      }
    );
    return {
      selectable: false,
      reasonCode: "remote_runtime_policy_unavailable",
    };
  }
}
function mapRemoteAgentRuntimePolicyRejectionCode(
  code: RemoteAgentRuntimePolicyRejectionCode
): CenterAgentRemoteRuntimeAvailabilityReasonCode {
  switch (code) {
    case "remote_agent.runtime_disabled":
      return "remote_runtime_disabled";
    case "remote_agent.organization_blocked":
      return "organization_blocked";
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}
async function readCenterAgentSlackConnectionProjection(input: {
  env: CoreBindings;
  organizationId: string;
}): Promise<NonNullable<GetCenterAgentDesignationResponse["slackConnection"]>> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return {
      connected: false,
      directMessagesReady: false,
      slackTeamId: null,
      workspaceName: null,
    };
  }
  try {
    const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
      db,
      organizationId: input.organizationId,
    });
    const token = binding
      ? await readSlackWorkspaceToken({
          db,
          slackTeamId: binding.slackTeamId,
        })
      : null;
    return {
      connected: Boolean(binding),
      directMessagesReady: hasSlackDirectMessageScopes(
        token?.grantedBotScopes ?? null
      ),
      slackTeamId: binding?.slackTeamId ?? null,
      workspaceName: null,
    };
  } catch (error) {
    console.warn("[core.center_agent.slack_connection_projection_failed]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.organizationId,
    });
    return {
      connected: false,
      directMessagesReady: false,
      slackTeamId: null,
      workspaceName: null,
    };
  }
}
type SlackIdentityLinkContext = {
  membership: SlackIdentityLinkMembershipContext;
  token: Awaited<ReturnType<typeof readSlackIdentityLinkTokenForUser>>;
  workspace: {
    organizationId: string;
    slackTeamId: string;
    workspaceName: string | null;
  };
};
type SlackIdentityLinkMembershipContext = {
  organizationId: string;
  organizationName: string;
  role: string | null;
  userEmail: string;
  userId: string;
};
async function resolveSlackIdentityLinkContext(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  context: CoreRpcContextInput;
  db: PostgresDatabase;
  nowMs: number;
  token: string;
}): Promise<{
  membership: SlackIdentityLinkMembershipContext;
  token: NonNullable<SlackIdentityLinkContext["token"]>;
  workspace: SlackIdentityLinkContext["workspace"];
}> {
  const userId = normalizeOptionalText(
    input.context.actorContext.callerPrincipalId
  );
  if (!userId) {
    throw createCoreRpcHttpError({
      status: 401,
      reason: "Sign in before joining this OpenMeld organization.",
      code: "auth.unauthenticated",
    });
  }
  const tokenHash = await digestSlackIdentityLinkToken(input.token);
  const token = await readSlackIdentityLinkTokenForUser({
    db: input.db,
    nowMs: input.nowMs,
    tokenHash,
    openmeldUserId: userId,
  });
  if (!token) {
    const activeToken = await readActiveSlackIdentityLinkToken({
      db: input.db,
      nowMs: input.nowMs,
      tokenHash,
    });
    if (
      activeToken?.claimedByUserId &&
      activeToken.claimedByUserId !== userId
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        reason:
          "Sign in with the OpenMeld account this connection button is meant for.",
        code: "slack.identity_link_account_required",
      });
    }
    throw createSlackIdentityLinkTokenInvalidError();
  }
  const binding = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId: token.slackTeamId,
  });
  if (!binding) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "This Slack workspace is no longer connected to an OpenMeld organization.",
      code: "slack.workspace_not_connected",
    });
  }
  if (binding.organizationId !== token.organizationId) {
    throw createSlackIdentityLinkTokenInvalidError();
  }
  const membership = await readSlackIdentityLinkMembershipContext({
    authWorker: input.authWorker,
    context: input.context,
    organizationId: token.organizationId,
  });
  if (token.membershipRequirement === "current_member" && !membership.role) {
    throw createCoreRpcHttpError({
      code: "slack.identity_link_membership_required",
      reason:
        "This connection button was created for a current member of this OpenMeld organization, but that membership is no longer active.",
      status: 409,
    });
  }
  return {
    membership,
    token,
    workspace: {
      organizationId: binding.organizationId,
      slackTeamId: binding.slackTeamId,
      workspaceName: null,
    },
  };
}
async function readSlackIdentityLinkMembershipContext(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  context: CoreRpcContextInput;
  organizationId: string;
}): Promise<SlackIdentityLinkMembershipContext> {
  const userId = normalizeOptionalText(
    input.context.actorContext.callerPrincipalId
  );
  if (!userId) {
    throw createCoreRpcHttpError({
      status: 401,
      reason: "Sign in before linking Slack to OpenMeld.",
      code: "auth.unauthenticated",
    });
  }
  const projection = await readOrganizationAccountIdentityProjection({
    account: { kind: "user_id", userId },
    authWorker: input.authWorker,
    organizationId: input.organizationId,
  });
  if (!projection?.ok) {
    throw createCoreRpcHttpError({
      status: 503,
      reason:
        "OpenMeld could not confirm your account because Organization identity is temporarily unavailable.",
      code: "organization.context_unavailable",
    });
  }
  const account = projection.account;
  if (!account) {
    throw createCoreRpcHttpError({
      status: 401,
      reason: "Sign in with an OpenMeld account before linking Slack.",
      code: "auth.unauthenticated",
    });
  }
  return {
    organizationId: input.organizationId,
    organizationName: projection.organization.name,
    role: account.membership?.role ?? null,
    userEmail: account.email,
    userId,
  };
}
async function ensureSlackIdentityLinkMembership(input: {
  env: CoreBindings;
  membership: SlackIdentityLinkMembershipContext;
}): Promise<{
  joinedOrganization: boolean;
  membership: SlackIdentityLinkMembershipContext & {
    role: string;
  };
}> {
  if (input.membership.role) {
    return {
      joinedOrganization: false,
      membership: {
        ...input.membership,
        role: input.membership.role,
      },
    };
  }
  const authResult = await callRequiredAuthWorkerRpc({
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.ensureSlackWorkspaceMemberOrganizationMembership({
        organizationId: input.membership.organizationId,
        userId: input.membership.userId,
      }),
    unavailable: {
      code: "slack.workspace_member_enrollment.unavailable",
      reason: "Joining this OpenMeld organization is temporarily unavailable.",
    },
  });
  const parsed =
    ensureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema.safeParse(
      authResult
    );
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "slack.workspace_member_enrollment.invalid_response",
      reason: "OpenMeld could not verify the organization membership update.",
      status: 502,
    });
  }
  if (!parsed.data.ok) {
    throw createCoreRpcHttpError({
      code: parsed.data.code,
      reason: parsed.data.message,
      status:
        parsed.data.code ===
        "slack.workspace_member_enrollment.email_verification_required"
          ? 403
          : 409,
    });
  }
  if (
    parsed.data.organizationId !== input.membership.organizationId ||
    parsed.data.role.length === 0
  ) {
    throw createCoreRpcHttpError({
      code: "slack.workspace_member_enrollment.identity_mismatch",
      reason: "OpenMeld could not verify the organization membership update.",
      status: 409,
    });
  }
  return {
    joinedOrganization: !parsed.data.alreadyMember,
    membership: {
      ...input.membership,
      organizationName: parsed.data.organizationName,
      role: parsed.data.role,
    },
  };
}
async function requireCurrentSlackIdentityLinkMember(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  slackTeamId: string;
  slackUserId: string;
}): Promise<string> {
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: input.db,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: input.slackTeamId,
  });
  const identity = await readSlackUserIdentity({
    botToken,
    userId: input.slackUserId,
  });
  if (
    !isSlackFullWorkspaceMember({
      identity,
      slackTeamId: input.slackTeamId,
    })
  ) {
    throw createCoreRpcHttpError({
      code: "slack.identity_link_member_ineligible",
      reason:
        "Use a full member account from this connected Slack workspace to continue.",
      status: 403,
    });
  }
  return botToken;
}
function resolveSlackWorkspaceLabel(input: {
  slackTeamId: string;
  workspaceName: string | null;
}): string {
  return normalizeOptionalText(input.workspaceName) ?? input.slackTeamId;
}
function createSlackIdentityLinkTokenInvalidError(): Error {
  return createCoreRpcHttpError({
    status: 409,
    reason: "This Slack link has expired. Ask the Center Agent again in Slack.",
    code: "slack.identity_link_token_invalid",
  });
}
async function writeCenterAgentHumanAuditEntry(input: {
  action: CenterAgentAction;
  context: CoreRpcContextInput;
  db: PostgresDatabase;
  organizationId: string;
  resource: {
    id: string;
    type: string;
  } | null;
}): Promise<void> {
  const actorProfileId = normalizeOptionalText(
    input.context.actorContext.openMeldProfileId
  );
  if (!actorProfileId) {
    return;
  }
  await insertCenterAgentAuditJournalEntry({
    action: input.action,
    actorProfileId,
    attribution: { actorProfileId, onBehalfOf: null },
    db: input.db,
    id: crypto.randomUUID(),
    nowMs: Date.now(),
    organizationId: input.organizationId,
    resource: input.resource,
  });
}
async function assertCenterAgentDesignationVisibleForDispatch(input: {
  agentProfileId: string;
  env: CoreBindings;
  organizationId: string;
}): Promise<void> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Center Agent store is unavailable.",
      code: "center_agent.designation_store_unavailable",
    });
  }
  const designation = await readCenterAgentDesignationRecord({
    db,
    organizationId: input.organizationId,
  });
  if (designation?.agentProfileId !== input.agentProfileId) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Center Agent designation was written but is not visible to dispatch yet. Try again.",
      code: "center_agent.designation_not_ready",
    });
  }
}
function assertRemoteCenterAgentDesignationEnabled(env: CoreBindings): void {
  if (env.OPENMELD_REMOTE_AGENT_DESIGNATION_ENABLED === "true") {
    return;
  }
  throw createCoreRpcHttpError({
    status: 503,
    reason:
      "Remote Agent designation is temporarily paused while OpenMeld finishes a safe runtime update. Try again shortly.",
    code: "center_agent.remote_designation_paused",
  });
}
export async function rpcDesignateCenterAgent(
  env: CoreBindings,
  input: DesignateCenterAgentInput
): Promise<DesignateCenterAgentResponse> {
  const context = requireRpcContext(input.context);
  const body = designateCenterAgentBodySchema.safeParse({
    agentProfileId: input.agentProfileId,
    runtime: input.runtime,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: body.error.issues[0]?.message ?? "invalid designation payload",
      code: "invalid_payload",
    });
  }
  const agentProfileId = body.data.agentProfileId;
  if (!agentProfileId) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "agentProfileId is required for Core Center Agent designation.",
      code: "invalid_payload",
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { centerAgent: ["designate"] },
  });
  const bindingDb = requireAgentProfileBindingDb(env);
  if (body.data.runtime === "remote_agent") {
    await designateRemoteCenterAgentBinding({
      activeOrganization,
      agentProfileId,
      bindingDb,
      context,
      env,
    });
  } else {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Organization Center Agents use the hosted runtime.",
      code: "center_agent.local_runtime_hidden",
    });
  }
  const result = await upsertCenterAgentDesignationRecord({
    agentProfileId,
    db: requireCenterAgentDb(env),
    designatedBy: activeOrganization.userId,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
  });
  await assertCenterAgentDesignationVisibleForDispatch({
    agentProfileId,
    env,
    organizationId: activeOrganization.organizationId,
  });
  const response: DesignateCenterAgentResponse = {
    organizationId: activeOrganization.organizationId,
    designation: toCenterAgentDesignationDto(result.designation),
    status: result.status,
  };
  const validated = designateCenterAgentResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent designation write response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function prepareCenterAgentAvatar(
  env: CoreBindings,
  body: import("@openmeld/schemas/types").CenterAgentUpdateProfileBody,
  profileId: string
) {
  const avatar = body.avatar;
  let avatarStyle: string | undefined = body.avatarStyle;
  let avatarOptions: import("@openmeld/schemas/types").AuthProfileView["avatarOptions"];
  let storedKey: string | undefined;
  if (avatar?.kind === "bot") {
    avatarStyle = avatar.type;
    avatarOptions = { palette: avatar.palette };
  } else if (avatar?.kind === "color") {
    avatarStyle = "fluid";
    avatarOptions = { color: avatar.color };
  } else if (avatar?.kind === "image") {
    const bucket = env.OPENMELD_ACCOUNT_AVATARS;
    if (!(bucket && env.OPENMELD_GATEWAY_URL)) {
      throw createCoreRpcHttpError({
        status: 503,
        code: "center_agent.avatar_unavailable",
        reason: "Image upload is temporarily unavailable.",
      });
    }
    // Gateway has decoded and normalized this to a metadata-free WebP.
    if (!avatar.dataUrl.startsWith("data:image/webp;base64,")) {
      throw createCoreRpcHttpError({
        status: 400,
        code: "invalid_payload",
        reason: "Upload a processed avatar image.",
      });
    }
    const bytes = Uint8Array.from(
      atob(avatar.dataUrl.slice("data:image/webp;base64,".length)),
      (char) => char.charCodeAt(0)
    );
    const address = {
      profileId,
      assetId: crypto.randomUUID(),
    };
    storedKey = buildAccountAvatarObjectKey(address);
    const stored = await bucket.put(storedKey, bytes, {
      httpMetadata: {
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    if (!stored) {
      throw new Error("The avatar image could not be stored.");
    }
    avatarStyle = "custom";
    avatarOptions = {
      imageUrl: new URL(
        buildAccountAvatarPublicPath(address),
        env.OPENMELD_GATEWAY_URL
      ).toString(),
    };
  }
  return { avatarStyle, avatarOptions, storedKey };
}

export async function rpcUpdateCenterAgentProfile(
  env: CoreBindings,
  input: UpdateCenterAgentProfileInput
): Promise<CenterAgentUpdateProfileResponse> {
  const context = requireRpcContext(input.context);
  const body = centerAgentUpdateProfileBodySchema.safeParse({
    profileName: input.profileName,
    avatarStyle: input.avatarStyle,
    avatar: input.avatar,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: body.error.issues[0]?.message ?? "invalid profile payload",
      code: "invalid_payload",
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { centerAgent: ["update"] },
  });
  const db = requireCenterAgentDb(env);
  const designation = await readCenterAgentDesignationRecord({
    db,
    organizationId: activeOrganization.organizationId,
  });
  if (!designation) {
    throw createCoreRpcHttpError({
      status: 409,
      reason: "Designate the Center Agent before updating its profile.",
      code: "center_agent.designation_required",
    });
  }
  const managedProfile = await readManagedCenterAgentProfileByIdForOrganization(
    {
      db,
      organizationId: activeOrganization.organizationId,
      profileId: designation.agentProfileId,
    }
  );
  if (!managedProfile) {
    throw createCoreRpcHttpError({
      status: 409,
      reason: "The current Center Agent profile is unavailable.",
      code: "center_agent.profile_not_found",
    });
  }
  const { avatarStyle, avatarOptions, storedKey } =
    await prepareCenterAgentAvatar(env, body.data, managedProfile.profileId);
  const updated = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.updateCenterAgentProfileInOrganization({
        organizationId: activeOrganization.organizationId,
        profileId: managedProfile.profileId,
        ...(body.data.profileName
          ? { profileName: body.data.profileName }
          : {}),
        ...(avatarStyle
          ? {
              avatarStyle,
              avatarOptions,
              expectedAvatarOptions: managedProfile.avatarOptions ?? null,
            }
          : {}),
      }),
    unavailable: {
      code: "center_agent.profile_update_unavailable",
      reason: "Center Agent profile update is unavailable.",
    },
  });
  if (!updated.ok) {
    if (storedKey) {
      await env.OPENMELD_ACCOUNT_AVATARS?.delete(storedKey);
    }
    throw createCoreRpcHttpError({
      status: updated.code === "profile.not_found" ? 404 : 409,
      reason: updated.message,
      code: `center_agent.${updated.code}`,
    });
  }
  if (
    avatarStyle &&
    managedProfile.avatarOptions?.imageUrl &&
    managedProfile.avatarOptions.imageUrl !== avatarOptions?.imageUrl
  ) {
    const previous = parseAccountAvatarReferenceFromUrl(
      managedProfile.avatarOptions.imageUrl
    );
    if (previous?.profileId === managedProfile.profileId) {
      try {
        await env.OPENMELD_ACCOUNT_AVATARS?.delete(
          buildAccountAvatarObjectKey(previous)
        );
      } catch {
        console.warn("Center Agent previous avatar cleanup failed.", {
          profileId: managedProfile.profileId,
        });
      }
    }
  }
  const response: CenterAgentUpdateProfileResponse = {
    organizationId: activeOrganization.organizationId,
    profile: updated.profile,
  };
  const validated = centerAgentUpdateProfileResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent profile update response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcUpdateCenterAgentOperatingState(
  env: CoreBindings,
  input: UpdateCenterAgentOperatingStateInput
): Promise<UpdateCenterAgentOperatingStateResponse> {
  const context = requireRpcContext(input.context);
  const parsed = updateCenterAgentOperatingStateBodySchema.safeParse({
    operatingState: input.operatingState,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Center Agent operating state is invalid.",
      status: 400,
    });
  }
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const db = requireCenterAgentDb(env);
  if (
    !memberRoleHasOrganizationPermission(activeOrganization.role, {
      centerAgent: ["update"],
    })
  ) {
    throw createCoreRpcHttpError({
      code: "organization.role_required",
      reason:
        "Only Organization owners and admins can pause or resume the Center Agent.",
      status: 403,
    });
  }
  const actorProfileId = normalizeOptionalText(
    context.actorContext.openMeldProfileId
  );
  if (!(actorProfileId && context.actorContext.profileKind === "human")) {
    throw createCoreRpcHttpError({
      code: "center_agent.human_actor_required",
      reason: "Use a Human Profile to pause or resume the Center Agent.",
      status: 403,
    });
  }
  const nowMs = Date.now();
  const result = await updateCenterAgentOperatingStateRecord({
    db,
    nowMs,
    operatingState: parsed.data.operatingState,
    organizationId: activeOrganization.organizationId,
    updatedByUserId: activeOrganization.userId,
  });
  if (!result.designation) {
    throw createCoreRpcHttpError({
      code: "center_agent.designation_required",
      reason: "This Organization has no designated Center Agent.",
      status: 409,
    });
  }
  if (result.changed) {
    await insertCenterAgentAuditJournalEntry({
      action:
        parsed.data.operatingState === "paused"
          ? "pause_center_agent"
          : "resume_center_agent",
      actorProfileId,
      attribution: { actorProfileId, onBehalfOf: null },
      db,
      id: crypto.randomUUID(),
      nowMs,
      organizationId: activeOrganization.organizationId,
      resource: {
        id: result.designation.agentProfileId,
        type: "agent_profile",
      },
    });
  }
  let affectedTaskCount = 0;
  if (parsed.data.operatingState === "paused") {
    try {
      affectedTaskCount = await pauseActiveCenterAgentNativeDeliveries({
        db,
        env,
        organizationId: activeOrganization.organizationId,
        profileId: result.designation.agentProfileId,
      });
    } catch (error) {
      console.error("[core.center_agent.pause_incomplete]", {
        error: toErrorMessage(error),
        event: "core.center_agent.pause_incomplete",
        organizationId: activeOrganization.organizationId,
      });
      throw createCoreRpcHttpError({
        code: "center_agent.pause_incomplete",
        reason:
          "Center Agent is paused, but OpenMeld could not stop every current task. Try again or open diagnostics.",
        status: 503,
      });
    }
  }
  return updateCenterAgentOperatingStateResponseSchema.parse({
    affectedTaskCount,
    canChangeOperatingState: true,
    changed: result.changed,
    operatingState: result.designation.operatingState,
    organizationId: activeOrganization.organizationId,
    pausedAt:
      result.designation.pausedAtMs === null
        ? null
        : toIsoDateTime(result.designation.pausedAtMs),
  });
}
export async function rpcConnectCenterAgentSlackWorkspace(
  env: CoreBindings,
  input: ConnectCenterAgentSlackWorkspaceInput
): Promise<CenterAgentSlackWorkspaceConnectionResponse> {
  const context = requireRpcContext(input.context);
  const parsed = centerAgentSlackWorkspaceConnectBodySchema.safeParse({
    slackTeamId: input.slackTeamId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Slack workspace connection payload",
      code: "invalid_payload",
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { channel: ["connect"] },
  });
  await requireOrganizationForMessageChannels({
    env,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  const db = requireCenterAgentDb(env);
  const result = await createRemoteAgentSlackWorkspaceBinding({
    db,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    slackTeamId: parsed.data.slackTeamId,
  });
  if (result.status === "workspace_already_bound") {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "This Slack workspace is already connected to another OpenMeld organization.",
      code: "slack.workspace_already_bound",
    });
  }
  if (result.status === "organization_already_bound") {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "This OpenMeld organization is already connected to a Slack workspace. Disconnect it before connecting another workspace.",
      code: "slack.organization_already_bound",
    });
  }
  if (result.status === "created") {
    await writeCenterAgentHumanAuditEntry({
      action: "connect_slack_workspace",
      context,
      db,
      organizationId: activeOrganization.organizationId,
      resource: {
        id: result.record.slackTeamId,
        type: "slack_workspace",
      },
    });
  }
  const response: CenterAgentSlackWorkspaceConnectionResponse = {
    organizationId: activeOrganization.organizationId,
    slackConnection: await readCenterAgentSlackConnectionProjection({
      env,
      organizationId: activeOrganization.organizationId,
    }),
  };
  const validated =
    centerAgentSlackWorkspaceConnectionResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Slack connection response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCreateSlackOAuthState(
  env: CoreBindings,
  input: CreateSlackOAuthStateInput
): Promise<SlackOAuthStateCreateResponse> {
  const context = requireRpcContext(input.context);
  const purpose = input.purpose ?? "organization_install";
  let activeOrganization: Awaited<
    ReturnType<typeof requireOrganizationPermission>
  >;
  if (purpose === "member_identity") {
    const membership = await resolveActiveOrganizationMembership({
      context,
      env,
    });
    if ("ok" in membership && !membership.ok) {
      throw createCoreRpcHttpError({
        code: membership.code,
        reason: membership.message,
        status: membership.status,
      });
    }
    activeOrganization = membership;
  } else {
    activeOrganization = await requireOrganizationPermission({
      context,
      env,
      permissions: { channel: ["connect"] },
    });
  }
  await requireOrganizationForMessageChannels({
    env,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  const actorProfileId = normalizeOptionalText(
    context.actorContext.openMeldProfileId
  );
  if (!actorProfileId || context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Slack OAuth requires an authenticated human profile.",
      code: "organization.context_required",
    });
  }
  const db = requireCenterAgentDb(env);
  const slackBinding =
    purpose === "member_identity"
      ? await readRemoteAgentSlackWorkspaceBindingByOrganization({
          db,
          organizationId: activeOrganization.organizationId,
        })
      : null;
  if (purpose === "member_identity" && !slackBinding) {
    throw createCoreRpcHttpError({
      code: "slack.workspace_not_connected",
      reason: "This Organization has not connected Slack yet.",
      status: 409,
    });
  }
  const organizationSlug = await readOrganizationRouteSlug({
    env,
    organizationId: activeOrganization.organizationId,
    requestId: context.actorContext.requestId,
  });
  if (!organizationSlug) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "The active Organization route could not be resolved.",
      code: "organization.context_unavailable",
    });
  }
  const result = await createSlackOAuthState({
    actorProfileId,
    db,
    moveFromOrganizationId: normalizeOptionalText(input.moveFromOrganizationId),
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    purpose,
    returnPath:
      purpose === "member_identity"
        ? buildSlackOAuthPeopleReturnPath(organizationSlug)
        : buildSlackOAuthChannelsReturnPath(organizationSlug),
    userId: activeOrganization.userId,
  });
  return slackOAuthStateCreateResponseSchema.parse({
    ...result,
    purpose,
    slackTeamId: slackBinding?.slackTeamId ?? null,
  });
}
export async function rpcConsumeSlackOAuthState(
  env: CoreBindings,
  input: ConsumeSlackOAuthStateInput
): Promise<SlackOAuthStateConsumeResponse> {
  const parsedState = slackOAuthStateSchema.safeParse(input.state);
  if (!parsedState.success) {
    return { status: "invalid" };
  }
  const result = await consumeSlackOAuthState({
    db: requireCenterAgentDb(env),
    nowMs: Date.now(),
    state: parsedState.data,
  });
  return slackOAuthStateConsumeResponseSchema.parse(result);
}
export async function rpcInstallSlackWorkspaceFromOAuth(
  env: CoreBindings,
  input: InstallSlackWorkspaceFromOAuthInput
): Promise<SlackOAuthInstallationResult> {
  const parsed = slackOAuthInstallationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Slack OAuth installation payload.",
      code: "invalid_payload",
    });
  }
  const db = requireCenterAgentDb(env);
  const authorization = await resolveOrganizationOwnerOrAdminMembership({
    env,
    organizationId: parsed.data.organizationId,
    requestId: null,
    userId: parsed.data.installedByUserId,
  });
  if (!authorization.ok) {
    throw createCoreRpcHttpError({
      code: authorization.code,
      reason: authorization.message,
      status: authorization.status,
    });
  }
  await requireOrganizationForMessageChannels({
    env,
    organizationId: parsed.data.organizationId,
    requestId: null,
  });
  const cryptoKey = normalizeOptionalText(env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY);
  if (!cryptoKey) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Slack workspace token encryption is unavailable.",
      code: "slack.token_crypto_unavailable",
    });
  }
  const nowMs = Date.now();
  const result = await installSlackWorkspaceFromOAuth({
    actorProfileId: parsed.data.actorProfileId,
    auditEntryId: crypto.randomUUID(),
    botScopes: parsed.data.botScopes,
    botToken: parsed.data.botToken,
    botUserId: parsed.data.botUserId,
    cryptoKey,
    db,
    installedByUserId: parsed.data.installedByUserId,
    moveAuditEntryId: parsed.data.moveFromOrganizationId
      ? crypto.randomUUID()
      : null,
    moveFromOrganizationId: parsed.data.moveFromOrganizationId,
    nowMs,
    organizationId: parsed.data.organizationId,
    slackInstallerUserId: parsed.data.slackInstallerUserId,
    slackTeamId: parsed.data.slackTeamId,
    welcomePreparationRecipientSlackUserId: parsed.data.slackInstallerUserId,
  });
  if ("record" in result && parsed.data.slackInstallerUserId) {
    const key = {
      connectionCreatedAtMs: result.record.createdAtMs,
      organizationId: parsed.data.organizationId,
      recipientSlackUserId: parsed.data.slackInstallerUserId,
      slackTeamId: parsed.data.slackTeamId,
      welcomeVersion: SLACK_INSTALLATION_WELCOME_VERSION,
    };
    if (result.status === "unchanged") {
      const retryAuthorized =
        await authorizeFailedSlackInstallationWelcomeRetry({ db, key, nowMs });
      if (!retryAuthorized) {
        await enqueueSlackInstallationWelcomePreparation({
          allowCreate: true,
          connectionCreatedAtMs: result.record.createdAtMs,
          db,
          installedByProfileId: parsed.data.actorProfileId,
          installedByUserId: parsed.data.installedByUserId,
          messageKind: parsed.data.moveFromOrganizationId
            ? "moved"
            : "connected",
          nowMs,
          organizationId: parsed.data.organizationId,
          recipientSlackUserId: parsed.data.slackInstallerUserId,
          slackTeamId: parsed.data.slackTeamId,
        });
      }
    }
  }
  if ("record" in result) {
    await resolveMessageChannelSetupRequestsAfterConnection({
      env,
      db,
      organizationId: parsed.data.organizationId,
      provider: "slack",
      resolvedAtMs: nowMs,
    });
  }
  const response: SlackOAuthInstallationResult =
    "existing" in result
      ? { existing: result.existing, status: result.status }
      : { status: result.status };
  return slackOAuthInstallationResultSchema.parse(response);
}
export async function rpcIssueSlackIdentityLinkFromOAuth(
  env: CoreBindings,
  input: IssueSlackIdentityLinkFromOAuthInput
): Promise<SlackOAuthIdentityLinkResult> {
  const parsed = slackOAuthIdentityLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Slack identity authorization payload.",
      status: 400,
    });
  }
  const membership = await resolveOrganizationMembershipById({
    env,
    organizationId: parsed.data.organizationId,
    requestId: null,
    userId: parsed.data.userId,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  const db = requireCenterAgentDb(env);
  const binding = await readRemoteAgentSlackWorkspaceBinding({
    db,
    slackTeamId: parsed.data.slackTeamId,
  });
  if (binding?.organizationId !== parsed.data.organizationId) {
    throw createCoreRpcHttpError({
      code: "slack.identity_workspace_mismatch",
      reason:
        "The authorized Slack account does not belong to this Organization's connected workspace.",
      status: 409,
    });
  }
  const token = createSlackIdentityLinkToken();
  const issuedAtMs = Date.now();
  const insertion = await insertSlackIdentityLinkToken({
    claimedByUserId: parsed.data.userId,
    db,
    deliveryScope: "slack_oidc",
    expiresAtMs: issuedAtMs + SLACK_IDENTITY_LINK_TOKEN_TTL_MS,
    issuedAtMs,
    organizationId: parsed.data.organizationId,
    slackTeamId: parsed.data.slackTeamId,
    slackUserDisplayName: parsed.data.slackAccountEmail,
    slackUserId: parsed.data.slackUserId,
    sourceDeliveryId: null,
    tokenHash: await digestSlackIdentityLinkToken(token),
  });
  if (insertion.status !== "inserted") {
    throw new Error("Slack identity authorization token was not inserted");
  }
  const organizationSlug = await readOrganizationRouteSlug({
    env,
    organizationId: parsed.data.organizationId,
    requestId: null,
  });
  if (!organizationSlug) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason: "The Organization route could not be resolved.",
      status: 503,
    });
  }
  return slackOAuthIdentityLinkResultSchema.parse({
    openMeldProfileId: parsed.data.actorProfileId,
    organizationSlug,
    token,
  });
}
export async function runSlackInstallationWelcomePreparationTick(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  nowMs: number;
}): Promise<void> {
  await advanceSlackInstallationWelcomePreparations({
    ...input,
    startResearch: async (preparation) =>
      await startSlackInstallationWelcomeMemberResearch({
        env: input.env,
        nowMs: input.nowMs,
        preparation,
      }),
  });
  await runSlackInvitedMemberOnboardingTick({
    ...input,
    startResearch: async (onboarding) =>
      await startSlackInvitedMemberResearch({
        env: input.env,
        nowMs: input.nowMs,
        onboarding,
      }),
  });
}
export async function rpcCenterAgentStartSelfMemberResearch(
  env: CoreBindings,
  input: CenterAgentStartSelfMemberResearchToolRpcInput,
  options: {
    nowMs?: number;
    openDirectMessage?: (context: CoreRpcContextInput) => Promise<{
      spaceId: string;
    }>;
  } = {}
): Promise<StartCenterAgentMemberResearchResponse> {
  const parsed =
    centerAgentStartSelfMemberResearchToolRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Center Agent Profile Report learning request.",
      status: 400,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(parsed.data.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.member_research_speaker_required",
        reason:
          "Starting a Profile Report learning run requires a verified active human Organization member.",
      }
    );
  const humanContext: CoreRpcContextInput = {
    activeOrganizationId: authorization.activeOrganization.organizationId,
    actorContext: {
      callerPrincipalId: representedHuman.userId,
      openMeldProfileId: representedHuman.profileId,
      ownerName: representedHuman.displayName,
      ownerUserId: representedHuman.userId,
      profileKind: "human",
      profileName: representedHuman.displayName,
      requestId: `${authorization.context.actorContext.requestId ?? "center-agent"}:learn-about-me`,
    },
  };
  const directMessage = options.openDirectMessage
    ? await options.openDirectMessage(humanContext)
    : await rpcOpenCenterAgentDirectMessageSpace(env, {
        context: humanContext,
      });
  return await startCenterAgentMemberResearch(
    env,
    {
      context: humanContext,
      expectedOrganizationId: authorization.activeOrganization.organizationId,
      scope: "member",
      subjectUserId: representedHuman.userId,
    },
    directMessage.spaceId,
    options
  );
}
async function startSlackInstallationWelcomeMemberResearch(input: {
  env: CoreBindings;
  nowMs: number;
  preparation: SlackInstallationWelcomePreparation;
}): Promise<{
  taskId: string;
}> {
  return await startSlackMemberResearch({
    actorProfileId: input.preparation.installedByProfileId,
    actorUserId: input.preparation.installedByUserId,
    env: input.env,
    nowMs: input.nowMs,
    organizationId: input.preparation.key.organizationId,
    requestId: `slack-welcome:${input.preparation.key.slackTeamId}:${input.preparation.key.connectionCreatedAtMs}`,
    subjectUserId: input.preparation.installedByUserId,
  });
}
async function startSlackInvitedMemberResearch(input: {
  env: CoreBindings;
  nowMs: number;
  onboarding: SlackInvitedMemberOnboarding;
}): Promise<{
  taskId: string;
}> {
  return await startSlackMemberResearch({
    actorProfileId: input.onboarding.joinedProfileId,
    actorUserId: input.onboarding.joinedUserId,
    env: input.env,
    nowMs: input.nowMs,
    organizationId: input.onboarding.organizationId,
    requestId: `slack-invited-member:${input.onboarding.interactionId}:${input.onboarding.targetSlackUserId}`,
    subjectUserId: input.onboarding.joinedUserId,
  });
}
async function startSlackMemberResearch(input: {
  actorProfileId: string;
  actorUserId: string;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  requestId: string;
  subjectUserId: string;
}): Promise<{
  taskId: string;
}> {
  const db = requireCenterAgentDb(input.env);
  const humanProfile = await db
    .query<{
      owner_name: string;
      profile_name: string;
    }>({
      text: `
        SELECT profiles.profile_name, users.name AS owner_name
        FROM "openmeld"."openmeld_profiles" AS profiles
        INNER JOIN "openmeld"."users" ON users.id = profiles.owner_user_id
        WHERE profiles.profile_id = $1
          AND profiles.owner_user_id = $2
          AND profiles.profile_kind = 'human'
          AND profiles.status = 'active'
        LIMIT 1
      `,
      values: [input.actorProfileId, input.actorUserId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!humanProfile) {
    throw new Error("Slack member Human Profile is unavailable.");
  }
  const context: CoreRpcContextInput = {
    activeOrganizationId: input.organizationId,
    actorContext: {
      callerPrincipalId: input.actorUserId,
      openMeldProfileId: input.actorProfileId,
      ownerName: humanProfile.owner_name,
      ownerUserId: input.actorUserId,
      profileKind: "human",
      profileName: humanProfile.profile_name,
      requestId: input.requestId,
    },
  };
  const directMessage = await rpcOpenCenterAgentDirectMessageSpace(input.env, {
    context,
  });
  const research = await startCenterAgentMemberResearch(
    input.env,
    {
      context,
      expectedOrganizationId: input.organizationId,
      scope: "member",
      subjectUserId: input.subjectUserId,
    },
    directMessage.spaceId,
    {
      acceptanceIdempotencyKey: input.requestId,
      nowMs: input.nowMs,
    }
  );
  const task = research.batch.tasks[0];
  if (!task) {
    throw new Error("Slack onboarding member research created no task.");
  }
  return { taskId: task.id };
}
export async function rpcDisconnectCenterAgentSlackWorkspace(
  env: CoreBindings,
  input: DisconnectCenterAgentSlackWorkspaceInput
): Promise<CenterAgentSlackWorkspaceDisconnectResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { channel: ["disconnect"] },
  });
  const db = requireCenterAgentDb(env);
  const deleted = await deleteRemoteAgentSlackWorkspaceBindingByOrganization({
    atomicDeleteStatements: [
      prepareDeleteSlackWorkspaceTokenByOrganizationStatement({
        db,
        organizationId: activeOrganization.organizationId,
      }),
    ],
    db,
    organizationId: activeOrganization.organizationId,
  });
  if (deleted) {
    await writeCenterAgentHumanAuditEntry({
      action: "disconnect_slack_workspace",
      context,
      db,
      organizationId: activeOrganization.organizationId,
      resource: {
        id: deleted.slackTeamId,
        type: "slack_workspace",
      },
    });
  }
  const response: CenterAgentSlackWorkspaceDisconnectResponse = {
    disconnected: Boolean(deleted),
    organizationId: activeOrganization.organizationId,
    slackConnection: await readCenterAgentSlackConnectionProjection({
      env,
      organizationId: activeOrganization.organizationId,
    }),
  };
  const validated =
    centerAgentSlackWorkspaceDisconnectResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Slack disconnect response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcReadCenterAgentOrganizationMemoryPolicy(
  env: CoreBindings,
  input: ReadCenterAgentOrganizationMemoryPolicyInput
): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context: requireRpcContext(input.context),
    env,
  });
  const repository = createPostgresCenterAgentMemoryRepository(
    requireCenterAgentDb(env)
  );
  const policy = await repository.readPolicy(activeOrganization.organizationId);
  return centerAgentOrganizationMemoryPolicyResponseSchema.parse({
    ...(input.includeAvailability
      ? {
          availability: await readCoreOrganizationMemoryAvailability(
            env,
            activeOrganization.organizationId
          ),
        }
      : {}),
    organizationId: activeOrganization.organizationId,
    organizationMemoryOptIn: policy.organizationMemoryOptIn,
    provider: "zep_cloud",
    updatedByUserId: policy.updatedByUserId,
  });
}
export async function rpcSetCenterAgentOrganizationMemoryPolicy(
  env: CoreBindings,
  input: SetCenterAgentOrganizationMemoryPolicyInput
): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
  const context = requireRpcContext(input.context);
  const parsed = updateCenterAgentOrganizationMemoryPolicyBodySchema.safeParse({
    organizationMemoryOptIn: input.organizationMemoryOptIn,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent organization memory policy payload",
      code: "invalid_payload",
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { memory: ["manage"] },
  });
  const repository = createPostgresCenterAgentMemoryRepository(
    requireCenterAgentDb(env)
  );
  const policy = await repository.upsertPolicy({
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    organizationMemoryOptIn: parsed.data.organizationMemoryOptIn,
    updatedByUserId: activeOrganization.userId,
  });
  return centerAgentOrganizationMemoryPolicyResponseSchema.parse({
    organizationId: activeOrganization.organizationId,
    organizationMemoryOptIn: policy.organizationMemoryOptIn,
    provider: "zep_cloud",
    updatedByUserId: policy.updatedByUserId,
  });
}
export async function rpcReadOrganizationInformationProtectionPolicy(
  env: CoreBindings,
  input: ReadOrganizationInformationProtectionPolicyInput
): Promise<OrganizationInformationProtectionPolicyResponse> {
  const activeOrganization = await requireOrganizationPermission({
    context: requireRpcContext(input.context),
    env,
    permissions: { informationProtection: ["manage"] },
  });
  const policy = await readOrganizationInformationProtectionPolicy({
    db: requireCenterAgentDb(env),
    organizationId: activeOrganization.organizationId,
  });
  return toOrganizationInformationProtectionPolicyResponse(policy);
}
export async function rpcSetOrganizationInformationProtectionPolicy(
  env: CoreBindings,
  input: SetOrganizationInformationProtectionPolicyInput
): Promise<OrganizationInformationProtectionPolicyResponse> {
  const parsed =
    updateOrganizationInformationProtectionPolicyBodySchema.safeParse({
      protectedInformation: input.protectedInformation,
    });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Organization information protection policy payload",
      status: 400,
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context: requireRpcContext(input.context),
    env,
    permissions: { informationProtection: ["manage"] },
  });
  const policy = await saveOrganizationInformationProtectionPolicy({
    db: requireCenterAgentDb(env),
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
    protectedInformation: parsed.data.protectedInformation,
    updatedByUserId: activeOrganization.userId,
  });
  return toOrganizationInformationProtectionPolicyResponse(policy);
}
function toOrganizationInformationProtectionPolicyResponse(input: {
  organizationId: string;
  protectedInformation: string | null;
  updatedAtMs: number | null;
  updatedByUserId: string | null;
}): OrganizationInformationProtectionPolicyResponse {
  return organizationInformationProtectionPolicyResponseSchema.parse({
    organizationId: input.organizationId,
    protectedInformation: input.protectedInformation,
    updatedAt:
      input.updatedAtMs === null
        ? null
        : new Date(input.updatedAtMs).toISOString(),
    updatedByUserId: input.updatedByUserId,
  });
}
export async function rpcReadCurrentOrganizationFeedbackReportingPolicy(
  env: CoreBindings,
  input: ReadCurrentOrganizationFeedbackReportingPolicyInput
): Promise<FeedbackReportingPolicyResponse> {
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context: requireRpcContext(input.context),
    env,
  });
  return rpcReadFeedbackReportingPolicy(env, {
    organizationId: activeOrganization.organizationId,
  });
}
export async function rpcSetCurrentOrganizationFeedbackReportingPolicy(
  env: CoreBindings,
  input: SetCurrentOrganizationFeedbackReportingPolicyInput
): Promise<FeedbackReportingPolicyResponse> {
  const context = requireRpcContext(input.context);
  const parsed = updateFeedbackReportingPolicyBodySchema.safeParse({
    reportingEnabled: input.reportingEnabled,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid feedback reporting policy payload",
      code: "invalid_payload",
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { feedback: ["manage"] },
  });
  return rpcSetFeedbackReportingPolicy(env, {
    organizationId: activeOrganization.organizationId,
    reportingEnabled: parsed.data.reportingEnabled,
    updatedByUserId: activeOrganization.userId,
  });
}
export async function rpcWipeCurrentMemberCenterAgentMemory(
  env: CoreBindings,
  input: WipeCurrentMemberCenterAgentMemoryInput
): Promise<CenterAgentWipeMemberMemoryResponse> {
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context: requireRpcContext(input.context),
    env,
  });
  const memoryService = requireCenterAgentMemoryService(env);
  const status = await memoryService.deleteMemberMemory({
    organizationId: activeOrganization.organizationId,
    userId: activeOrganization.userId,
  });
  return centerAgentWipeMemberMemoryResponseSchema.parse({
    organizationId: activeOrganization.organizationId,
    provider: "zep_cloud",
    status,
    userId: activeOrganization.userId,
  });
}
export async function rpcCenterAgentRememberForOrganization(
  env: CoreBindings,
  input: CenterAgentRememberForOrganizationInput
): Promise<CenterAgentRememberForOrganizationResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentRememberForOrganizationBodySchema.safeParse({
    fact: input.fact,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent organization memory fact payload",
      code: "invalid_payload",
    });
  }
  const speakerMember = normalizeExplicitMemorySpeaker(input.speakerMember);
  if (!speakerMember) {
    throw createCoreRpcHttpError({
      status: 403,
      reason:
        "Center Agent can save organization memory only for a verified organization member turn.",
      code: "center_agent_memory.speaker_member_required",
    });
  }
  const memoryService = requireCenterAgentMemoryService(env);
  let saveStatus: "processing" | "processed";
  try {
    const origin = await requireExplicitMemoryEpisodeOrigin({
      authorization,
      env,
    });
    const receipt = await memoryService.rememberFactForOrganization({
      fact: parsed.data.fact,
      organizationId: authorization.activeOrganization.organizationId,
      origin,
      speakerMember,
    });
    saveStatus = receipt.status;
  } catch (error) {
    if (
      toErrorMessage(error) ===
        "center_agent_memory.organization_write_timeout" ||
      toErrorMessage(error) === "center_agent_memory.write_receipt_missing"
    ) {
      throw createCoreRpcHttpError({
        status: 504,
        reason:
          "The memory provider did not confirm the save. It may still be processing. Search for the fact before trying to save it again.",
        code: "center_agent_memory.write_outcome_unknown",
      });
    }
    if (
      toErrorMessage(error).includes(
        "center_agent_memory.organization_memory_opt_in_required"
      )
    ) {
      throw createCoreRpcHttpError({
        status: 403,
        reason:
          "Organization memory is off. Ask an owner or admin to enable it in Center Agent settings.",
        code: "center_agent_memory.organization_memory_opt_in_required",
      });
    }
    throw error;
  }
  return centerAgentRememberForOrganizationResponseSchema.parse({
    fact: parsed.data.fact,
    organizationId: authorization.activeOrganization.organizationId,
    saved: true,
    ...(input.includeStatus ? { status: saveStatus } : {}),
    source: "explicit_tool",
  });
}
export async function rpcPreviewSlackIdentityLink(
  env: CoreBindings,
  input: PreviewSlackIdentityLinkInput
): Promise<SlackIdentityLinkPreviewResponse> {
  const context = requireRpcContext(input.context);
  const parsed = slackIdentityLinkPreviewBodySchema.safeParse({
    token: input.token,
  });
  if (!parsed.success) {
    throw createSlackIdentityLinkTokenInvalidError();
  }
  const db = requireCenterAgentDb(env);
  const linkContext = await resolveSlackIdentityLinkContext({
    authWorker: env.OPENMELD_AUTH_WORKER,
    context,
    db,
    nowMs: Date.now(),
    token: parsed.data.token,
  });
  const existingLink = await readSlackUserIdentityLink({
    db,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
  });
  const response: SlackIdentityLinkPreviewResponse = {
    alreadyMember: Boolean(linkContext.membership.role),
    continuesRequest: Boolean(linkContext.token.sourceDeliveryId),
    expiresAt: toIsoDateTime(linkContext.token.expiresAtMs),
    organizationId: linkContext.membership.organizationId,
    organizationName: linkContext.membership.organizationName,
    slackAccountEmail: normalizeSlackAccountEmail(
      linkContext.token.slackUserDisplayName
    ),
    slackDisplayName: linkContext.token.slackUserDisplayName,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
    slackWorkspaceLabel: resolveSlackWorkspaceLabel({
      slackTeamId: linkContext.token.slackTeamId,
      workspaceName: linkContext.workspace.workspaceName,
    }),
    openMeldAccountEmail: linkContext.membership.userEmail,
    replacesExistingLink: Boolean(
      existingLink &&
        existingLink.openmeldUserId !== linkContext.membership.userId
    ),
  };
  const validated = slackIdentityLinkPreviewResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Slack identity link preview response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcConsumeSlackIdentityLink(
  env: CoreBindings,
  input: ConsumeSlackIdentityLinkInput
): Promise<SlackIdentityLinkConsumeResponse> {
  const context = requireRpcContext(input.context);
  const parsed = slackIdentityLinkConsumeBodySchema.safeParse({
    includeReturnTarget: input.includeReturnTarget,
    token: input.token,
  });
  if (!parsed.success) {
    throw createSlackIdentityLinkTokenInvalidError();
  }
  const db = requireCenterAgentDb(env);
  const nowMs = Date.now();
  const linkContext = await resolveSlackIdentityLinkContext({
    authWorker: env.OPENMELD_AUTH_WORKER,
    context,
    db,
    nowMs,
    token: parsed.data.token,
  });
  const claimResult = await claimSlackIdentityLinkTokenForUser({
    claimedAtMs: nowMs,
    db,
    organizationId: linkContext.membership.organizationId,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
    tokenHash: linkContext.token.tokenHash,
    openmeldUserId: linkContext.membership.userId,
  });
  if (claimResult.status === "invalid") {
    throw createSlackIdentityLinkTokenInvalidError();
  }
  const botToken = await requireCurrentSlackIdentityLinkMember({
    db,
    env,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
  });
  const ensuredMembership = await ensureSlackIdentityLinkMembership({
    env,
    membership: linkContext.membership,
  });
  const resourceId = await buildMessageChannelIdentityLinkId({
    connectionId: `slack:${linkContext.token.slackTeamId}`,
    provider: "slack",
    providerUserId: linkContext.token.slackUserId,
  });
  const audit = buildMessageChannelIdentityReplacementAuditRecord({
    context,
    nowMs,
    organizationId: ensuredMembership.membership.organizationId,
    resourceId,
  });
  const consumeResult = await consumeSlackIdentityLinkTokenAndUpsertUserLink({
    audit,
    consumeNonce: crypto.randomUUID(),
    db,
    consumedAtMs: nowMs,
    organizationId: ensuredMembership.membership.organizationId,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
    tokenHash: linkContext.token.tokenHash,
    openmeldUserId: ensuredMembership.membership.userId,
  });
  if (consumeResult.status === "invalid") {
    throw createSlackIdentityLinkTokenInvalidError();
  }
  let continuationResult: Awaited<
    ReturnType<typeof continueSlackIdentityOnboardingRequest>
  >;
  try {
    continuationResult = await continueSlackIdentityOnboardingRequest({
      db,
      env,
      nowMs,
      organizationId: ensuredMembership.membership.organizationId,
      slackTeamId: linkContext.token.slackTeamId,
      slackUserId: linkContext.token.slackUserId,
      sourceDeliveryId: linkContext.token.sourceDeliveryId,
      tokenHash: linkContext.token.tokenHash,
      openmeldUserId: ensuredMembership.membership.userId,
    });
  } catch (error) {
    const event = "core.remote_agent.slack_identity_continuation_failed";
    console.error(`[${event}]`, {
      event,
      error: toErrorMessage(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorStack: error instanceof Error ? error.stack : undefined,
      organizationId: ensuredMembership.membership.organizationId,
      slackTeamId: linkContext.token.slackTeamId,
      slackUserId: linkContext.token.slackUserId,
      sourceDeliveryId: linkContext.token.sourceDeliveryId,
      openMeldUserId: ensuredMembership.membership.userId,
    });
    continuationResult = {
      slackThreadTarget: null,
      status: "retryable_failure",
    };
  }
  let slackThreadPermalink: string | null = null;
  if (parsed.data.includeReturnTarget && continuationResult.slackThreadTarget) {
    try {
      slackThreadPermalink = await getSlackMessagePermalink({
        botToken,
        channelId: continuationResult.slackThreadTarget.channelId,
        messageTs: continuationResult.slackThreadTarget.messageTs,
      });
    } catch (error) {
      const event = "core.remote_agent.slack_identity_return_target_failed";
      console.warn(`[${event}]`, {
        event,
        error: toErrorMessage(error),
        organizationId: ensuredMembership.membership.organizationId,
        slackTeamId: linkContext.token.slackTeamId,
        sourceDeliveryId: linkContext.token.sourceDeliveryId,
        openMeldUserId: ensuredMembership.membership.userId,
      });
    }
  }
  const organizationSlug = await readOrganizationRouteSlug({
    env,
    organizationId: ensuredMembership.membership.organizationId,
    requestId: context.actorContext.requestId,
  });
  const response: SlackIdentityLinkConsumeResponse = {
    continuationRetryable: continuationResult.status === "retryable_failure",
    continued: continuationResult.status === "submitted",
    joinedOrganization: ensuredMembership.joinedOrganization,
    linked: true,
    openMeldProfileId:
      normalizeOptionalText(context.actorContext.openMeldProfileId) ?? null,
    organizationId: ensuredMembership.membership.organizationId,
    organizationName: ensuredMembership.membership.organizationName,
    organizationSlug,
    slackDisplayName: linkContext.token.slackUserDisplayName,
    slackTeamId: linkContext.token.slackTeamId,
    ...(parsed.data.includeReturnTarget ? { slackThreadPermalink } : {}),
    slackUserId: linkContext.token.slackUserId,
    replacedExistingLink: consumeResult.replacedExistingLink,
    openMeldUserId: ensuredMembership.membership.userId,
  };
  const validated = slackIdentityLinkConsumeResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Slack identity link consume response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcAssertCurrentDesignatedCenterAgent(
  env: CoreBindings,
  input: AssertCurrentDesignatedCenterAgentInput
): Promise<GetCenterAgentDesignationResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  return {
    organizationId: authorization.activeOrganization.organizationId,
    designation: toCenterAgentDesignationDto(authorization.designation),
  };
}
export async function rpcRecordCenterAgentAudit(
  env: CoreBindings,
  input: RecordCenterAgentAuditInput
): Promise<CenterAgentAttribution> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const attribution = await writeCenterAgentAuditEntry({
    action: input.action,
    authorization,
    onBehalfOfProfileId: input.onBehalfOf?.profileId ?? null,
    resource: input.resource ?? null,
  });
  return attribution;
}
const CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS: readonly CenterAgentAction[] = [
  "post_slack_file",
  "read_slack_file",
];
const CENTER_AGENT_AUDIT_ACTION_SETS_WITH_CONTEXT_DETAILS: ReadonlySet<string> =
  new Set(["v16", "v17", "v18", "v19", "v20", "v21", "v22"]);
const CENTER_AGENT_AUDIT_ACTION_SETS_WITH_INTERACTION_SOURCE: ReadonlySet<string> =
  new Set(["v14", "v15", "v16", "v17", "v18", "v19", "v20", "v21", "v22"]);
const CENTER_AGENT_AUDIT_ACTION_SETS_WITH_SOURCE_SPACE: ReadonlySet<string> =
  new Set(["v20", "v21", "v22"]);
function initialCenterAgentAuditExcludedActions(
  actionSet: ListCenterAgentAuditJournalQuery["actionSet"]
): readonly CenterAgentAction[] | undefined {
  return actionSet === "v21" || actionSet === "v22"
    ? undefined
    : CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS;
}
function centerAgentAuditProjectionOptions(
  actionSet: ListCenterAgentAuditJournalQuery["actionSet"]
): {
  includeContextDetails: boolean;
  includeInteractionSource: boolean;
  includeSourceSpaceId: boolean;
} {
  const currentActionSet = actionSet ?? "";
  return {
    includeContextDetails:
      CENTER_AGENT_AUDIT_ACTION_SETS_WITH_CONTEXT_DETAILS.has(currentActionSet),
    includeInteractionSource:
      CENTER_AGENT_AUDIT_ACTION_SETS_WITH_INTERACTION_SOURCE.has(
        currentActionSet
      ),
    includeSourceSpaceId:
      CENTER_AGENT_AUDIT_ACTION_SETS_WITH_SOURCE_SPACE.has(currentActionSet),
  };
}
export async function rpcCenterAgentReadAuditJournal(
  env: CoreBindings,
  input: CenterAgentReadAuditJournalRpcInput
) {
  const parsed = centerAgentReadAuditJournalRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "A verified member audit read request is required.",
      status: 400,
    });
  }
  const prepared = await prepareCenterAgentRepresentedMemberRequest(
    env,
    parsed.data.context,
    parsed.data.speakerMember
  );
  const journal = await readCenterAgentAuditJournalForOrganization(
    env,
    parsed.data,
    prepared.authorization.activeOrganization.organizationId
  );
  return await projectCenterAgentAuditJournalEvidence({
    env,
    journal,
    prepared,
  });
}
export async function rpcListCenterAgentAuditJournal(
  env: CoreBindings,
  input: ListCenterAgentAuditJournalInput
): Promise<ListCenterAgentAuditJournalResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  return await readCenterAgentAuditJournalForOrganization(
    env,
    input,
    activeOrganization.organizationId
  );
}
async function readCenterAgentAuditJournalForOrganization(
  env: CoreBindings,
  input: ListCenterAgentAuditJournalQuery,
  organizationId: string
): Promise<ListCenterAgentAuditJournalResponse> {
  const activeOrganization = { organizationId };
  const parsed = listCenterAgentAuditJournalQuerySchema.safeParse({
    ...(input.actionSet === undefined ? {} : { actionSet: input.actionSet }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: parsed.error.issues[0]?.message ?? "invalid audit journal query",
      code: "invalid_payload",
    });
  }
  let excludedActions = initialCenterAgentAuditExcludedActions(
    parsed.data.actionSet
  );
  const connectorActions: readonly CenterAgentAction[] = [
    "execute_connector_action",
    "complete_connector_action",
    "fail_connector_action",
    "record_connector_action_outcome_unknown",
  ];
  const slackWorkspaceDirectoryActions: readonly CenterAgentAction[] = [
    "read_slack_workspace_directory",
  ];
  const memberServiceStatusActions: readonly CenterAgentAction[] = [
    "read_member_openmeld_service_status",
  ];
  const memberComputerActions: readonly CenterAgentAction[] = [
    "read_member_computers",
  ];
  const slackChannelReadActions: readonly CenterAgentAction[] = [
    "list_slack_channels",
    "read_slack_channel_members",
    "read_slack_channel_history",
  ];
  const slackSearchActions: readonly CenterAgentAction[] = [
    "search_slack_messages",
  ];
  const projectActions: readonly CenterAgentAction[] = [
    "read_projects",
    "create_project",
    "update_project",
    "set_agent_profile_default_project",
    "prepare_remove_project",
    "remove_project",
  ];
  const taskReadActions: readonly CenterAgentAction[] = ["read_agent_tasks"];
  const taskCoordinationActions: readonly CenterAgentAction[] = [
    ...taskReadActions,
    "watch_agent_task",
  ];
  const routineActions: readonly CenterAgentAction[] = [
    "create_routine",
    "delete_routine",
    "pause_routine",
    "resume_routine",
    "update_routine",
  ];
  if (parsed.data.actionSet === "v2") {
    excludedActions = [
      "add_members_to_space",
      "read_org_documents",
      "draft_org_document",
      ...connectorActions,
      ...slackWorkspaceDirectoryActions,
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v3") {
    excludedActions = [
      "read_org_documents",
      "draft_org_document",
      ...connectorActions,
      ...slackWorkspaceDirectoryActions,
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v4") {
    excludedActions = [
      ...connectorActions,
      ...slackWorkspaceDirectoryActions,
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v5") {
    excludedActions = [
      ...slackWorkspaceDirectoryActions,
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v6") {
    excludedActions = [
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v7") {
    excludedActions = [
      ...slackChannelReadActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v8") {
    excludedActions = [
      ...slackChannelReadActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v9") {
    excludedActions = [
      ...slackChannelReadActions,
      ...taskReadActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v10") {
    excludedActions = [
      ...slackChannelReadActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (parsed.data.actionSet === "v11") {
    excludedActions = [
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (
    parsed.data.actionSet === "v12" ||
    parsed.data.actionSet === "v13" ||
    parsed.data.actionSet === "v14" ||
    parsed.data.actionSet === "v15" ||
    parsed.data.actionSet === "v16" ||
    parsed.data.actionSet === "v17" ||
    parsed.data.actionSet === "v18"
  ) {
    excludedActions = [
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  } else if (!isCurrentCenterAgentAuditActionSet(parsed.data.actionSet)) {
    excludedActions = [
      "post_slack_channel_message",
      "add_members_to_space",
      "read_org_documents",
      "draft_org_document",
      ...connectorActions,
      ...slackWorkspaceDirectoryActions,
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
      ...memberComputerActions,
      ...CENTER_AGENT_SLACK_FILE_AUDIT_ACTIONS,
    ];
  }
  excludedActions = applyCenterAgentAuditOperatingStateCompatibility({
    actionSet: parsed.data.actionSet,
    excludedActions,
    routineActions,
  });
  const entries = await listCenterAgentAuditJournalEntries({
    db: requireCenterAgentDb(env),
    ...(excludedActions === undefined ? {} : { excludedActions }),
    limit: parsed.data.limit ?? CENTER_AGENT_AUDIT_JOURNAL_DEFAULT_LIMIT,
    organizationId: activeOrganization.organizationId,
  });
  const projectionOptions = centerAgentAuditProjectionOptions(
    parsed.data.actionSet
  );
  const response: ListCenterAgentAuditJournalResponse = {
    organizationId: activeOrganization.organizationId,
    entries: entries.map((entry) =>
      toCenterAgentAuditJournalEntryDto(entry, projectionOptions)
    ),
  };
  const validated =
    listCenterAgentAuditJournalResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent audit journal response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function isCurrentCenterAgentAuditActionSet(
  actionSet: string | undefined
): boolean {
  return (
    actionSet === "v12" ||
    actionSet === "v13" ||
    actionSet === "v14" ||
    actionSet === "v15" ||
    actionSet === "v16" ||
    actionSet === "v17" ||
    actionSet === "v18" ||
    actionSet === "v19" ||
    actionSet === "v20" ||
    actionSet === "v21" ||
    actionSet === "v22"
  );
}
function applyCenterAgentAuditOperatingStateCompatibility(input: {
  actionSet: string | undefined;
  excludedActions: readonly CenterAgentAction[] | undefined;
  routineActions: readonly CenterAgentAction[];
}): readonly CenterAgentAction[] {
  const channelFileCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v22" ? [] : ["read_channel_file", "post_channel_file"];
  const localAgentCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v14" ||
    input.actionSet === "v15" ||
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18" ||
    input.actionSet === "v19" ||
    input.actionSet === "v20" ||
    input.actionSet === "v21" ||
    input.actionSet === "v22"
      ? []
      : ["receive_local_agent_request"];
  const contextCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v15" ||
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18" ||
    input.actionSet === "v19" ||
    input.actionSet === "v20" ||
    input.actionSet === "v21" ||
    input.actionSet === "v22"
      ? []
      : ["read_center_agent_context"];
  const contextLoadCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18" ||
    input.actionSet === "v19" ||
    input.actionSet === "v20" ||
    input.actionSet === "v21" ||
    input.actionSet === "v22"
      ? []
      : ["load_center_agent_context"];
  const routineCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v17" ||
    input.actionSet === "v18" ||
    input.actionSet === "v19" ||
    input.actionSet === "v20" ||
    input.actionSet === "v21" ||
    input.actionSet === "v22"
      ? []
      : input.routineActions;
  const workingLanguageCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v18" ||
    input.actionSet === "v19" ||
    input.actionSet === "v20" ||
    input.actionSet === "v21" ||
    input.actionSet === "v22"
      ? []
      : ["set_working_language", "observe_working_language"];
  if (
    input.actionSet === "v13" ||
    input.actionSet === "v14" ||
    input.actionSet === "v15" ||
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18" ||
    input.actionSet === "v19" ||
    input.actionSet === "v20" ||
    input.actionSet === "v21" ||
    input.actionSet === "v22"
  ) {
    return [
      ...(input.excludedActions ?? []),
      ...channelFileCompatibilityActions,
      ...localAgentCompatibilityActions,
      ...contextCompatibilityActions,
      ...contextLoadCompatibilityActions,
      ...routineCompatibilityActions,
      ...workingLanguageCompatibilityActions,
      "revoke_center_agent",
    ];
  }
  return [
    ...(input.excludedActions ?? []),
    ...channelFileCompatibilityActions,
    ...localAgentCompatibilityActions,
    ...contextCompatibilityActions,
    ...contextLoadCompatibilityActions,
    ...routineCompatibilityActions,
    ...workingLanguageCompatibilityActions,
    "pause_center_agent",
    "resume_center_agent",
  ];
}
export async function rpcCenterAgentListLocalAgentConnectionCandidates(
  env: CoreBindings,
  input: CenterAgentListLocalAgentConnectionCandidatesInput
): Promise<CenterAgentListLocalAgentConnectionCandidatesResponse> {
  const parsed =
    centerAgentListLocalAgentConnectionCandidatesBodySchema.safeParse({
      includeModelOptions: input.includeModelOptions,
      speakerMember: input.speakerMember,
      ...(input.memberUserId ? { memberUserId: input.memberUserId } : {}),
    });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "A verified requesting member is required to list local agents.",
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember
    );
  const userId = parsed.data.memberUserId ?? representedHuman.userId;
  const membership = await resolveOrganizationMembershipById({
    env,
    organizationId: authorization.activeOrganization.organizationId,
    requestId: authorization.context.actorContext.requestId,
    userId,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      status: membership.status,
      code: membership.code,
      reason: membership.message,
    });
  }
  const response = projectCenterAgentLocalAgentConnectionCandidates({
    peopleComputers: await listPeopleComputersForOwnerUser({ env, userId }),
    organizationId: authorization.activeOrganization.organizationId,
    ...(parsed.data.includeModelOptions
      ? { modelCatalog: readModelCatalog({ retirement: true }) }
      : {}),
  });
  const validated =
    centerAgentListLocalAgentConnectionCandidatesResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent local agent candidate response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentReadPeopleComputers(
  env: CoreBindings,
  input: CenterAgentReadPeopleComputersInput
): Promise<CenterAgentReadPeopleComputersResponse> {
  const parsed = centerAgentReadPeopleComputersBodySchema.safeParse({
    speakerMember: input.speakerMember,
    includeUsageLimits: input.includeUsageLimits,
    target: input.target,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid Computer read request.",
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.computer_setup_speaker_required",
        reason:
          "Computer information requires a verified active human Organization member.",
      }
    );
  const inventory = await listPeopleComputersForOwnerUser({
    env,
    userId: representedHuman.userId,
    includeUsageLimits: parsed.data.includeUsageLimits === "true",
  });
  const target = parsed.data.target;
  let selectedComputer: CenterAgentReadPeopleComputersResponse["selectedComputer"] =
    null;
  if (target) {
    if (
      !inventory.computers.some((computer) =>
        peopleComputerContainsDevice(computer, target.deviceId)
      )
    ) {
      throw createCoreRpcHttpError({
        status: 404,
        code: "computer.not_found",
        reason: "This computer is not available on your account.",
      });
    }
    const diagnostics = await buildOwnerComputerDiagnostics({
      env,
      userId: representedHuman.userId,
      includeUsageLimits: parsed.data.includeUsageLimits === "true",
      localRuntimes: projectPeopleComputersToLegacyLocalRuntimes(
        inventory,
        target
      ),
      target,
    });
    selectedComputer = {
      target,
      readiness: diagnostics.currentLocalRuntimeReplyReadiness,
      fileAccess: diagnostics.currentComputerFileAccess,
      localRuntimes: diagnostics.localRuntimes,
      care: await readOwnerComputerCareObservation({
        env,
        target,
        userId: representedHuman.userId,
      }),
    };
  }
  return centerAgentReadPeopleComputersResponseSchema.parse({
    inventory: {
      ...inventory,
      computers: inventory.computers.map((computer) => ({
        ...computer,
        // Discovery catalogs contain model lists and detailed install reports.
        // Keep their dated target facts here; local-agent candidate and
        // installation tools own the corresponding focused reads.
        executionTargets: computer.executionTargets.map(
          ({
            capabilities: _capabilities,
            localAgentCatalog: _catalog,
            ...target
          }) => target
        ),
      })),
    },
    organizationId: authorization.activeOrganization.organizationId,
    selectedComputer,
  });
}
export async function rpcCenterAgentListComputers(
  env: CoreBindings,
  input: CenterAgentListComputersInput
): Promise<CenterAgentListComputersResponse> {
  const parsed = centerAgentListComputersBodySchema.safeParse({
    ...(input.includeDiagnostics === undefined
      ? {}
      : { includeDiagnostics: input.includeDiagnostics }),
    ...(input.includeUsageLimits === undefined
      ? {}
      : { includeUsageLimits: input.includeUsageLimits }),
    speakerMember: input.speakerMember,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent computer list payload",
      code: "invalid_payload",
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.computer_setup_speaker_required",
        reason:
          "Computer setup requires a verified active human Organization member.",
      }
    );
  const localRuntimes = await listLocalRuntimesForOwnerUser({
    env,
    userId: representedHuman.userId,
  });
  const diagnostics = parsed.data.includeDiagnostics
    ? await buildOwnerComputerDiagnostics({
        env,
        includeUsageLimits: parsed.data.includeUsageLimits === "true",
        localRuntimes,
        userId: representedHuman.userId,
      })
    : undefined;
  const validated = centerAgentListComputersResponseSchema.safeParse({
    computers: projectCenterAgentComputerSetupOptions(
      await listPeopleComputersForOwnerUser({
        env,
        userId: representedHuman.userId,
      })
    ),
    ...(diagnostics === undefined ? {} : { diagnostics }),
    organizationId: authorization.activeOrganization.organizationId,
  });
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent computer list response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentRequestOpenMeldToolsUpdate(
  env: CoreBindings,
  input: CenterAgentRequestOpenMeldToolsUpdateInput
): Promise<CenterAgentRequestOpenMeldToolsUpdateResponse> {
  const parsed = centerAgentRequestOpenMeldToolsUpdateBodySchema.safeParse({
    speakerMember: input.speakerMember,
    target: input.target,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Invalid update request.",
      status: 400,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.computer_control_speaker_required",
        reason: "Computer changes require a verified member.",
      }
    );
  const result = await controlOpenMeldToolsForUser({
    env,
    request: {
      operation: "request_update",
      requestSource: "center_agent",
    },
    target: parsed.data.target,
    userId: representedHuman.userId,
  });
  if (result.operation !== "request_update") {
    throw new Error("OpenMeld Service returned the wrong update result.");
  }
  return centerAgentRequestOpenMeldToolsUpdateResponseSchema.parse({
    organizationId: authorization.activeOrganization.organizationId,
    result: result.result,
  });
}
export async function rpcCenterAgentSetOpenMeldToolsMaintenance(
  env: CoreBindings,
  input: CenterAgentSetOpenMeldToolsMaintenanceInput
): Promise<CenterAgentSetOpenMeldToolsMaintenanceResponse> {
  const parsed = centerAgentSetOpenMeldToolsMaintenanceBodySchema.safeParse({
    automaticUpdatesEnabled: input.automaticUpdatesEnabled,
    speakerMember: input.speakerMember,
    target: input.target,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Invalid update setting.",
      status: 400,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.computer_control_speaker_required",
        reason: "Computer changes require a verified member.",
      }
    );
  const result = await controlOpenMeldToolsForUser({
    env,
    request: {
      automaticUpdatesEnabled: parsed.data.automaticUpdatesEnabled,
      operation: "set_automatic_updates",
      requestSource: "center_agent",
    },
    target: parsed.data.target,
    userId: representedHuman.userId,
  });
  if (result.operation !== "set_automatic_updates") {
    throw new Error("OpenMeld Service returned the wrong update setting.");
  }
  return centerAgentSetOpenMeldToolsMaintenanceResponseSchema.parse({
    organizationId: authorization.activeOrganization.organizationId,
    result: result.result,
  });
}
export async function rpcCenterAgentListLocalAgentInstallations(
  env: CoreBindings,
  input: CenterAgentListLocalAgentInstallationsInput
): Promise<CenterAgentListLocalAgentInstallationsResponse> {
  const parsed = centerAgentListLocalAgentInstallationsBodySchema.safeParse({
    agentId: input.agentId,
    speakerMember: input.speakerMember,
    target: input.target,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Invalid local agent.",
      status: 400,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.computer_control_speaker_required",
        reason: "Computer changes require a verified member.",
      }
    );
  const result = await getCurrentLocalAgentInstallationsForUser(env, {
    agentId: parsed.data.agentId,
    target: parsed.data.target,
    userId: representedHuman.userId,
  });
  return centerAgentListLocalAgentInstallationsResponseSchema.parse({
    ...result,
    organizationId: authorization.activeOrganization.organizationId,
  });
}
export async function rpcCenterAgentSelectLocalAgentInstallation(
  env: CoreBindings,
  input: CenterAgentSelectLocalAgentInstallationInput
): Promise<CenterAgentSelectLocalAgentInstallationResponse> {
  const parsed = centerAgentSelectLocalAgentInstallationBodySchema.safeParse({
    agentId: input.agentId,
    confirmed: input.confirmed,
    installationId: input.installationId,
    speakerMember: input.speakerMember,
    target: input.target,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Confirm this installation.",
      status: 400,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.computer_control_speaker_required",
        reason: "Computer changes require a verified member.",
      }
    );
  const result = await selectCurrentLocalAgentInstallationForUser(env, {
    agentId: parsed.data.agentId,
    installationId: parsed.data.installationId,
    target: parsed.data.target,
    userId: representedHuman.userId,
  });
  return centerAgentSelectLocalAgentInstallationResponseSchema.parse({
    ...result,
    organizationId: authorization.activeOrganization.organizationId,
  });
}
export async function rpcCenterAgentConnectAgentProfileToLocalAgent(
  env: CoreBindings,
  input: CenterAgentConnectAgentProfileToLocalAgentInput
): Promise<CenterAgentConnectAgentProfileToLocalAgentResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentConnectAgentProfileToLocalAgentBodySchema.safeParse(
    {
      agentControllerCollaborationMode: input.agentControllerCollaborationMode,
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      agentProfileId: input.agentProfileId,
      candidateId: input.candidateId,
      modelId: input.modelId,
      ...(input.onBehalfOf === undefined
        ? {}
        : { onBehalfOf: input.onBehalfOf }),
      openCodePermission: input.openCodePermission,
      reasoningLevel: input.reasoningLevel,
    }
  );
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Agent Profile connection payload",
      code: "invalid_payload",
    });
  }
  const owner = await resolveCenterAgentProductOperationOwner(
    authorization,
    parsed.data.onBehalfOf
  );
  await refuseUnconfirmedCenterAgentPermissionModeChange({
    agentProfileId: parsed.data.agentProfileId,
    db: authorization.db,
    ownerUserId: owner.representedUserId,
    requestedMode: parsed.data.agentControllerPermissionMode,
  });
  const response = await connectAgentProfileToLocalAgentOperation({
    deps: buildCenterAgentProductOperationDeps(env, authorization, owner),
    request: parsed.data,
  });
  const validated =
    centerAgentConnectAgentProfileToLocalAgentResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Agent Profile connection response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export function rpcCenterAgentUpdateAgentProfileRuntimeSettings(
  env: CoreBindings,
  input: CenterAgentUpdateAgentProfileRuntimeSettingsInput
): Promise<CenterAgentUpdateAgentProfileRuntimeSettingsResponse> {
  return updateCenterAgentProfileRuntimeSettings(env, input, false);
}
export function rpcCenterAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace(
  env: CoreBindings,
  input: CenterAgentUpdateAgentProfileRuntimeSettingsInput
): Promise<CenterAgentUpdateAgentProfileRuntimeSettingsResponse> {
  return updateCenterAgentProfileRuntimeSettings(env, input, true);
}
async function updateCenterAgentProfileRuntimeSettings(
  env: CoreBindings,
  input: CenterAgentUpdateAgentProfileRuntimeSettingsInput,
  acceptsSafeWorkspaceResult: boolean
): Promise<CenterAgentUpdateAgentProfileRuntimeSettingsResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed =
    centerAgentUpdateAgentProfileRuntimeSettingsBodySchema.safeParse({
      agentControllerCollaborationMode: input.agentControllerCollaborationMode,
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      agentProfileId: input.agentProfileId,
      defaultFolderId: input.defaultFolderId,
      modelId: input.modelId,
      ...(input.onBehalfOf === undefined
        ? {}
        : { onBehalfOf: input.onBehalfOf }),
      openCodePermission: input.openCodePermission,
      ...(input.permissionModeConfirmationToken === undefined
        ? {}
        : {
            permissionModeConfirmationToken:
              input.permissionModeConfirmationToken,
          }),
      reasoningLevel: input.reasoningLevel,
      workspaceMode: input.workspaceMode,
      workspacePath: input.workspacePath,
    });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Agent Profile runtime settings payload",
      code: "invalid_payload",
    });
  }
  if (
    (parsed.data.workspaceMode !== undefined ||
      parsed.data.defaultFolderId !== undefined) &&
    !acceptsSafeWorkspaceResult
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "center_agent.workspace_contract_update_required",
      reason:
        "Working folder changes are temporarily unavailable during an update. Try again after the update completes.",
    });
  }
  const owner = await resolveCenterAgentProductOperationOwner(
    authorization,
    parsed.data.onBehalfOf
  );
  const { permissionModeConfirmationToken, ...request } = parsed.data;
  if (
    isRequestChainEnforced() &&
    request.agentControllerPermissionMode !== undefined
  ) {
    // Non-additive: the member's instruction alone never applies it.
    const decision = await requireCenterAgentPermissionModeConfirmation({
      db: authorization.db,
      nativeDeliveryId: owner.sourceNativeDeliveryId,
      nowMs: Date.now(),
      scope: {
        actorProfileId: authorization.actorProfileId,
        agentControllerPermissionMode: request.agentControllerPermissionMode,
        agentProfileId: request.agentProfileId,
        organizationId: authorization.activeOrganization.organizationId,
        representedProfileId: owner.representedProfileId,
        representedUserId: owner.representedUserId,
      },
      ...(permissionModeConfirmationToken === undefined
        ? {}
        : { token: permissionModeConfirmationToken }),
    });
    if (decision.status === "confirmation_required") {
      await auditCenterAgentRuntimeSettings(env, {
        authorization,
        outcome: "confirmation_required",
        owner,
        reasonCode: "center_agent.permission_mode_confirmation_required",
        agentProfileId: request.agentProfileId,
      });
      return centerAgentUpdateAgentProfileRuntimeSettingsResponseSchema.parse({
        agentProfileId: request.agentProfileId,
        canReply: false,
        organizationId: authorization.activeOrganization.organizationId,
        permissionModeConfirmation: {
          agentControllerPermissionMode: request.agentControllerPermissionMode,
          ...decision.confirmation,
        },
        status: "blocked",
        steps: [
          {
            message:
              "Nothing was changed. Changing the permission mode needs the member's separate confirmation.",
            name: "update_agent_profile_runtime_settings",
            nextAction:
              "Tell the member exactly which mode this sets, ask them to confirm in their next message, then call again with the same settings and permissionModeConfirmationToken.",
            reasonCode: "center_agent.permission_mode_confirmation_required",
            status: "skipped",
          },
        ],
      });
    }
  }
  let response: Awaited<
    ReturnType<typeof updateAgentProfileRuntimeSettingsOperation>
  >;
  try {
    response = await updateAgentProfileRuntimeSettingsOperation({
      deps: buildCenterAgentProductOperationDeps(env, authorization, owner),
      organizationId: authorization.activeOrganization.organizationId,
      request,
    });
  } catch (error) {
    await auditCenterAgentRuntimeSettings(env, {
      authorization,
      outcome: "failed",
      owner,
      reasonCode:
        typeof (error as { code?: unknown } | null)?.code === "string"
          ? String((error as { code: string }).code)
          : "operation_failed",
      agentProfileId: request.agentProfileId,
    });
    throw error;
  }
  await auditCenterAgentRuntimeSettings(env, {
    authorization,
    outcome: response.status === "blocked" ? "failed" : "succeeded",
    owner,
    reasonCode: response.status === "blocked" ? "center_agent.blocked" : null,
    agentProfileId: request.agentProfileId,
  });
  const validated =
    centerAgentUpdateAgentProfileRuntimeSettingsResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Agent Profile runtime settings response: ${validated.error.message}`
    );
  }
  return validated.data;
}
/**
 * Center Agent settings changes are sensitive operations (§6): their root is
 * checked at the tool boundary above, and each decision is audited here.
 */
async function auditCenterAgentRuntimeSettings(
  env: CoreBindings,
  input: {
    agentProfileId: string;
    authorization: Awaited<
      ReturnType<typeof requireCurrentDesignatedCenterAgentCaller>
    >;
    outcome: "confirmation_required" | "failed" | "succeeded";
    owner: Awaited<ReturnType<typeof resolveCenterAgentProductOperationOwner>>;
    reasonCode: string | null;
  }
): Promise<void> {
  if (!isRequestChainEnforced()) {
    return;
  }
  await recordSensitiveOperationOutcome(env, {
    caller: {
      humanProfileId: input.owner.representedProfileId,
      organizationId: input.authorization.activeOrganization.organizationId,
      userId: input.owner.representedUserId,
    },
    decision: {
      chainRootProfileId: input.owner.representedProfileId,
      confirmationId: null,
      sourceKind: "center_agent",
      taskExecutionId: null,
    },
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    request: {
      agentProfileId: input.agentProfileId,
      operation: "runtime_settings_write",
    },
  });
}
export async function rpcCenterAgentCheckAgentProfileReadiness(
  env: CoreBindings,
  input: CenterAgentCheckAgentProfileReadinessInput
): Promise<CenterAgentCheckAgentProfileReadinessResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentCheckAgentProfileReadinessBodySchema.safeParse({
    agentProfileId: input.agentProfileId,
    includeDefaultProjectConnection: input.includeDefaultProjectConnection,
    includeFolders: input.includeFolders,
    onBehalfOf: input.onBehalfOf,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Agent Profile readiness payload",
      code: "invalid_payload",
    });
  }
  const response = await checkAgentProfileReadinessOperation({
    agentProfileId: parsed.data.agentProfileId,
    deps: buildCenterAgentProductOperationDeps(
      env,
      authorization,
      await resolveCenterAgentProductOperationOwner(
        authorization,
        parsed.data.onBehalfOf
      ),
      {
        includeDefaultProjectConnection:
          parsed.data.includeDefaultProjectConnection,
        includeFolders: parsed.data.includeFolders,
      }
    ),
  });
  const validated =
    centerAgentCheckAgentProfileReadinessResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Agent Profile readiness response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function resolveCenterAgentProductOperationOwner(
  authorization: Awaited<
    ReturnType<typeof requireCurrentDesignatedCenterAgentCaller>
  >,
  onBehalfOf:
    | {
        profileId: string;
      }
    | undefined
): Promise<{
  representedContext: OpenMeldRequestContext;
  representedProfileId: string;
  representedUserId: string;
  sourceNativeDeliveryId: string | null;
}> {
  if (!onBehalfOf) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "center_agent.member_actor_required",
      reason:
        "A verified requesting member is required to manage a local Agent.",
    });
  }
  const member = await readResolvedOrganizationDirectorySpaceMember({
    db: authorization.db,
    organizationId: authorization.activeOrganization.organizationId,
    profileId: onBehalfOf.profileId,
  });
  if (!(member?.ownerUserId && member.profileKind === "human")) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "center_agent.member_actor_required",
      reason: "The requesting member is no longer available.",
    });
  }
  const root = isRequestChainEnforced()
    ? await readCenterAgentRequestChainRoot(authorization)
    : null;
  if (
    isRequestChainEnforced() &&
    !(
      root &&
      root.profileId === member.profileId &&
      root.userId === member.ownerUserId
    )
  ) {
    // The root of this turn's request chain is the member Core recorded on
    // the native delivery, never a member named in the tool arguments.
    throw createCoreRpcHttpError({
      status: 403,
      code: "center_agent.request_chain_root_mismatch",
      reason:
        "Only the member who asked in this conversation can change their own Agents.",
    });
  }
  return {
    representedProfileId: member.profileId,
    sourceNativeDeliveryId: root?.nativeDeliveryId ?? null,
    representedUserId: member.ownerUserId,
    representedContext: {
      activeOrganizationId: authorization.activeOrganization.organizationId,
      actorContext: {
        callerPrincipalId: member.ownerUserId,
        ownerUserId: member.ownerUserId,
        openMeldProfileId: member.profileId,
        profileKind: "human",
        profileName: member.profileName,
        requestId: authorization.context.actorContext.requestId,
      },
    },
  };
}
/**
 * Reconnecting an existing Binding must not change its permission mode
 * without the member's separate confirmation, which only the runtime
 * settings operation collects. Connecting a new Binding is additive.
 */
async function refuseUnconfirmedCenterAgentPermissionModeChange(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  ownerUserId: string;
  requestedMode: string | undefined;
}): Promise<void> {
  if (!isRequestChainEnforced() || input.requestedMode === undefined) {
    return;
  }
  const existing = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: { id: input.ownerUserId, kind: "owner_account" },
  });
  if (
    existing &&
    (existing.agentControllerPermissionMode ?? null) !== input.requestedMode
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.permission_mode_confirmation_required",
      reason:
        "Changing this Agent's permission mode needs the member's separate confirmation. Connect without a permission mode, then change it with openmeld_update_agent_profile_runtime_settings.",
      status: 409,
    });
  }
}
/**
 * The human root of the Center Agent's current turn: the member Core recorded
 * on the active native delivery this tool call belongs to.
 */
async function readCenterAgentRequestChainRoot(
  authorization: Awaited<
    ReturnType<typeof requireCurrentDesignatedCenterAgentCaller>
  >
): Promise<{
  nativeDeliveryId: string;
  profileId: string;
  userId: string;
} | null> {
  const submissionId =
    authorization.context.agentControllerConversationId?.trim();
  if (!submissionId) {
    return null;
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: authorization.db,
    submissionId,
  });
  if (
    !(
      delivery &&
      (delivery.status === "accepted" ||
        delivery.status === "retry_observed") &&
      delivery.organizationId ===
        authorization.activeOrganization.organizationId &&
      delivery.profileId === authorization.actorProfileId &&
      delivery.onBehalfOfProfileId &&
      delivery.onBehalfOfUserId
    )
  ) {
    return null;
  }
  return {
    nativeDeliveryId: delivery.deliveryId,
    profileId: delivery.onBehalfOfProfileId,
    userId: delivery.onBehalfOfUserId,
  };
}
function buildCenterAgentProductOperationDeps(
  env: CoreBindings,
  authorization: Awaited<
    ReturnType<typeof requireCurrentDesignatedCenterAgentCaller>
  >,
  preferenceOwner?: {
    representedContext: OpenMeldRequestContext | null;
    representedUserId: string | null;
  },
  options?: {
    includeDefaultProjectConnection?: boolean;
    includeFolders?: boolean;
  }
): CenterAgentProductOperationDeps {
  const context = authorization.context;
  const organizationId = authorization.activeOrganization.organizationId;
  const representedContext = preferenceOwner?.representedContext ?? null;
  const representedUserId = preferenceOwner?.representedUserId ?? null;
  const ownerContext = representedContext ?? context;
  return {
    addAgentProfileToSpace: async ({ agentProfileId, onBehalfOf, spaceId }) => {
      await rpcCenterAgentAddAgentProfilesToSpace(env, {
        agentProfileIds: [agentProfileId],
        context,
        ...(onBehalfOf === undefined ? {} : { onBehalfOf }),
        spaceId,
      });
    },
    checkAgentProfileReadiness: async ({ agentProfileId }) => {
      const readiness = await rpcGetAgentExecutionReadiness(env, {
        agentProfileId,
        context: ownerContext,
      });
      const response = buildCenterAgentReadinessResponse({
        organizationId,
        readiness,
      });
      return {
        ...response,
        ...(options?.includeDefaultProjectConnection
          ? {
              defaultProjectConnection:
                await readCenterAgentDefaultProjectConnection(env, {
                  agentProfileId,
                  context: ownerContext,
                  organizationId,
                }),
            }
          : {}),
        ...(options?.includeFolders
          ? {
              folders: await readCenterAgentAgentProfileFolders(env, {
                agentProfileId,
                context: ownerContext,
              }),
            }
          : {}),
      };
    },
    createAgentProfile: async ({ onBehalfOf, profileName }) =>
      await rpcCenterAgentCreateAgentProfile(env, {
        context,
        ...(onBehalfOf === undefined ? {} : { onBehalfOf }),
        profileName,
      }),
    enableAgentProfile: async ({ agentProfileId, onBehalfOf }) => {
      await rpcCenterAgentEnableAgentProfile(env, {
        agentProfileId,
        context,
        ...(onBehalfOf === undefined ? {} : { onBehalfOf }),
      });
    },
    ensureAgentProfilePrimaryBinding: async ({
      agentProfileId,
      candidate,
      settings,
    }) =>
      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentControllerRef: candidate.agentControllerRef,
        agentProfileId,
        context: ownerContext,
        deviceId: candidate.deviceId,
        lane: candidate.runtimeLane,
        openMeldServiceRuntimeId: candidate.openMeldServiceRuntimeId,
        writeMode: "reconnect",
        ...(settings.agentControllerCollaborationMode === undefined
          ? {}
          : {
              agentControllerCollaborationMode:
                settings.agentControllerCollaborationMode,
            }),
        ...(settings.agentControllerPermissionMode === undefined
          ? {}
          : {
              agentControllerPermissionMode:
                settings.agentControllerPermissionMode,
            }),
        ...(settings.modelId === undefined
          ? {}
          : { modelId: settings.modelId }),
        ...(settings.openCodePermission === undefined
          ? {}
          : { openCodePermission: settings.openCodePermission }),
        ...(settings.reasoningLevel === undefined
          ? {}
          : { reasoningLevel: settings.reasoningLevel }),
      }),
    listLocalAgentConnectionCandidates: async () => {
      const peopleComputers = await rpcListPeopleComputers(env, {
        context: ownerContext,
      });
      return projectCenterAgentLocalAgentConnectionCandidates({
        peopleComputers,
        organizationId,
      });
    },
    ...(representedUserId
      ? {
          rememberAgentProfileCreationDefaults: async ({
            agentControllerRef,
            configuration,
          }) => {
            await rememberAgentProfileCreationDefaults({
              localComponentsManifest: (
                await readCoreLocalComponentsRelease(env.OPENMELD_CLI_RELEASES)
              ).manifest,
              agentControllerRef,
              db: requireAgentProfileBindingDb(env),
              nowMs: Date.now(),
              organizationId,
              selection: configuration,
              userId: representedUserId,
            });
          },
        }
      : {}),
    ...(representedContext
      ? {
          setAgentProfileDefaultProject: async ({
            agentProfileId,
            defaultProjectId,
            expectedBindingTarget,
          }) => {
            await rpcUpdateAgentProfileDefaultProject(
              env,
              {
                agentProfileId,
                context: representedContext,
                defaultProjectId,
                expectedOrganizationId: organizationId,
              },
              expectedBindingTarget
            );
          },
        }
      : {}),
    setAgentProfileWorkspace: async ({
      agentProfileId,
      workspaceMode,
      workspacePath,
    }) => {
      const { target, bindingTarget } =
        await resolveBoundAgentProfileComputerContext(env, {
          agentProfileId,
          context: ownerContext,
        });
      const workspace = await rpcSetCurrentAgentProfileWorkspace(
        env,
        {
          agentProfileId,
          context: ownerContext,
          workspaceMode,
          ...(workspacePath === undefined ? {} : { workspacePath }),
        },
        target,
        bindingTarget
      );
      return { ...workspace, target, bindingTarget };
    },
    setAgentProfileDefaultFolder: async ({ agentProfileId, folderId }) => {
      const { target, bindingTarget } =
        await resolveBoundAgentProfileComputerContext(env, {
          agentProfileId,
          context: ownerContext,
        });
      const saved = await rpcSetAgentProfileDefaultFolder(
        env,
        { agentProfileId, context: ownerContext, folderId },
        target,
        bindingTarget
      );
      return {
        agentProfileId: saved.agentProfileId,
        bindingTarget,
        status: "updated",
        target,
      };
    },
    updateAgentControllerPermissionMode: async ({
      agentControllerPermissionMode,
      agentProfileId,
    }) =>
      await rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
        env,
        {
          agentControllerPermissionMode,
          agentProfileId,
          context: ownerContext,
        }
      ),
    updateAgentControllerCollaborationMode: async ({
      agentControllerCollaborationMode,
      agentProfileId,
    }) =>
      await rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
        env,
        {
          agentControllerCollaborationMode,
          agentProfileId,
          context: ownerContext,
        }
      ),
    updateModelSelection: async ({ agentProfileId, modelId, reasoningLevel }) =>
      await rpcUpdateAgentProfilePrimaryBindingModelSelection(env, {
        agentProfileId,
        context: ownerContext,
        modelId,
        ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
      }),
    updateOpenCodePermission: async ({ agentProfileId, openCodePermission }) =>
      await rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(env, {
        agentProfileId,
        context: ownerContext,
        openCodePermission,
      }),
  };
}
async function readCenterAgentDefaultProjectConnection(
  env: CoreBindings,
  input: {
    agentProfileId: string;
    context: OpenMeldRequestContext;
    organizationId: string;
  }
): Promise<
  NonNullable<
    CenterAgentCheckAgentProfileReadinessResponse["defaultProjectConnection"]
  >
> {
  const unknown = {
    checkedAtMs: null,
    configurationVersion: null,
    projectId: null,
    reasonCode: "profile.default_project.unavailable",
    status: "unavailable" as const,
    target: null,
  };
  const facts = await readAuthProfileFacts({
    authWorker: env.OPENMELD_AUTH_WORKER,
    profileIds: [input.agentProfileId],
  });
  const profile = facts?.get(input.agentProfileId);
  if (
    !profile ||
    profile.ownerUserId !== requireAuthenticatedOwnerUserId(input.context) ||
    profile.organizationId !== input.organizationId ||
    profile.defaultProjectId === undefined
  ) {
    return unknown;
  }
  const projectId = profile.defaultProjectId;
  if (!projectId) {
    return { ...unknown, reasonCode: null, status: "not_selected" };
  }
  let target: PeopleComputerTarget;
  try {
    target = await resolveBoundAgentProfileComputerTarget(env, input);
  } catch {
    return {
      ...unknown,
      projectId,
      reasonCode: "agent_profile_binding.target_unavailable",
    };
  }
  try {
    const discovery = await rpcDiscoverPeopleComputerProjects(env, {
      ...target,
      clientGeneration: 0,
      context: input.context,
      expectedOrganizationId: input.organizationId,
      includeCandidates: false,
      projectIds: [projectId],
    });
    const project = discovery.projects.find(
      (item) => item.projectId === projectId
    );
    if (
      discovery.deviceId !== target.deviceId ||
      !project ||
      project.status === "verification_unavailable"
    ) {
      return {
        ...unknown,
        projectId,
        target,
        reasonCode: "project.local_connection.verification_unavailable",
      };
    }
    const confirmed = {
      checkedAtMs: discovery.checkedAtMs,
      configurationVersion:
        project.connections.find((connection) => connection.isDefault)
          ?.bindingGeneration ?? null,
      projectId,
      target,
    };
    if (project.status === "connected") {
      return { ...confirmed, status: "connected", reasonCode: null };
    }
    if (project.status === "connected_folder_missing") {
      return {
        ...confirmed,
        status: "folder_missing",
        reasonCode: "project.local_connection.folder_missing",
      };
    }
    return {
      ...confirmed,
      status: "not_connected",
      reasonCode: "project.local_connection.missing",
    };
  } catch (error) {
    return {
      ...unknown,
      projectId,
      target,
      reasonCode:
        readSafeRpcFailureReasonCode(error) ??
        "project.local_connection.unavailable",
    };
  }
}
export async function rpcCenterAgentCreateSpace(
  env: CoreBindings,
  input: CenterAgentCreateSpaceInput
): Promise<CenterAgentCreateSpaceResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentCreateSpaceBodySchema.safeParse({
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.guide === undefined ? {} : { guide: input.guide }),
    visibility: input.visibility,
    ...(input.accessMode === undefined ? {} : { accessMode: input.accessMode }),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ?? "invalid Center Agent Space payload",
      code: "invalid_payload",
    });
  }
  // The Center Agent has no owning member, so the represented member must
  // become the initial human owner. Resolve it before any Space write.
  const representedOwner = await resolveCenterAgentSpaceOwner({
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
  });
  const created = await createSpaceWithResolvedId(env, {
    spaceId: resolveNewSpaceId(env.OPENMELD_SPACES).toString(),
    initialOwnerMember: representedOwner,
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
    ...(typeof parsed.data.purpose === "string"
      ? { purpose: parsed.data.purpose }
      : {}),
    ...(typeof parsed.data.guide === "string"
      ? { guide: parsed.data.guide }
      : {}),
    ...(parsed.data.accessMode === undefined
      ? {}
      : { accessMode: parsed.data.accessMode }),
    organizationId: authorization.activeOrganization.organizationId,
    ...(parsed.data.password === undefined
      ? {}
      : { password: parsed.data.password }),
    visibility: parsed.data.visibility,
    context: authorization.context,
  });
  const attribution = await writeCenterAgentAuditEntry({
    action: "create_space",
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    resource: { type: "space", id: created.spaceId },
  });
  const response: CenterAgentCreateSpaceResponse = {
    organizationId: authorization.activeOrganization.organizationId,
    attribution,
    ...(created.meta === undefined ? {} : { meta: created.meta }),
    resource: { type: "space", id: created.spaceId },
    spaceId: created.spaceId,
  };
  const validated = centerAgentCreateSpaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space creation response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function resolveCenterAgentSpaceOwner(input: {
  authorization: Awaited<
    ReturnType<typeof requireCurrentDesignatedCenterAgentCaller>
  >;
  onBehalfOfProfileId: string | null;
}): Promise<ResolvedSpaceMemberProfile> {
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization: input.authorization,
    onBehalfOfProfileId: input.onBehalfOfProfileId,
  });
  const ownerUserId = attribution.onBehalfOf?.userId;
  if (!(ownerUserId && input.onBehalfOfProfileId)) {
    throw createCoreRpcHttpError({
      code: "center_agent.represented_member_required",
      reason: "Choose the member who will own this Space.",
      status: 403,
    });
  }
  const member = await readResolvedOrganizationDirectorySpaceMember({
    db: input.authorization.db,
    organizationId: input.authorization.activeOrganization.organizationId,
    profileId: input.onBehalfOfProfileId,
  });
  if (
    !(
      member &&
      member.profileKind === "human" &&
      member.ownerUserId === ownerUserId
    )
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.represented_member_required",
      reason: "Choose a current Organization member to own this Space.",
      status: 403,
    });
  }
  return member;
}
export async function rpcCenterAgentCreateAgentProfile(
  env: CoreBindings,
  input: CenterAgentCreateAgentProfileInput
): Promise<CenterAgentCreateAgentProfileResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentCreateAgentProfileBodySchema.safeParse({
    profileName: input.profileName,
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Agent Profile payload",
      code: "invalid_payload",
    });
  }
  const requestedAttribution = await resolveCenterAgentAuditAttribution({
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
  });
  const representedOwnerUserId = requestedAttribution.onBehalfOf?.userId;
  if (!representedOwnerUserId) {
    throw createCoreRpcHttpError({
      code: "center_agent.represented_member_required",
      reason: "Choose the member who will own this Agent.",
      status: 403,
    });
  }
  const created = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.createAgentProfileInOrganization({
        organizationId: authorization.activeOrganization.organizationId,
        ownerUserId: representedOwnerUserId,
        createdByUserId: representedOwnerUserId,
        creationActorProfileId: authorization.actorProfileId,
        idempotencyKey: buildCenterAgentAgentProfileCreationIdempotencyKey({
          profileName: parsed.data.profileName,
          requestId: authorization.context.actorContext.requestId,
        }),
        profileName: parsed.data.profileName,
        source: "center_agent_create",
      }),
    unavailable: {
      code: "center_agent.profile_create_unavailable",
      reason: "Agent Profile creation is unavailable.",
    },
  });
  if (!created.ok) {
    throw createCoreRpcHttpError({
      status: 502,
      reason: created.message,
      code: created.code,
    });
  }
  const attribution = await writeCenterAgentAuditEntry({
    action: "create_agent_profile",
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    resource: { type: "agent_profile", id: created.profile.openMeldProfileId },
  });
  const response: CenterAgentCreateAgentProfileResponse = {
    organizationId: authorization.activeOrganization.organizationId,
    attribution,
    resource: { type: "agent_profile", id: created.profile.openMeldProfileId },
    profile: created.profile,
  };
  const validated =
    centerAgentCreateAgentProfileResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Agent Profile creation response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function buildCenterAgentAgentProfileCreationIdempotencyKey(input: {
  profileName: string;
  requestId: string;
}): string {
  return `center-agent:create-agent-profile:${input.requestId}:${input.profileName}`;
}
export async function rpcCenterAgentEnableAgentProfile(
  env: CoreBindings,
  input: CenterAgentEnableAgentProfileInput
): Promise<CenterAgentEnableAgentProfileResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentEnableAgentProfileBodySchema.safeParse({
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent profile enable payload",
      code: "invalid_payload",
    });
  }
  const agentProfileId = normalizeRequiredText(
    input.agentProfileId,
    "agentProfileId"
  );
  const profileOrganization = await readAgentProfileOrganizationContext({
    db: requireCenterAgentDb(env),
    agentProfileId,
  });
  if (!profileOrganization) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Agent Profile was not found.",
      code: "center_agent.profile_not_found",
    });
  }
  if (
    profileOrganization.profileKind !== "agent" ||
    profileOrganization.organizationId !==
      authorization.activeOrganization.organizationId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Agent Profile does not belong to this Organization.",
      code: "center_agent.profile_org_mismatch",
    });
  }
  await requireCenterAgentDb(env).query({
    text: `
        UPDATE "openmeld"."openmeld_profiles"
        SET status = 'active',
            updated_at = $1
        WHERE profile_id = $2
          AND organization_id = $3
          AND profile_kind = 'agent'
      `,
    values: [
      Date.now(),
      agentProfileId,
      authorization.activeOrganization.organizationId,
    ],
  });
  const attribution = await writeCenterAgentAuditEntry({
    action: "enable_agent_profile",
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    resource: { type: "agent_profile", id: agentProfileId },
  });
  const response: CenterAgentEnableAgentProfileResponse = {
    organizationId: authorization.activeOrganization.organizationId,
    attribution,
    resource: { type: "agent_profile", id: agentProfileId },
    agentProfileId,
    enabled: true,
  };
  const validated =
    centerAgentEnableAgentProfileResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent profile enable response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentAddAgentProfilesToSpace(
  env: CoreBindings,
  input: CenterAgentAddAgentProfilesToSpaceInput
): Promise<CenterAgentAddAgentProfilesToSpaceResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentAddAgentProfilesToSpaceBodySchema.safeParse({
    agentProfileIds: input.agentProfileIds,
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
    ...(input.password === undefined ? {} : { password: input.password }),
    spaceId: input.spaceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Space member payload",
      code: "invalid_payload",
    });
  }
  const agentProfileIds = [...new Set(parsed.data.agentProfileIds)];
  const db = requireCenterAgentDb(env);
  const members = await Promise.all(
    agentProfileIds.map(async (agentProfileId) => {
      const member = await readResolvedOrganizationSpaceMember({
        db,
        organizationId: authorization.activeOrganization.organizationId,
        profileId: agentProfileId,
      });
      if (!member) {
        throw createCoreRpcHttpError({
          status: 404,
          reason: "Agent Profile is not available in this Organization.",
          code: "center_agent.space_member_profile_not_found",
        });
      }
      if (member.profileKind !== "agent") {
        throw createCoreRpcHttpError({
          status: 400,
          reason: "Center Agent can only add Agent Profiles with this tool.",
          code: "center_agent.space_member_agent_required",
        });
      }
      return member;
    })
  );
  const membership = await rpcAddSpaceMembers(env, {
    context: authorization.context,
    members,
    ...(parsed.data.password === undefined
      ? {}
      : { password: parsed.data.password }),
    spaceId: parsed.data.spaceId,
  });
  const attribution = await writeCenterAgentAuditEntry({
    action: "add_agent_profiles_to_space",
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    resource: { type: "space", id: parsed.data.spaceId },
  });
  const response: CenterAgentAddAgentProfilesToSpaceResponse = {
    agentProfileIds,
    attribution,
    membership,
    organizationId: authorization.activeOrganization.organizationId,
    resource: { type: "space", id: parsed.data.spaceId },
    spaceId: parsed.data.spaceId,
  };
  const validated =
    centerAgentAddAgentProfilesToSpaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space member response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentAddMembersToSpace(
  env: CoreBindings,
  input: CenterAgentAddMembersToSpaceInput
): Promise<CenterAgentAddMembersToSpaceResponse> {
  const parsed = centerAgentAddMembersToSpaceBodySchema.safeParse({
    memberUserIds: input.memberUserIds,
    spaceId: input.spaceId,
    speakerMember: input.speakerMember,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Organization member payload",
      code: "invalid_payload",
    });
  }
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.space_members_speaker_required",
        reason:
          "Adding Organization members to a Space requires a verified active human Organization member.",
      }
    );
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.data.spaceId,
  });
  const memberUserIds = [...new Set(parsed.data.memberUserIds)];
  const directoryMembers = await resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: authorization.activeOrganization.organizationId,
    requestId: authorization.context.actorContext.requestId,
  });
  const directoryMemberByUserId = new Map(
    directoryMembers.map((member) => [member.userId, member] as const)
  );
  const rejectedResultByUserId = new Map<
    string,
    CenterAgentAddMembersToSpaceResult
  >();
  const memberByUserId = new Map<string, ResolvedSpaceMemberProfile>();
  for (const memberUserId of memberUserIds) {
    const directoryMember = directoryMemberByUserId.get(memberUserId);
    if (!directoryMember) {
      rejectedResultByUserId.set(memberUserId, {
        code: "not_organization_member",
        memberUserId,
        message:
          "This user is not an active member of the current Organization.",
        status: "rejected",
      });
      continue;
    }
    if (directoryMember.humanProfile?.status !== "active") {
      rejectedResultByUserId.set(memberUserId, {
        code: "active_human_profile_required",
        memberUserId,
        message:
          "This Organization member does not have an active Human Profile to add to the Space.",
        status: "rejected",
      });
      continue;
    }
    const humanProfile = directoryMember.humanProfile;
    const member = resolvedSpaceMemberProfileSchema.safeParse({
      agentControllerRef: null,
      ownerName: directoryMember.user.name,
      ownerUserId: memberUserId,
      profileId: humanProfile.profileId,
      profileKind: "human",
      profileName: humanProfile.profileName,
    });
    if (!member.success) {
      throw new Error(
        `failed to build Organization member Space profile: ${member.error.message}`
      );
    }
    memberByUserId.set(memberUserId, member.data);
  }
  const attribution = await writeCenterAgentAuditEntry({
    action: "add_members_to_space",
    authorization,
    onBehalfOfProfileId: representedHuman.profileId,
    resource: { type: "space", id: parsed.data.spaceId },
    sourceNativeDeliveryId,
  });
  const members = [...memberByUserId.values()];
  const membership: PostSpaceMembersResponse =
    members.length > 0
      ? await rpcAddSpaceMembers(env, {
          context: authorization.context,
          members,
          spaceId: parsed.data.spaceId,
        })
      : { addedMemberIds: [], alreadyMemberIds: [], items: [] };
  const addedMemberIds = new Set(membership.addedMemberIds);
  const alreadyMemberIds = new Set(membership.alreadyMemberIds);
  const results = memberUserIds.map((memberUserId) => {
    const rejected = rejectedResultByUserId.get(memberUserId);
    if (rejected) {
      return rejected;
    }
    const member = memberByUserId.get(memberUserId);
    if (!member) {
      throw new Error(
        `Organization member ${memberUserId} is missing its Space member result`
      );
    }
    if (addedMemberIds.has(member.profileId)) {
      return {
        memberUserId,
        profileId: member.profileId,
        status: "added" as const,
      };
    }
    if (!alreadyMemberIds.has(member.profileId)) {
      throw new Error(
        `Space member mutation omitted Organization member ${memberUserId}`
      );
    }
    return {
      memberUserId,
      profileId: member.profileId,
      status: "already_member" as const,
    };
  });
  const response: CenterAgentAddMembersToSpaceResponse = {
    attribution,
    membership,
    organizationId: authorization.activeOrganization.organizationId,
    resource: { type: "space", id: parsed.data.spaceId },
    results,
    spaceId: parsed.data.spaceId,
  };
  const validated =
    centerAgentAddMembersToSpaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Organization member response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentRemoveAgentProfilesFromSpace(
  env: CoreBindings,
  input: CenterAgentRemoveAgentProfilesFromSpaceInput
): Promise<CenterAgentRemoveAgentProfilesFromSpaceResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentRemoveAgentProfilesFromSpaceBodySchema.safeParse({
    agentProfileIds: input.agentProfileIds,
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
    spaceId: input.spaceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Space member removal payload",
      code: "invalid_payload",
    });
  }
  const agentProfileIds = [...new Set(parsed.data.agentProfileIds)];
  const db = requireCenterAgentDb(env);
  await Promise.all(
    agentProfileIds.map(async (agentProfileId) => {
      const member = await readResolvedOrganizationSpaceMember({
        db,
        organizationId: authorization.activeOrganization.organizationId,
        profileId: agentProfileId,
      });
      if (!member) {
        throw createCoreRpcHttpError({
          status: 404,
          reason: "Agent Profile is not available in this Organization.",
          code: "center_agent.space_member_profile_not_found",
        });
      }
      if (member.profileKind !== "agent") {
        throw createCoreRpcHttpError({
          status: 400,
          reason: "Center Agent can only remove Agent Profiles with this tool.",
          code: "center_agent.space_member_agent_required",
        });
      }
    })
  );
  const membership = await rpcRemoveSpaceMembers(env, {
    context: authorization.context,
    memberProfileIds: agentProfileIds,
    spaceId: parsed.data.spaceId,
  });
  const attribution = await writeCenterAgentAuditEntry({
    action: "remove_agent_profiles_from_space",
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    resource: { type: "space", id: parsed.data.spaceId },
  });
  const response: CenterAgentRemoveAgentProfilesFromSpaceResponse = {
    agentProfileIds,
    attribution,
    membership,
    organizationId: authorization.activeOrganization.organizationId,
    resource: { type: "space", id: parsed.data.spaceId },
    spaceId: parsed.data.spaceId,
  };
  const validated =
    centerAgentRemoveAgentProfilesFromSpaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space member removal response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentGetOrganizationDirectory(
  env: CoreBindings,
  input: CenterAgentReadOrganizationDirectoryInput
): Promise<OrganizationDirectoryResponse> {
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  const { authorization } = prepared;
  const response = await rpcGetCurrentOrganizationDirectory(env, {
    context: authorization.context,
    ...(input.includeMemberLastActiveAt
      ? { includeMemberLastActiveAt: true }
      : {}),
  });
  await writeCenterAgentAuditEntry({
    action: "read_org_directory",
    authorization,
    onBehalfOfProfileId: null,
    resource: {
      type: "organization",
      id: authorization.activeOrganization.organizationId,
    },
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  });
  return response;
}
/**
 * Bounded member-only Organization read for Center Agent tools. It reuses the
 * Auth-owned Organization Directory projection as its only source and never
 * resolves Agent Profiles or their readiness; `rpcCenterAgentGetOrganizationDirectory`
 * remains the broad authority for callers that need Agent Profiles.
 */
export async function rpcCenterAgentListOrganizationMembers(
  env: CoreBindings,
  input: CenterAgentListOrganizationMembersToolRpcInput
): Promise<CenterAgentListOrganizationMembersResponse> {
  const parsed =
    centerAgentListOrganizationMembersToolRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Organization member list payload",
      code: "invalid_payload",
    });
  }
  const prepared = await prepareCenterAgentOrganizationMemberRead(
    env,
    parsed.data
  );
  const { authorization } = prepared;
  const members = await resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: authorization.activeOrganization.organizationId,
    requestId: authorization.context.actorContext.requestId,
  });
  const sortedMembers = [...members].sort(
    (left, right) =>
      left.user.name.localeCompare(right.user.name, undefined, {
        sensitivity: "base",
      }) || left.userId.localeCompare(right.userId)
  );
  const limit =
    parsed.data.limit ?? CENTER_AGENT_ORGANIZATION_MEMBERS_LIST_DEFAULT_LIMIT;
  let startIndex = 0;
  if (parsed.data.cursor !== undefined) {
    const cursor = decodeOrganizationMembersListCursor(parsed.data.cursor);
    startIndex =
      sortedMembers.findIndex((member) => member.userId === cursor.id) + 1;
    if (startIndex === 0) {
      throw createCoreRpcHttpError({
        status: 400,
        reason: "The Organization member list cursor is invalid.",
        code: "center_agent.member_list_invalid_cursor",
      });
    }
  }
  const page = sortedMembers.slice(startIndex, startIndex + limit);
  const lastMember = page.at(-1);
  const nextCursor =
    startIndex + limit < sortedMembers.length && lastMember
      ? encodeOrganizationMembersListCursor({ id: lastMember.userId })
      : null;
  const response = centerAgentListOrganizationMembersResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    members: page,
    nextCursor,
    organizationId: authorization.activeOrganization.organizationId,
    totalMembers: members.length,
  });
  await writeCenterAgentAuditEntry({
    action: "read_org_directory",
    authorization,
    onBehalfOfProfileId: null,
    resource: {
      type: "organization",
      id: authorization.activeOrganization.organizationId,
    },
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  });
  return response;
}
type OrganizationMembersListCursor = {
  id: string;
};
function encodeOrganizationMembersListCursor(
  cursor: OrganizationMembersListCursor
): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}
function decodeOrganizationMembersListCursor(
  value: string
): OrganizationMembersListCursor {
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(value))
    ) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("id" in parsed) ||
      typeof parsed.id !== "string" ||
      !parsed.id.trim()
    ) {
      throw new Error("Cursor payload is invalid");
    }
    return { id: parsed.id };
  } catch {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "The Organization member list cursor is invalid.",
      code: "center_agent.member_list_invalid_cursor",
    });
  }
}
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const BASE64URL_PADDING_PATTERN = /=+$/u;
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64URL_PADDING_PATTERN, "");
}
function base64UrlToBytes(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error("Cursor is not base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export async function rpcCenterAgentReadMemberComputers(
  env: CoreBindings,
  input: CenterAgentReadMemberComputersInput
): Promise<CenterAgentReadMemberComputersResponse> {
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  const { authorization } = prepared;
  const {
    context: _context,
    speakerMember: _speakerMember,
    ...requestBody
  } = input;
  const parsed =
    centerAgentReadMemberComputersBodySchema.safeParse(requestBody);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Organization member Computers payload",
      code: "invalid_payload",
    });
  }
  const targetMembership = await resolveOrganizationMembershipById({
    env,
    organizationId: authorization.activeOrganization.organizationId,
    requestId: authorization.context.actorContext.requestId,
    userId: parsed.data.memberUserId,
  });
  if (!targetMembership.ok) {
    if (targetMembership.code === "organization.context_unavailable") {
      throw createCoreRpcHttpError({
        status: targetMembership.status,
        reason: targetMembership.message,
        code: targetMembership.code,
      });
    }
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Member was not found in the current Organization.",
      code: "center_agent.member_not_found",
    });
  }
  const generatedAt = new Date().toISOString();
  const computers = await buildOrganizationComputersResponse({
    env,
    generatedAt,
    includeUsageLimits: input.includeUsageLimits === "true",
    memberUserIds: [targetMembership.userId],
    organizationId: targetMembership.organizationId,
  });
  const response = centerAgentReadMemberComputersResponseSchema.parse({
    ...computers,
    memberUserId: targetMembership.userId,
  });
  await writeCenterAgentAuditEntry({
    action: "read_member_computers",
    authorization,
    onBehalfOfProfileId: null,
    resource: {
      type: "organization_member",
      id: targetMembership.userId,
    },
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  });
  return response;
}
export async function rpcCenterAgentReadMemberOpenMeldServiceStatus(
  env: CoreBindings,
  input: CenterAgentReadMemberOpenMeldServiceStatusInput
): Promise<CenterAgentReadMemberOpenMeldServiceStatusResponse> {
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  const { authorization } = prepared;
  const {
    context: _context,
    speakerMember: _speakerMember,
    ...requestBody
  } = input;
  const parsed =
    centerAgentReadMemberOpenMeldServiceStatusBodySchema.safeParse(requestBody);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Organization member OpenMeld Service status payload",
      code: "invalid_payload",
    });
  }
  const targetMembership = await resolveOrganizationMembershipById({
    env,
    organizationId: authorization.activeOrganization.organizationId,
    requestId: authorization.context.actorContext.requestId,
    userId: parsed.data.memberUserId,
  });
  if (!targetMembership.ok) {
    if (targetMembership.code === "organization.context_unavailable") {
      throw createCoreRpcHttpError({
        status: targetMembership.status,
        reason: targetMembership.message,
        code: targetMembership.code,
      });
    }
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Member was not found in the current Organization.",
      code: "center_agent.member_not_found",
    });
  }
  const generatedAt = new Date().toISOString();
  const statuses = await buildOrganizationMemberOpenMeldServiceStatusesResponse(
    {
      env,
      generatedAt,
      memberUserIds: [targetMembership.userId],
      organizationId: targetMembership.organizationId,
    }
  );
  const member = statuses.members[0];
  if (!member || member.userId !== targetMembership.userId) {
    throw new Error(
      "failed to resolve the requested Organization member OpenMeld Service status"
    );
  }
  const response =
    centerAgentReadMemberOpenMeldServiceStatusResponseSchema.parse({
      generatedAt,
      member,
      organizationId: targetMembership.organizationId,
    });
  await writeCenterAgentAuditEntry({
    action: "read_member_openmeld_service_status",
    authorization,
    onBehalfOfProfileId: null,
    resource: {
      type: "organization_member",
      id: targetMembership.userId,
    },
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  });
  return response;
}
function buildSlackReadUnavailable(input: {
  message: string;
  nextAction: string;
  organizationId: string;
  reasonCode: SlackReadUnavailableResponse["reasonCode"];
}): SlackReadUnavailableResponse {
  return slackReadUnavailableResponseSchema.parse({
    ...input,
    status: "unavailable",
  });
}
function buildSlackNotConnectedResult(
  organizationId: string
): SlackReadUnavailableResponse {
  return buildSlackReadUnavailable({
    message: "Slack isn't connected to this Organization yet.",
    nextAction: "Open Center Agent → Channels and choose Connect Slack.",
    organizationId,
    reasonCode: "slack_not_connected",
  });
}
function buildSlackConnectionStateUnavailableResult(
  organizationId: string
): SlackReadUnavailableResponse {
  return buildSlackReadUnavailable({
    message: "I can't check this Organization's Slack connection right now.",
    nextAction: "Try again in a moment.",
    organizationId,
    reasonCode: "connection_state_unavailable",
  });
}
export async function rpcCenterAgentReadSlackWorkspaceDirectory(
  env: CoreBindings,
  input: CenterAgentReadSlackWorkspaceDirectoryInput
): Promise<CenterAgentReadSlackWorkspaceDirectoryResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentReadSlackWorkspaceDirectoryBodySchema.safeParse({
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.includeMemberUserId === undefined
      ? {}
      : { includeMemberUserId: input.includeMemberUserId }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack workspace directory payload",
      status: 400,
    });
  }
  const organizationId = authorization.activeOrganization.organizationId;
  const slackDb = getPostgresDatabase(env);
  if (!slackDb) {
    return buildSlackConnectionStateUnavailableResult(organizationId);
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId,
  });
  if (!binding) {
    return buildSlackNotConnectedResult(organizationId);
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  const [slackPage, openMeldDirectory] = await Promise.all([
    listSlackWorkspaceMembers({
      botToken,
      ...(parsed.data.cursor === undefined
        ? {}
        : { cursor: parsed.data.cursor }),
      limit: parsed.data.limit,
    }),
    rpcGetCurrentOrganizationDirectory(env, {
      context: authorization.context,
    }),
  ]);
  const slackIdentityLinks = await readSlackUserIdentityLinksForUsers({
    db: slackDb,
    organizationId,
    slackTeamId: binding.slackTeamId,
    slackUserIds: slackPage.members.map((member) => member.slackUserId),
  });
  const response = {
    generatedAt: new Date().toISOString(),
    members: classifySlackWorkspaceMembers({
      includeMemberUserId: parsed.data.includeMemberUserId === true,
      slackIdentityLinks,
      slackMembers: slackPage.members,
      openMeldDirectory,
    }),
    nextCursor: slackPage.nextCursor,
    organizationId,
  };
  const validated = slackWorkspaceDirectoryResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Slack workspace directory response: ${validated.error.message}`
    );
  }
  await writeCenterAgentAuditEntry({
    action: "read_slack_workspace_directory",
    authorization,
    onBehalfOfProfileId: null,
    resource: { id: binding.slackTeamId, type: "slack_workspace" },
  });
  return validated.data;
}
export async function rpcCenterAgentListSlackChannels(
  env: CoreBindings,
  input: CenterAgentListSlackChannelsInput
): Promise<CenterAgentListSlackChannelsResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentListSlackChannelsBodySchema.safeParse({
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack channel list payload",
      status: 400,
    });
  }
  const organizationId = authorization.activeOrganization.organizationId;
  const slackDb = getPostgresDatabase(env);
  if (!slackDb) {
    return buildSlackConnectionStateUnavailableResult(organizationId);
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId,
  });
  if (!binding) {
    return buildSlackNotConnectedResult(organizationId);
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  const slackPage = await listSlackChannels({
    botToken,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    limit: parsed.data.limit,
  });
  const validated = slackChannelListResponseSchema.safeParse({
    channels: slackPage.channels.map((channel) => ({
      channelName: channel.channelName,
      isMember: channel.isMember,
      isPrivate: channel.isPrivate,
      memberCount: channel.memberCount,
    })),
    generatedAt: new Date().toISOString(),
    nextCursor: slackPage.nextCursor,
    organizationId,
  });
  if (!validated.success) {
    throw new Error(
      `failed to build Slack channel list response: ${validated.error.message}`
    );
  }
  await writeCenterAgentAuditEntry({
    action: "list_slack_channels",
    authorization,
    onBehalfOfProfileId: null,
    resource: { id: binding.slackTeamId, type: "slack_workspace" },
  });
  return validated.data;
}
export async function rpcCenterAgentReadSlackChannelMembers(
  env: CoreBindings,
  input: CenterAgentReadSlackChannelMembersInput
): Promise<CenterAgentReadSlackChannelMembersResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentReadSlackChannelMembersBodySchema.safeParse({
    channelName: input.channelName,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.includeChannelId === undefined
      ? {}
      : { includeChannelId: input.includeChannelId }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack channel member payload",
      status: 400,
    });
  }
  const organizationId = authorization.activeOrganization.organizationId;
  const slackDb = getPostgresDatabase(env);
  if (!slackDb) {
    return buildSlackConnectionStateUnavailableResult(organizationId);
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId,
  });
  if (!binding) {
    return buildSlackNotConnectedResult(organizationId);
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  const target = await resolveSlackChannelMessageTarget({
    botToken,
    channelName: parsed.data.channelName,
  });
  if (!target.isMember) {
    return buildSlackReadUnavailable({
      message: `OpenMeld hasn't been added to #${target.channelName} yet.`,
      nextAction: `In Slack, invite OpenMeld to #${target.channelName}, then ask me to try again.`,
      organizationId,
      reasonCode: "channel_access_required",
    });
  }
  const openMeldDirectoryPromise = rpcGetCurrentOrganizationDirectory(env, {
    context: authorization.context,
  });
  const slackMemberPage = await listSlackChannelMemberIds({
    botToken,
    channelId: target.channelId,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    limit: parsed.data.limit,
  });
  const [slackIdentityLinks, slackMembers, openMeldDirectory] =
    await Promise.all([
      readSlackUserIdentityLinksForUsers({
        db: slackDb,
        organizationId,
        slackTeamId: binding.slackTeamId,
        slackUserIds: slackMemberPage.memberIds,
      }),
      readSlackWorkspaceMembersByIds({
        botToken,
        memberIds: slackMemberPage.memberIds,
      }),
      openMeldDirectoryPromise,
    ]);
  const validated = slackChannelMembersResponseSchema.safeParse({
    ...(parsed.data.includeChannelId ? { channelId: target.channelId } : {}),
    channelName: target.channelName,
    generatedAt: new Date().toISOString(),
    members: classifySlackWorkspaceMembers({
      includeMemberUserId: false,
      slackIdentityLinks,
      slackMembers,
      openMeldDirectory,
    }),
    nextCursor: slackMemberPage.nextCursor,
    organizationId,
  });
  if (!validated.success) {
    throw new Error(
      `failed to build Slack channel member response: ${validated.error.message}`
    );
  }
  await writeCenterAgentAuditEntry({
    action: "read_slack_channel_members",
    authorization,
    onBehalfOfProfileId: null,
    resource: { id: target.channelId, type: "slack_channel" },
  });
  return validated.data;
}
export async function rpcCenterAgentReadSlackChannelHistory(
  env: CoreBindings,
  input: CenterAgentReadSlackChannelHistoryInput
): Promise<CenterAgentReadSlackChannelHistoryResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentReadSlackChannelHistoryBodySchema.safeParse({
    channelName: input.channelName,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.expectedChannelId === undefined
      ? {}
      : { expectedChannelId: input.expectedChannelId }),
    ...(input.includeFiles === undefined
      ? {}
      : { includeFiles: input.includeFiles }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack channel history payload",
      status: 400,
    });
  }
  const organizationId = authorization.activeOrganization.organizationId;
  const slackDb = getPostgresDatabase(env);
  if (!slackDb) {
    return buildSlackConnectionStateUnavailableResult(organizationId);
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId,
  });
  if (!binding) {
    return buildSlackNotConnectedResult(organizationId);
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  const target = await resolveSlackChannelMessageTarget({
    botToken,
    channelName: parsed.data.channelName,
  });
  if (
    parsed.data.expectedChannelId &&
    target.channelId !== parsed.data.expectedChannelId
  ) {
    throw createCoreRpcHttpError({
      code: "slack.channel_identity_changed",
      reason:
        "The Slack channel identity changed after its members were checked. Read the channel members again before reading message history.",
      status: 409,
    });
  }
  if (!target.isMember) {
    return buildSlackReadUnavailable({
      message: `OpenMeld hasn't been added to #${target.channelName} yet.`,
      nextAction: `In Slack, invite OpenMeld to #${target.channelName}, then ask me to try again.`,
      organizationId,
      reasonCode: "channel_access_required",
    });
  }
  const slackPage = await readSlackChannelHistory({
    botToken,
    channelId: target.channelId,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    limit: parsed.data.limit,
  });
  const slackAuthors = await readSlackWorkspaceMembersByIds({
    botToken,
    memberIds: [
      ...new Set(
        slackPage.messages.flatMap((message) =>
          message.userId ? [message.userId] : []
        )
      ),
    ],
  });
  const slackAuthorsById = new Map(
    slackAuthors.map((member) => [member.slackUserId, member])
  );
  const validated = slackChannelHistoryResponseSchema.safeParse({
    channelName: target.channelName,
    generatedAt: new Date().toISOString(),
    messages: slackPage.messages.map((message) => ({
      authorDisplayName:
        message.displayName ??
        (message.userId
          ? (slackAuthorsById.get(message.userId)?.displayName ?? null)
          : null),
      authorSlackUserId: message.userId,
      isAuthorBot: message.botId !== null,
      messageTs: message.ts,
      ...(parsed.data.includeFiles ? { files: message.files } : {}),
      text: message.text,
    })),
    nextCursor: slackPage.nextCursor,
    organizationId,
  });
  if (!validated.success) {
    throw new Error(
      `failed to build Slack channel history response: ${validated.error.message}`
    );
  }
  await writeCenterAgentAuditEntry({
    action: "read_slack_channel_history",
    authorization,
    onBehalfOfProfileId: null,
    resource: { id: target.channelId, type: "slack_channel" },
  });
  return validated.data;
}
export async function rpcCenterAgentReadSlackFile(
  env: CoreBindings,
  input: CenterAgentReadSlackFileInput
): Promise<CenterAgentReadSlackFileResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentReadSlackFileBodySchema.safeParse({
    ...("channelName" in input
      ? { channelName: input.channelName }
      : { channelId: input.channelId }),
    fileId: input.fileId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack file read payload",
      status: 400,
    });
  }
  const organizationId = authorization.activeOrganization.organizationId;
  const slackDb = getPostgresDatabase(env);
  if (!slackDb) {
    return buildSlackConnectionStateUnavailableResult(organizationId);
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId,
  });
  if (!binding) {
    return buildSlackNotConnectedResult(organizationId);
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  let channelName: string | undefined;
  let expectedChannelId: string;
  if ("channelName" in parsed.data) {
    const target = await resolveSlackChannelMessageTarget({
      botToken,
      channelName: parsed.data.channelName,
    });
    if (!target.isMember) {
      return buildSlackReadUnavailable({
        message: `OpenMeld hasn't been added to #${target.channelName} yet.`,
        nextAction: `In Slack, invite OpenMeld to #${target.channelName}, then ask me to try again.`,
        organizationId,
        reasonCode: "channel_access_required",
      });
    }
    channelName = target.channelName;
    expectedChannelId = target.channelId;
  } else {
    expectedChannelId = parsed.data.channelId;
  }
  const slackFile = await readSlackFile({
    botToken,
    expectedChannelId,
    fileId: parsed.data.fileId,
  });
  const response = {
    ...(channelName ? { channelName } : {}),
    contentBase64: encodeBytesAsBase64(slackFile.bytes),
    file: slackFile.file,
    organizationId,
  };
  const validated = centerAgentReadSlackFileResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Slack file read response: ${validated.error.message}`
    );
  }
  await writeCenterAgentAuditEntry({
    action: "read_slack_file",
    authorization,
    onBehalfOfProfileId: null,
    resource: { id: parsed.data.fileId, type: "slack_file" },
  });
  return validated.data;
}
async function readSlackWorkspaceMembersByIds(input: {
  botToken: string;
  memberIds: readonly string[];
}): Promise<SlackWorkspaceMember[]> {
  const unresolvedMemberIds = new Set(input.memberIds);
  const membersById = new Map<string, SlackWorkspaceMember>();
  let cursor: string | undefined;
  for (let page = 0; page < 100 && unresolvedMemberIds.size > 0; page += 1) {
    const workspacePage = await listSlackWorkspaceMembers({
      botToken: input.botToken,
      ...(cursor ? { cursor } : {}),
      limit: 200,
    });
    for (const member of workspacePage.members) {
      if (unresolvedMemberIds.delete(member.slackUserId)) {
        membersById.set(member.slackUserId, member);
      }
    }
    cursor = workspacePage.nextCursor ?? undefined;
    if (!cursor) {
      break;
    }
  }
  return input.memberIds.flatMap((memberId) => {
    const member = membersById.get(memberId);
    return member ? [member] : [];
  });
}
async function requireInteractiveSlackThreadPublicationProvenance(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  env: CoreBindings;
  publicationSource: Extract<
    CenterAgentPostSlackThreadMessageBody["publicationSource"],
    {
      kind: "remote_agent_execution";
    }
  >;
  representedHuman: VerifiedCenterAgentRepresentedMember;
  sourceNativeDeliveryId: string | null;
}) {
  const db = getPostgresDatabase(input.env);
  if (!(db && input.sourceNativeDeliveryId)) {
    throw createCoreRpcHttpError({
      code: "center_agent.publication_source_invalid",
      reason:
        "Slack thread publication requires a current interactive Center Agent task.",
      status: 409,
    });
  }
  const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db,
    deliveryId: input.sourceNativeDeliveryId,
  });
  const active =
    delivery?.status === "accepted" || delivery?.status === "retry_observed";
  if (
    !(
      delivery &&
      active &&
      delivery.submissionId === input.publicationSource.executionId &&
      delivery.organizationId ===
        input.authorization.activeOrganization.organizationId &&
      delivery.profileId === input.authorization.actorProfileId &&
      delivery.onBehalfOfProfileId === input.representedHuman.profileId &&
      delivery.onBehalfOfUserId === input.representedHuman.userId &&
      delivery.routineRunId === null
    )
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.publication_source_invalid",
      reason:
        "Slack thread publication requires a current interactive Center Agent task.",
      status: 409,
    });
  }
  return delivery;
}
function classifySlackWorkspaceMembers(input: {
  includeMemberUserId: boolean;
  slackIdentityLinks: readonly SlackUserIdentityLinkRecord[];
  slackMembers: readonly SlackWorkspaceMember[];
  openMeldDirectory: OrganizationDirectoryResponse;
}): SlackWorkspaceDirectoryMember[] {
  const openMeldMembersByUserId = new Map(
    input.openMeldDirectory.members.map((member) => [member.userId, member])
  );
  const openMeldMembersByEmail = new Map(
    input.openMeldDirectory.members.map((member) => [
      normalizeEmailForIdentityMatch(member.user.email),
      member,
    ])
  );
  const slackIdentityLinksByUserId = new Map(
    input.slackIdentityLinks.map((link) => [link.slackUserId, link])
  );
  return input.slackMembers.map((member) => {
    const linkedOpenMeldMember = openMeldMembersByUserId.get(
      slackIdentityLinksByUserId.get(member.slackUserId)?.openmeldUserId ?? ""
    );
    const normalizedEmail = normalizeEmailForIdentityMatch(member.email);
    const emailMatchedOpenMeldMember = normalizedEmail
      ? openMeldMembersByEmail.get(normalizedEmail)
      : undefined;
    let openMeldMembership: SlackWorkspaceMembership;
    if (linkedOpenMeldMember) {
      openMeldMembership = {
        matchedBy: "identity_link",
        memberDisplayName: linkedOpenMeldMember.user.name,
        ...(input.includeMemberUserId
          ? { memberUserId: linkedOpenMeldMember.userId }
          : {}),
        status: "member",
      };
    } else if (emailMatchedOpenMeldMember) {
      openMeldMembership = {
        matchedBy: "email",
        memberDisplayName: emailMatchedOpenMeldMember.user.name,
        ...(input.includeMemberUserId
          ? { memberUserId: emailMatchedOpenMeldMember.userId }
          : {}),
        status: "member",
      };
    } else if (normalizedEmail) {
      openMeldMembership = { status: "not_member" };
    } else {
      openMeldMembership = {
        reason: "email_unavailable",
        status: "unknown",
      };
    }
    return {
      ...member,
      openMeldMembership,
    };
  });
}
export async function rpcCenterAgentSearchSlackMessages(
  env: CoreBindings,
  input: CenterAgentSearchSlackMessagesInput
): Promise<CenterAgentSearchSlackMessagesResponse> {
  const parsed = centerAgentSearchSlackMessagesBodySchema.safeParse({
    includeBots: input.includeBots,
    query: input.query,
    searchAuthorization: input.searchAuthorization,
    speakerMember: input.speakerMember,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack message search payload",
      status: 400,
    });
  }
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.slack_search_speaker_required",
        reason:
          "Slack search requires a verified active human Organization member.",
      }
    );
  const organizationId = authorization.activeOrganization.organizationId;
  const slackDb = getPostgresDatabase(env);
  if (!slackDb) {
    return buildCenterAgentSlackSearchFailure({
      organizationId,
      reason: "Slack connection state is unavailable. Try again later.",
      status: "unavailable",
    });
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId,
  });
  if (!binding) {
    return buildCenterAgentSlackSearchFailure({
      organizationId,
      reason:
        "Connect this Organization to Slack before asking the Center Agent to search Slack messages.",
      status: "unavailable",
    });
  }
  const cryptoKey = String(env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY ?? "").trim();
  if (!cryptoKey) {
    return buildCenterAgentSlackSearchFailure({
      organizationId,
      reason: "Slack search authorization is unavailable. Try again later.",
      status: "unavailable",
    });
  }
  let decryptedAuthorization: Awaited<
    ReturnType<typeof decryptSlackSearchAuthorization>
  >;
  try {
    decryptedAuthorization = await decryptSlackSearchAuthorization({
      cryptoKey,
      encryptedAuthorization:
        parsed.data.searchAuthorization.encryptedAuthorization,
    });
  } catch (error) {
    console.warn("[core.center_agent.slack_search.authorization_invalid]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      slackTeamId: binding.slackTeamId,
    });
    return buildCenterAgentSlackSearchFailure({
      organizationId,
      reason:
        "Slack search authorization could not be verified. Ask the user to send a new Slack message and try again.",
      status: "unavailable",
    });
  }
  if (
    !slackSearchAuthorizationMatchesRequest({
      authorization: decryptedAuthorization,
      memberId: representedHuman.memberId,
      organizationId,
      slackTeamId: binding.slackTeamId,
      openMeldUserId: representedHuman.userId,
    })
  ) {
    return buildCenterAgentSlackSearchFailure({
      organizationId,
      reason:
        "This Slack search authorization does not belong to the current requester or workspace.",
      status: "forbidden",
    });
  }
  let botToken: string;
  try {
    botToken = await resolveSlackBotToken({
      cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
      db: slackDb,
      fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
      slackTeamId: binding.slackTeamId,
    });
    await writeCenterAgentAuditEntry({
      action: "search_slack_messages",
      authorization,
      onBehalfOfProfileId: representedHuman.profileId,
      resource: { id: binding.slackTeamId, type: "slack_workspace" },
      sourceNativeDeliveryId,
    });
  } catch (error) {
    console.warn("[core.center_agent.slack_search.preparation_unavailable]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      slackTeamId: binding.slackTeamId,
    });
    return buildCenterAgentSlackSearchFailure({
      organizationId,
      reason: "Slack search is unavailable right now. Try again later.",
      status: "unavailable",
    });
  }
  let search: Awaited<ReturnType<typeof searchSlackPublicMessages>>;
  try {
    search = await searchSlackPublicMessages({
      actionToken: decryptedAuthorization.actionToken,
      botToken,
      includeBots: parsed.data.includeBots ?? false,
      includeContextMessages: true,
      limit: CENTER_AGENT_SLACK_SEARCH_MESSAGES_MAX,
      query: parsed.data.query,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.warn("[core.center_agent.slack_search.provider_unavailable]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      slackTeamId: binding.slackTeamId,
    });
    return buildCenterAgentSlackSearchProviderFailure({
      error,
      organizationId,
    });
  }
  const response: CenterAgentSearchSlackMessagesResponse = {
    messages: search.messages,
    moreResultsAvailable: search.moreResultsAvailable,
    organizationId,
    status: "found",
  };
  return centerAgentSearchSlackMessagesResponseSchema.parse(response);
}
function slackSearchAuthorizationMatchesRequest(input: {
  authorization: Awaited<ReturnType<typeof decryptSlackSearchAuthorization>>;
  memberId: string;
  organizationId: string;
  slackTeamId: string;
  openMeldUserId: string;
}): boolean {
  return (
    input.authorization.organizationId === input.organizationId &&
    input.authorization.slackTeamId === input.slackTeamId &&
    input.authorization.memberId === input.memberId &&
    input.authorization.openMeldUserId === input.openMeldUserId
  );
}
function buildCenterAgentSlackSearchProviderFailure(input: {
  error: unknown;
  organizationId: string;
}): CenterAgentSearchSlackMessagesResponse {
  if (!(input.error instanceof SlackApiError)) {
    return buildCenterAgentSlackSearchFailure({
      organizationId: input.organizationId,
      reason: "Slack search is unavailable right now. Try again later.",
      status: "unavailable",
    });
  }
  if (
    input.error.errorCode === "invalid_action_token" ||
    input.error.errorCode === "token_expired"
  ) {
    return buildCenterAgentSlackSearchFailure({
      organizationId: input.organizationId,
      reason:
        "Slack search authorization expired. Ask the user to send a new Slack message and try again.",
      status: "authorization_expired",
    });
  }
  if (isSlackRateLimitError(input.error)) {
    return buildCenterAgentSlackSearchFailure({
      organizationId: input.organizationId,
      reason:
        "Slack search is temporarily rate limited. Wait before trying again.",
      ...(input.error.retryAfterSeconds === null
        ? {}
        : { retryAfterSeconds: input.error.retryAfterSeconds }),
      status: "rate_limited",
    });
  }
  if (isSlackPermissionError(input.error)) {
    return buildCenterAgentSlackSearchFailure({
      organizationId: input.organizationId,
      reason:
        "The connected Slack app does not have permission to search these messages.",
      status: "forbidden",
    });
  }
  return buildCenterAgentSlackSearchFailure({
    organizationId: input.organizationId,
    reason: "Slack search is unavailable right now. Try again later.",
    status: "unavailable",
  });
}
function isSlackPermissionError(error: SlackApiError): boolean {
  return [
    "access_denied",
    "missing_scope",
    "no_permission",
    "not_allowed_token_type",
    "team_access_not_granted",
  ].includes(error.errorCode);
}
function isSlackRateLimitError(error: SlackApiError): boolean {
  return (
    error.status === 429 ||
    error.errorCode === "rate_limited" ||
    error.errorCode === "ratelimited"
  );
}
function buildCenterAgentSlackSearchFailure(
  input: Extract<
    CenterAgentSearchSlackMessagesResponse,
    {
      status: Exclude<
        CenterAgentSearchSlackMessagesResponse["status"],
        "found"
      >;
    }
  >
): CenterAgentSearchSlackMessagesResponse {
  return centerAgentSearchSlackMessagesResponseSchema.parse(input);
}
export async function rpcCenterAgentGetOrganizationSpaceDirectory(
  env: CoreBindings,
  input: CenterAgentReadOrganizationSpaceDirectoryInput
): Promise<OrganizationSpaceDirectoryResponse> {
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  const { authorization } = prepared;
  const response = await rpcGetCurrentOrganizationSpaceDirectory(env, {
    context: authorization.context,
  });
  await writeCenterAgentAuditEntry({
    action: "read_org_space_directory",
    authorization,
    onBehalfOfProfileId: null,
    resource: {
      type: "organization",
      id: authorization.activeOrganization.organizationId,
    },
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  });
  return response;
}
export async function rpcCenterAgentListActiveSpaceWakes(
  env: CoreBindings,
  input: CenterAgentListActiveSpaceWakesInput
): Promise<AccountSpaceActiveWakeSummaryResponse> {
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  const { authorization } = prepared;
  const directory = await rpcGetCurrentOrganizationSpaceDirectory(env, {
    context: authorization.context,
  });
  const response = await buildActiveWakeSummaryForSpaceIds({
    env,
    ownerUserId: authorization.actorProfile.ownerUserId,
    spaceIds: directory.spaces.map((space) => space.spaceId),
  });
  await writeCenterAgentAuditEntry({
    action: "read_org_space_directory",
    authorization,
    onBehalfOfProfileId: null,
    resource: {
      type: "organization",
      id: authorization.activeOrganization.organizationId,
    },
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  });
  return response;
}
export async function rpcCenterAgentReadSpaceWakeProgress(
  env: CoreBindings,
  input: CenterAgentReadSpaceWakeProgressInput
): Promise<GetActiveSpaceWakeProgressResponse> {
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  const { authorization } = prepared;
  const parsed = getActiveSpaceWakeProgressInputSchema.safeParse({
    includeDeviceWait: true,
    includePageInfo: true,
    includeWakeStopEligibility: true,
    includeSourceContext: true,
    includeTiming: true,
    includeWaitReason: true,
    spaceId: input.spaceId,
    ...(input.sourceProfileId
      ? { sourceProfileId: input.sourceProfileId }
      : {}),
    ...(input.targetProfileId
      ? { targetProfileId: input.targetProfileId }
      : {}),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Center Agent Space Wake progress input is invalid.",
      status: 400,
    });
  }
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.data.spaceId,
  });
  const progressInput = {
    includeDeviceWait: true,
    includePageInfo: true,
    includeWakeStopEligibility: true,
    includeSourceContext: true,
    includeTiming: true,
    includeWaitReason: true,
    spaceId: parsed.data.spaceId,
    ...(parsed.data.sourceProfileId
      ? { sourceProfileId: parsed.data.sourceProfileId }
      : {}),
    ...(parsed.data.targetProfileId
      ? { targetProfileId: parsed.data.targetProfileId }
      : {}),
  } as const;
  const response = await rpcGetActiveSpaceWakeProgress(env, {
    ...progressInput,
    context: authorization.context,
  });
  const representedContext = prepared.representedContext;
  let represented: GetActiveSpaceWakeProgressResponse | null = null;
  if (representedContext) {
    try {
      represented = await rpcGetActiveSpaceWakeProgress(env, {
        ...progressInput,
        context: representedContext,
      });
    } catch (error) {
      // A verified requester may not have access to every Space the Center
      // Agent can read. Keep the Center Agent's authorized progress projection.
      if (readCoreRpcHttpStatus(error) !== 403) {
        throw error;
      }
    }
  }
  const representedEligibility = new Map(
    represented?.items.map((item) => [
      JSON.stringify([
        item.dispatchId,
        item.sourceSignalId,
        item.clientMessageId,
        item.targetProfileId,
      ]),
      item.wakeStopEligibility,
    ]) ?? []
  );
  const viewerResponse = {
    ...response,
    items: response.items.map((item) => ({
      ...item,
      wakeStopEligibility:
        item.wakeStopEligibility ??
        representedEligibility.get(
          JSON.stringify([
            item.dispatchId,
            item.sourceSignalId,
            item.clientMessageId,
            item.targetProfileId,
          ])
        ) ??
        null,
    })),
  };
  await writeCenterAgentAuditEntry({
    action: "read_space_context",
    authorization,
    onBehalfOfProfileId: null,
    resource: { type: "space", id: parsed.data.spaceId },
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
  });
  return viewerResponse;
}
export async function rpcCenterAgentStopSpaceWake(
  env: CoreBindings,
  input: CenterAgentStopSpaceWakeInput
): Promise<PostSpaceWakeStopResponse> {
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  await requireCenterAgentSpaceInActiveOrganization({
    authorization: prepared.authorization,
    env,
    spaceId: input.spaceId,
  });
  // Space alone decides whether this is the Center Agent's own DM request.
  // A pre-send fence is only valid in its still-unconverted two-Agent DM.
  // Other requests retain the separately verified Human authority below.
  let representedBody = input.body;
  if (
    input.body.target.by !== "client_message" ||
    !input.body.target.clientMessageId.startsWith("ca-wake:")
  ) {
    try {
      return await rpcPostSpaceWakeStop(env, {
        body: input.body,
        context: prepared.authorization.context,
        spaceId: input.spaceId,
      });
    } catch (error) {
      if (
        readCoreRpcHttpStatus(error) !== 403 ||
        !prepared.representedContext
      ) {
        throw error;
      }
      if (input.body.target.by === "client_message") {
        // Changing the caller must never turn an unknown UUID into a different
        // author's pre-send fence. Delegate only an existing exact source.
        const lookup = await rpcGetSpaceDispatchLookup(env, {
          clientMessageId: input.body.target.clientMessageId,
          targetProfileId: input.body.target.targetProfileId,
          context: prepared.representedContext,
          spaceId: input.spaceId,
        });
        const sourceSignalId = lookup.matches.find(
          (match) => match.targetProfileId === input.body.target.targetProfileId
        )?.sourceSignalId;
        if (!sourceSignalId) {
          throw error;
        }
        representedBody = {
          ...input.body,
          target: {
            by: "source_signal",
            sourceSignalId,
            targetProfileId: input.body.target.targetProfileId,
          },
        };
      }
    }
  }
  if (!prepared.representedContext) {
    throw createCoreRpcHttpError({
      code: "center_agent.wake_stop_requester_required",
      reason:
        "You can't stop this Wake from this request. Ask its requester or the target Agent's owner to stop it in OpenMeld Web.",
      status: 403,
    });
  }
  return await rpcPostSpaceWakeStop(env, {
    body: representedBody,
    context: prepared.representedContext,
    spaceId: input.spaceId,
  });
}

export async function rpcCenterAgentSpaceInputQueue(
  env: CoreBindings,
  input: CenterAgentSpaceInputQueueInput
): Promise<SpaceInputQueueResponse> {
  // Resolve the verified originating member on EVERY invocation. The Agent's
  // Organization role or owner account is never substituted for this member.
  const prepared = await prepareCenterAgentOrganizationMemberRead(env, input);
  await requireCenterAgentSpaceInActiveOrganization({
    authorization: prepared.authorization,
    env,
    spaceId: input.spaceId,
  });
  if (!(prepared.representedContext && prepared.sourceNativeDeliveryId)) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "center_agent.input_requester_required",
      reason: "Queued messages require a verified current requester.",
    });
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: requireCenterAgentDb(env),
    submissionId:
      requireRpcContext(input.context).agentControllerConversationId ?? "",
  });
  const sender = delivery?.executionRecoverySubmitRequest?.turnEnvelope.sender;
  if (
    sender?.kind !== "member" ||
    !sender.verified ||
    sender.profileId !==
      prepared.representedContext.actorContext.openMeldProfileId ||
    sender.ownerUserId !== prepared.representedContext.actorContext.ownerUserId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "center_agent.input_requester_required",
      reason: "Queued messages require a verified interactive requester.",
    });
  }
  await writeCenterAgentAuditEntry({
    action: "manage_space_input_queue",
    authorization: prepared.authorization,
    onBehalfOfProfileId:
      prepared.representedContext.actorContext.openMeldProfileId,
    sourceNativeDeliveryId: prepared.sourceNativeDeliveryId,
    sourceSpaceId: input.spaceId,
    resource: {
      type: "space_input_queue",
      id: `${input.spaceId}:${input.mutation?.action ?? "read"}:${input.mutation && "inputId" in input.mutation ? input.mutation.inputId : ""}`,
    },
  });
  // Space applies its ordinary writable membership and original-message-author
  // checks. This identity resolution is not a Stop or Organization-wide grant.
  return rpcSpaceInputQueue(env, {
    spaceId: input.spaceId,
    mutation: input.mutation,
    context: prepared.representedContext,
  });
}

async function prepareCenterAgentOrganizationMemberRead(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    speakerMember?: CenterAgentToolSpeaker;
  }
): Promise<{
  authorization: CurrentDesignatedCenterAgentAuthorization;
  representedContext: OpenMeldRequestContext | null;
  sourceNativeDeliveryId: string | null;
}> {
  const context = requireRpcContext(input.context);
  if (input.speakerMember !== undefined) {
    const speakerMember = centerAgentToolSpeakerSchema.safeParse(
      input.speakerMember
    );
    if (!speakerMember.success) {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        reason: speakerMember.error.message,
        status: 400,
      });
    }
    const prepared = await prepareCenterAgentOrganizationMemberRequest(
      env,
      context,
      speakerMember.data
    );
    return {
      authorization: prepared.authorization,
      representedContext:
        prepared.member.sourceNativeDeliveryId &&
        prepared.member.userId &&
        prepared.member.profileId
          ? {
              activeOrganizationId:
                prepared.authorization.activeOrganization.organizationId,
              actorContext: {
                callerPrincipalId: prepared.member.userId,
                ownerUserId: prepared.member.userId,
                openMeldProfileId: prepared.member.profileId,
                profileKind: "human",
                profileName: prepared.member.displayName,
                requestId:
                  prepared.authorization.context.actorContext.requestId,
              },
            }
          : null,
      sourceNativeDeliveryId: prepared.member.sourceNativeDeliveryId,
    };
  }
  return {
    authorization: await requireCurrentDesignatedCenterAgentCaller({
      context,
      env,
    }),
    representedContext: null,
    sourceNativeDeliveryId: null,
  };
}
function normalizeEmailForIdentityMatch(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
function normalizeSlackAccountEmail(value: unknown): string | null {
  const normalized = normalizeEmailForIdentityMatch(value);
  if (!normalized) {
    return null;
  }
  const parsed =
    slackOAuthIdentityLinkInputSchema.shape.slackAccountEmail.safeParse(
      normalized
    );
  return parsed.success ? parsed.data : null;
}
export async function rpcCenterAgentReadSpaceContext(
  env: CoreBindings,
  input: CenterAgentReadSpaceContextInput
): Promise<CenterAgentReadSpaceContextResponse> {
  const authorization = await requireRemoteAgentToolCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentReadSpaceContextBodySchema.safeParse({
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
    ...(input.afterSignalId === undefined
      ? {}
      : { afterSignalId: input.afterSignalId }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.requestedAddressingModel === undefined
      ? {}
      : { requestedAddressingModel: input.requestedAddressingModel }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.sourceSignalId === undefined
      ? {}
      : { sourceSignalId: input.sourceSignalId }),
    spaceId: input.spaceId,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Space context payload",
      code: "invalid_payload",
    });
  }
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.data.spaceId,
  });
  let response: CenterAgentReadSpaceContextResponse;
  if (parsed.data.scope) {
    const context = await readCenterAgentProgressiveSpaceContext({
      context: authorization.context,
      env,
      input: {
        ...parsed.data,
        scope: parsed.data.scope,
      },
    });
    response = {
      context,
      organizationId: authorization.activeOrganization.organizationId,
      spaceId: parsed.data.spaceId,
    };
  } else {
    const bootstrap = await rpcGetSpaceBootstrap(env, {
      context: authorization.context,
      limit: parsed.data.limit ?? 50,
      recent: true,
      spaceId: parsed.data.spaceId,
    });
    response = {
      bootstrap,
      organizationId: authorization.activeOrganization.organizationId,
      spaceId: parsed.data.spaceId,
    };
  }
  if (!("personalExecution" in authorization)) {
    await writeCenterAgentAuditEntry({
      action: "read_space_context",
      authorization,
      onBehalfOfProfileId: null,
      resource: { type: "space", id: parsed.data.spaceId },
    });
  }
  const validated =
    centerAgentReadSpaceContextResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space context response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentListSpaceFiles(
  env: CoreBindings,
  input: CenterAgentListSpaceFilesRpcInput
): Promise<CenterAgentListSpaceFilesResponse> {
  const parsed = centerAgentListSpaceFilesRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throwInvalidCenterAgentSpaceFilePayload(parsed.error.issues[0]?.message);
  }
  const request = parsed.data;
  const authorization = await requireRemoteAgentToolCaller({
    context: request.context,
    env,
  });
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: request.spaceId,
  });
  return centerAgentListSpaceFilesResponseSchema.parse(
    await rpcListSpaceFiles(env, {
      context: authorization.context,
      query: {
        parentId: request.parentId ?? null,
        view: request.view ?? "active",
        origin: request.origin ?? "artifact",
      },
      spaceId: request.spaceId,
    })
  );
}
export async function rpcCenterAgentReadSpaceFile(
  env: CoreBindings,
  input: CenterAgentReadSpaceFileRpcInput
): Promise<CenterAgentReadSpaceFileResponse> {
  const parsed = centerAgentReadSpaceFileRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throwInvalidCenterAgentSpaceFilePayload(parsed.error.issues[0]?.message);
  }
  const request = parsed.data;
  const authorization = await requireRemoteAgentToolCaller({
    context: request.context,
    env,
  });
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: request.spaceId,
  });
  const resolved = await rpcStreamSpaceFileContent(env, {
    context: authorization.context,
    content: {
      fileId: request.fileId,
      ...(request.revision === undefined ? {} : { revision: request.revision }),
      spaceId: request.spaceId,
    },
    spaceId: request.spaceId,
  });
  if (
    !isSpaceFileTextReadable({
      fileName: resolved.file.name,
      mimeType: resolved.revision.mimeType,
      sizeBytes: resolved.revision.sizeBytes,
    })
  ) {
    await resolved.bytes.cancel();
    throw createCoreRpcHttpError({
      code: "space_file.type_unsupported",
      reason:
        "The Center Agent can read text Space files up to 1 MiB. Download this file from the Space Files view instead.",
      status: 415,
    });
  }
  let content: string;
  const bytes = await new Response(resolved.bytes).arrayBuffer();
  try {
    content = decodeSpaceFileText(bytes);
  } catch {
    throw createCoreRpcHttpError({
      code: "space_file.type_unsupported",
      reason: "This Space file is not valid UTF-8 text.",
      status: 415,
    });
  }
  const history = request.includeHistory
    ? await rpcListSpaceFileRevisions(env, {
        context: authorization.context,
        fileId: request.fileId,
        spaceId: request.spaceId,
      })
    : null;
  return centerAgentReadSpaceFileResponseSchema.parse({
    content,
    file: resolved.file,
    revision: resolved.revision,
    ...(history ? { revisions: history.revisions } : {}),
  });
}
export async function rpcCenterAgentSaveSpaceFile(
  env: CoreBindings,
  input: CenterAgentSaveSpaceFileRpcInput
): Promise<CenterAgentSaveSpaceFileResponse> {
  const parsed = centerAgentSaveSpaceFileRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throwInvalidCenterAgentSpaceFilePayload(parsed.error.issues[0]?.message);
  }
  const request = parsed.data;
  const authorization = await requireRemoteAgentToolCaller({
    context: request.context,
    env,
  });
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: request.spaceId,
  });
  const encoded = new TextEncoder().encode(request.content);
  if (
    !isSpaceFileTextEditable({
      mimeType: request.mimeType,
      sizeBytes: encoded.byteLength,
    })
  ) {
    throw createCoreRpcHttpError({
      code: "space_file.type_unsupported",
      reason: "The Center Agent can save text Space files up to 1 MiB.",
      status: 415,
    });
  }
  const bytes = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(bytes).set(encoded);
  const fileId =
    request.action === "create"
      ? await buildSpaceFileEntryIdForMutation(request.clientMutationId)
      : request.fileId;
  const revisionId = await buildSpaceFileRevisionIdForMutation({
    baseRevision: request.action === "create" ? null : request.baseRevision,
    bytes,
    clientMutationId: request.clientMutationId,
    mimeType: request.mimeType,
    ...(request.action === "create"
      ? { name: request.name, parentId: request.parentId ?? null }
      : {}),
  });
  const write: CommitSpaceFileWriteInput = {
    baseRevision: request.action === "create" ? null : request.baseRevision,
    clientMutationId: request.clientMutationId,
    fileId,
    mimeType: request.mimeType,
    ...(request.action === "create"
      ? {
          name: request.name,
          parentId: request.parentId ?? null,
          origin: "artifact",
        }
      : {}),
    revisionId,
    sizeBytes: encoded.byteLength,
    spaceId: request.spaceId,
  };
  const file = await rpcWriteSpaceFileContent(env, {
    bytes,
    context: authorization.context,
    spaceId: request.spaceId,
    write,
  });
  return centerAgentSaveSpaceFileResponseSchema.parse({ file });
}
export async function rpcCenterAgentManageSpaceFiles(
  env: CoreBindings,
  input: CenterAgentManageSpaceFilesRpcInput
): Promise<CenterAgentManageSpaceFilesResponse> {
  const parsed = centerAgentManageSpaceFilesRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throwInvalidCenterAgentSpaceFilePayload(parsed.error.issues[0]?.message);
  }
  const request = parsed.data;
  const authorization = await requireRemoteAgentToolCaller({
    context: request.context,
    env,
  });
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: request.spaceId,
  });
  if (request.action === "create_folder") {
    const created = await rpcCreateSpaceFolder(env, {
      body: {
        clientMutationId: request.clientMutationId,
        name: request.name,
        parentId: request.parentId ?? null,
      },
      context: authorization.context,
      spaceId: request.spaceId,
    });
    return centerAgentManageSpaceFilesResponseSchema.parse({
      action: request.action,
      folder: created.folder,
    });
  }
  if (request.action === "update_entry") {
    const updated = await rpcUpdateSpaceFileEntry(env, {
      body: {
        clientMutationId: request.clientMutationId,
        ...(request.name === undefined ? {} : { name: request.name }),
        ...(request.parentId === undefined
          ? {}
          : { parentId: request.parentId }),
      },
      context: authorization.context,
      entryId: request.entryId,
      spaceId: request.spaceId,
    });
    return centerAgentManageSpaceFilesResponseSchema.parse({
      action: request.action,
      entry: updated.entry,
    });
  }
  if (request.action === "restore") {
    const restored = await rpcRestoreSpaceFileEntry(env, {
      body: { clientMutationId: request.clientMutationId },
      context: authorization.context,
      entryId: request.entryId,
      spaceId: request.spaceId,
    });
    return centerAgentManageSpaceFilesResponseSchema.parse({
      action: request.action,
      entry: restored.entry,
    });
  }
  if (request.action === "restore_version") {
    const file = await rpcRestoreSpaceFileRevision(env, {
      body: {
        baseRevision: request.baseRevision,
        clientMutationId: request.clientMutationId,
      },
      context: authorization.context,
      fileId: request.fileId,
      revision: request.revision,
      spaceId: request.spaceId,
    });
    return centerAgentManageSpaceFilesResponseSchema.parse({
      action: request.action,
      file,
    });
  }
  const trashed = await rpcTrashSpaceFileEntry(env, {
    clientMutationId: request.clientMutationId,
    context: authorization.context,
    entryId: request.entryId,
    spaceId: request.spaceId,
  });
  return centerAgentManageSpaceFilesResponseSchema.parse({
    action: request.action,
    ...trashed,
  });
}
function throwInvalidCenterAgentSpaceFilePayload(message?: string): never {
  throw createCoreRpcHttpError({
    code: "invalid_payload",
    reason: message ?? "Invalid Center Agent Space Files request.",
    status: 400,
  });
}
type ProgressiveSpaceContext = Extract<
  CenterAgentReadSpaceContextResponse,
  {
    context: unknown;
  }
>["context"];
async function readCenterAgentProgressiveSpaceContext(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
  input: CenterAgentReadSpaceContextBody & {
    scope: NonNullable<CenterAgentReadSpaceContextBody["scope"]>;
  };
}): Promise<ProgressiveSpaceContext> {
  const limit = input.input.limit ?? 20;

  if (input.input.scope === "source_evidence") {
    const sourceSignalId = requireCenterAgentContextAnchor(
      input.input.sourceSignalId,
      "sourceSignalId"
    );
    const page = await rpcListSignals(input.env, {
      context: input.context,
      spaceId: input.input.spaceId,
      aroundSignalId: sourceSignalId,
      beforeCount: 0,
      afterCount: 0,
      signalTypes: ["signal.text", "signal.system_notice"],
    });
    const signal = page.signals.find((entry) => entry.id === sourceSignalId);
    if (
      !signal ||
      (signal.type !== "signal.text" && signal.type !== "signal.system_notice")
    ) {
      throw new Error(
        "space.evidence_unavailable: The requested message is unavailable."
      );
    }
    return {
      scope: "source_evidence",
      ...(await buildSpaceMessageEvidence({ ...input.input, signal })),
    };
  }

  if (input.input.scope === "thread_evidence") {
    const selection = {
      context: input.context,
      spaceId: input.input.spaceId,
      threadId: requireCenterAgentContextAnchor(
        input.input.threadId,
        "threadId"
      ),
    };
    const thread = await rpcGetSpaceThread(input.env, selection);
    const page = await rpcListSpaceThreadSignals(input.env, selection);
    return {
      scope: "thread_evidence",
      ...(await buildSpaceThreadEvidence({
        ...input.input,
        thread: thread.thread,
        signals: page.signals,
      })),
    };
  }

  if (input.input.scope === "source") {
    const sourceSignalId = requireCenterAgentContextAnchor(
      input.input.sourceSignalId,
      "sourceSignalId"
    );
    const [page, threadDirectory] = await Promise.all([
      rpcListSignals(input.env, {
        aroundSignalId: sourceSignalId,
        afterCount: 1,
        beforeCount: 0,
        context: input.context,
        signalTypes: ["signal.text", "signal.status", "signal.system_notice"],
        spaceId: input.input.spaceId,
      }),
      rpcListSpaceThreads(input.env, {
        context: input.context,
        spaceId: input.input.spaceId,
      }),
    ]);
    const sourceSignal = page.signals.find(
      (signal) => signal.id === sourceSignalId
    );
    const containingThread = threadDirectory.threads.find(
      (thread) =>
        thread.rootSignalId === sourceSignalId ||
        threadDirectory.previews.some(
          (preview) =>
            preview.threadId === thread.threadId &&
            preview.placements.some(
              (placement) => placement.signalId === sourceSignalId
            )
        )
    );
    return {
      scope: "source",
      signals: sourceSignal ? [sourceSignal] : [],
      sourceSignalId,
      threadContext: containingThread
        ? {
            rootSignalId: containingThread.rootSignalId,
            threadId: containingThread.threadId,
          }
        : null,
      truncated: false,
    };
  }
  if (input.input.scope === "thread") {
    const threadId = requireCenterAgentContextAnchor(
      input.input.threadId,
      "threadId"
    );
    const [thread, replies] = await Promise.all([
      rpcGetSpaceThread(input.env, {
        context: input.context,
        spaceId: input.input.spaceId,
        threadId,
      }),
      rpcListSpaceThreadSignals(input.env, {
        context: input.context,
        spaceId: input.input.spaceId,
        threadId,
      }),
    ]);
    const rootSignal =
      thread.rootSignal ??
      replies.signals.find(
        (signal) => signal.id === thread.thread.rootSignalId
      ) ??
      null;
    const replySignalIds = new Set(
      replies.placements
        .filter((placement) => placement.placement === "thread")
        .map((placement) => placement.signalId)
    );
    const uniqueReplySignals = Array.from(
      new Map(
        replies.signals
          .filter(
            (signal) =>
              signal.id !== rootSignal?.id && replySignalIds.has(signal.id)
          )
          .map((signal) => [signal.id, signal] as const)
      ).values()
    );
    const rootSignals = rootSignal ? [rootSignal] : [];
    const replyLimit = Math.max(0, limit - rootSignals.length);
    const signals = [
      ...rootSignals,
      ...(replyLimit > 0 ? uniqueReplySignals.slice(-replyLimit) : []),
    ];
    return {
      scope: "thread",
      signals,
      threadId,
      truncated:
        rootSignals.length + uniqueReplySignals.length > signals.length,
    };
  }
  if (input.input.scope === "delta") {
    const afterSignalId = requireCenterAgentContextAnchor(
      input.input.afterSignalId,
      "afterSignalId"
    );
    const page = await rpcListSignals(input.env, {
      afterSignalId,
      context: input.context,
      limit: limit + 1,
      signalTypes: ["signal.text", "signal.status", "signal.system_notice"],
      spaceId: input.input.spaceId,
    });
    return {
      afterSignalId,
      scope: "delta",
      signals: page.signals.slice(0, limit),
      truncated: page.signals.length > limit,
    };
  }
  const page = await rpcListSignals(input.env, {
    context: input.context,
    limit: limit + 1,
    recent: true,
    signalTypes: ["signal.text", "signal.status", "signal.system_notice"],
    spaceId: input.input.spaceId,
  });
  return {
    scope: "history",
    signals: page.signals.slice(-limit),
    truncated: page.signals.length > limit,
  };
}
function requireCenterAgentContextAnchor(
  value: string | undefined,
  name: string
): string {
  if (!value) {
    throw new Error(`missing validated Center Agent context ${name}`);
  }
  return value;
}
export async function rpcCenterAgentReadDispatchHistory(
  env: CoreBindings,
  input: CenterAgentReadDispatchHistoryInput
): Promise<CenterAgentReadDispatchHistoryResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentReadDispatchHistoryBodySchema.safeParse({
    ...(input.dispatchId === undefined ? {} : { dispatchId: input.dispatchId }),
    limit: input.limit,
    spaceId: input.spaceId,
    ...(input.targetProfileId === undefined
      ? {}
      : { targetProfileId: input.targetProfileId }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent dispatch history payload",
      code: "invalid_payload",
    });
  }
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.data.spaceId,
  });
  const dispatchHistoryDb = getPostgresDatabase(env);
  if (!dispatchHistoryDb) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Dispatch history store is unavailable.",
      code: "center_agent.dispatch_history_store_unavailable",
    });
  }
  const entries = await listRecentDispatchLedgerEntriesForSpace({
    db: dispatchHistoryDb,
    dispatchId: parsed.data.dispatchId ?? null,
    limit: parsed.data.limit ?? CENTER_AGENT_DISPATCH_HISTORY_DEFAULT_LIMIT,
    spaceId: parsed.data.spaceId,
    targetProfileId: parsed.data.targetProfileId ?? null,
  });
  await writeCenterAgentAuditEntry({
    action: "read_dispatch_history",
    authorization,
    onBehalfOfProfileId: null,
    resource: { type: "space", id: parsed.data.spaceId },
  });
  const response: CenterAgentReadDispatchHistoryResponse = {
    entries: entries.map(toCenterAgentDispatchHistoryEntryDto),
    organizationId: authorization.activeOrganization.organizationId,
    spaceId: parsed.data.spaceId,
  };
  const validated =
    centerAgentReadDispatchHistoryResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent dispatch history response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentPostSpaceMessage(
  env: CoreBindings,
  input: CenterAgentPostSpaceMessageInput
): Promise<CenterAgentPostSpaceMessageResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentPostSpaceMessageBodySchema.safeParse({
    ...(input.files === undefined ? {} : { files: input.files }),
    ...(input.mentionProfileIds === undefined
      ? {}
      : { mentionProfileIds: input.mentionProfileIds }),
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
    ...(input.referenceProfileIds === undefined
      ? {}
      : { referenceProfileIds: input.referenceProfileIds }),
    spaceId: input.spaceId,
    text: input.text,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Space message payload",
      code: "invalid_payload",
    });
  }
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.data.spaceId,
  });
  const centerAgentMember = await readResolvedOrganizationSpaceMember({
    db: requireCenterAgentDb(env),
    organizationId: authorization.activeOrganization.organizationId,
    profileId: authorization.actorProfileId,
  });
  if (!(centerAgentMember && centerAgentMember.profileKind === "agent")) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Center Agent profile is not available in this Organization.",
      code: "center_agent.profile_not_found",
    });
  }
  const signal = await rpcPostSignal(env, {
    authoringPolicy: "user_authored",
    context: authorization.context,
    messageEnvelope: {
      activationTargets: [],
      ...(parsed.data.mentionProfileIds === undefined
        ? {}
        : {
            mentionTargets: [...new Set(parsed.data.mentionProfileIds)].sort(),
          }),
      referenceTargets: [
        ...new Set(parsed.data.referenceProfileIds ?? []),
      ].sort(),
      text: parsed.data.text,
    },
    profile: buildProfileDisplay({
      agentControllerRef: centerAgentMember.agentControllerRef,
      ownerName: centerAgentMember.ownerName,
      ownerUserId: centerAgentMember.ownerUserId,
      profileId: centerAgentMember.profileId,
      profileKind: "agent",
      profileName: centerAgentMember.profileName,
    }),
    spaceAddressingVersion: resolveCenterAgentSpaceAddressingVersion(input),
    spaceId: parsed.data.spaceId,
    text: parsed.data.text,
    ...(parsed.data.files ? { files: parsed.data.files } : {}),
  });
  if (signal.type !== "signal.text") {
    throw new Error(
      `Center Agent Space message expected signal.text but received ${signal.type}`
    );
  }
  const responseSignal =
    input.mentionProfileIds === undefined
      ? projectLegacyCenterAgentSpaceAddressingSignal({
          referenceProfileIds: parsed.data.referenceProfileIds ?? [],
          signal,
        })
      : signal;
  const attribution = await writeCenterAgentAuditEntry({
    action: "post_space_message",
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    resource: { type: "space", id: parsed.data.spaceId },
  });
  const response: CenterAgentPostSpaceMessageResponse = {
    attribution,
    organizationId: authorization.activeOrganization.organizationId,
    resource: { type: "space", id: parsed.data.spaceId },
    signal: responseSignal,
    spaceId: parsed.data.spaceId,
  };
  const validated =
    centerAgentPostSpaceMessageResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space message response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentReadSpaceAuthoringContract(
  env: CoreBindings,
  input: CenterAgentReadSpaceAuthoringContractInput
): Promise<CenterAgentSpaceAuthoringContractResponse> {
  await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  if (input.requestedAddressingModel === "wake_reference_mention") {
    return centerAgentSpaceAuthoringContractResponseSchema.parse({
      addressingModel: "wake_reference_mention",
      structuredMentionTargets: true,
      structuredReferenceTargets: true,
    });
  }
  return centerAgentSpaceAuthoringContractResponseSchema.parse({
    addressingModel: "wake_reference",
    structuredReferenceTargets: true,
  });
}
function projectLegacyCenterAgentSpaceAddressingSignal(input: {
  referenceProfileIds: readonly string[];
  signal: Extract<
    SignalEnvelope,
    {
      type: "signal.text";
    }
  >;
}): Extract<
  SignalEnvelope,
  {
    type: "signal.text";
  }
> {
  const messageEnvelope = input.signal.data.messageEnvelope;
  if (!messageEnvelope) {
    return input.signal;
  }
  const { mentionTargets: _mentionTargets, ...legacyMessageEnvelope } =
    messageEnvelope;
  return {
    ...input.signal,
    data: {
      ...input.signal.data,
      messageEnvelope: {
        ...legacyMessageEnvelope,
        referenceTargets: [...new Set(input.referenceProfileIds)].sort(),
      },
    },
  };
}
export async function rpcCenterAgentPostSlackChannelMessage(
  env: CoreBindings,
  input: CenterAgentPostSlackChannelMessageInput
): Promise<CenterAgentPostSlackChannelMessageResponse> {
  const channelName = normalizeSlackChannelNameForRpc(input.channelName);
  const parsed = centerAgentPostSlackChannelMessageBodySchema.safeParse({
    channelName,
    publicationSource: input.publicationSource,
    speakerMember: input.speakerMember,
    text: input.text,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack channel message payload",
      code: "invalid_payload",
    });
  }
  return await executeRpcCenterAgentSlackPublication({
    env,
    input: parsed.data,
    context: requireRpcContext(input.context),
  });
}
export async function rpcCenterAgentPostSlackThreadMessage(
  env: CoreBindings,
  input: CenterAgentPostSlackThreadMessageInput
): Promise<CenterAgentPostSlackChannelMessageResponse> {
  const parsed = centerAgentPostSlackThreadMessageBodySchema.safeParse({
    publicationSource: input.publicationSource,
    speakerMember: input.speakerMember,
    text: input.text,
    ...(input && "threadPermalink" in input
      ? { threadPermalink: input.threadPermalink }
      : {
          channelName: normalizeSlackChannelNameForRpc(input.channelName),
          threadTs: input.threadTs,
        }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack thread message payload",
      code: "invalid_payload",
    });
  }
  return await executeRpcCenterAgentSlackPublication({
    env,
    input: parsed.data,
    context: requireRpcContext(input.context),
  });
}
async function executeRpcCenterAgentSlackPublication(input: {
  context: OpenMeldRequestContext;
  env: CoreBindings;
  input:
    | CenterAgentPostSlackChannelMessageBody
    | CenterAgentPostSlackThreadMessageBody;
}): Promise<CenterAgentPostSlackChannelMessageResponse> {
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      input.env,
      input.context,
      input.input.speakerMember,
      {
        code: "center_agent.slack_channel_speaker_required",
        reason:
          "Slack channel publication requires a verified active human Organization member.",
      }
    );
  if ("threadTs" in input.input || "threadPermalink" in input.input) {
    await requireInteractiveSlackThreadPublicationProvenance({
      authorization,
      env: input.env,
      publicationSource: input.input.publicationSource,
      representedHuman,
      sourceNativeDeliveryId,
    });
  }
  const slackDb = getPostgresDatabase(input.env);
  if (!slackDb) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Slack connection state is unavailable.",
      code: "center_agent.slack_connection_state_unavailable",
    });
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId: authorization.activeOrganization.organizationId,
  });
  if (!binding) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Connect this Organization to Slack before asking the Center Agent to post in a channel.",
      code: "center_agent.slack_workspace_not_connected",
    });
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  let trustedThreadTarget =
    "threadPermalink" in input.input
      ? parseSlackThreadPublicationPermalink(input.input.threadPermalink)
      : null;
  if ("threadPermalink" in input.input && !trustedThreadTarget) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Slack thread publication requires an exact message permalink.",
      code: "invalid_payload",
    });
  }
  if (trustedThreadTarget) {
    // Slack itself confirms that the permalink resolves to a real root message
    // in the Organization's connected workspace before Core freezes the write.
    const canonicalPermalink = await getSlackMessagePermalink({
      botToken,
      channelId: trustedThreadTarget.channelId,
      messageTs: trustedThreadTarget.threadTs,
    });
    const canonicalTarget =
      parseSlackThreadPublicationPermalink(canonicalPermalink);
    if (
      !canonicalTarget ||
      canonicalTarget.channelId !== trustedThreadTarget.channelId
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        reason:
          "Slack could not verify the exact thread in the connected workspace.",
        code: "center_agent.slack_thread_target_invalid",
      });
    }
    trustedThreadTarget = canonicalTarget;
  }
  const target = trustedThreadTarget
    ? await resolveSlackConversationMessageTargetById({
        botToken,
        conversationId: trustedThreadTarget.channelId,
      })
    : await resolveSlackChannelMessageTarget({
        botToken,
        channelName:
          "channelName" in input.input ? input.input.channelName : "",
      });
  const threadTs =
    trustedThreadTarget?.threadTs ??
    ("threadTs" in input.input ? input.input.threadTs : undefined);
  return await executeCenterAgentSlackPublication({
    authorization,
    botToken,
    publicationSource: input.input.publicationSource,
    representedHuman,
    sourceNativeDeliveryId,
    target,
    text: input.input.text,
    ...(threadTs ? { threadTs } : {}),
  });
}
async function resolveCenterAgentSlackFilePublicationTarget(input: {
  botToken: string;
  request: CenterAgentPostSlackFileBody;
  slackTeamId: string;
  sourceDelivery: {
    slackChannelId: string | null;
    slackTeamId: string | null;
    slackThreadTs: string | null;
  };
}): Promise<{
  target: SlackChannelMessageTarget;
  threadTs?: string;
}> {
  let channelName: string | null = null;
  let trustedConversationId: string | null = null;
  let threadTs: string | undefined;
  if ("currentThread" in input.request) {
    if (
      input.sourceDelivery.slackTeamId !== input.slackTeamId ||
      !input.sourceDelivery.slackChannelId ||
      !input.sourceDelivery.slackThreadTs
    ) {
      throw createCoreRpcHttpError({
        code: "center_agent.slack_thread_target_invalid",
        reason:
          "The current Center Agent task did not originate from a writable Slack thread.",
        status: 409,
      });
    }
    trustedConversationId = input.sourceDelivery.slackChannelId;
    threadTs = input.sourceDelivery.slackThreadTs;
  } else if ("threadPermalink" in input.request) {
    const requestedTarget = parseSlackThreadPublicationPermalink(
      input.request.threadPermalink
    );
    if (!requestedTarget) {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        reason: "Slack file publication requires an exact message permalink.",
        status: 400,
      });
    }
    const canonicalPermalink = await getSlackMessagePermalink({
      botToken: input.botToken,
      channelId: requestedTarget.channelId,
      messageTs: requestedTarget.threadTs,
    });
    const canonicalTarget =
      parseSlackThreadPublicationPermalink(canonicalPermalink);
    if (
      !canonicalTarget ||
      canonicalTarget.channelId !== requestedTarget.channelId
    ) {
      throw createCoreRpcHttpError({
        code: "center_agent.slack_thread_target_invalid",
        reason:
          "Slack could not verify the exact thread in the connected workspace.",
        status: 409,
      });
    }
    trustedConversationId = canonicalTarget.channelId;
    threadTs = canonicalTarget.threadTs;
  } else {
    channelName = input.request.channelName;
  }
  const target = trustedConversationId
    ? await resolveSlackConversationMessageTargetById({
        botToken: input.botToken,
        conversationId: trustedConversationId,
      })
    : await resolveSlackChannelMessageTarget({
        botToken: input.botToken,
        channelName: channelName ?? "",
      });
  return { target, ...(threadTs ? { threadTs } : {}) };
}
export async function rpcCenterAgentPostSlackFile(
  env: CoreBindings,
  input: CenterAgentPostSlackFileInput
): Promise<CenterAgentPostSlackFileResponse> {
  const { context: _context, ...requestBody } = input;
  const parsed = centerAgentPostSlackFileBodySchema.safeParse(requestBody);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Slack file publication payload",
      status: 400,
    });
  }
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.slack_file_speaker_required",
        reason:
          "Slack file publication requires a verified active human Organization member.",
      }
    );
  const sourceDelivery =
    await requireInteractiveSlackThreadPublicationProvenance({
      authorization,
      env,
      publicationSource: parsed.data.publicationSource,
      representedHuman,
      sourceNativeDeliveryId,
    });
  if (!sourceNativeDeliveryId) {
    throw new Error("Verified Slack file publication has no source delivery.");
  }
  const bytes = decodeBase64Bytes(parsed.data.contentBase64);
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES
  ) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: `Slack files must be between 1 and ${CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES} bytes.`,
      status: 400,
    });
  }
  const contentSha256 = await sha256Hex(bytes);
  if (contentSha256 !== parsed.data.contentSha256) {
    throw createCoreRpcHttpError({
      code: "center_agent.slack_file_content_mismatch",
      reason: "The Slack file bytes did not match the selected Computer file.",
      status: 409,
    });
  }
  const slackDb = getPostgresDatabase(env);
  if (!slackDb) {
    throw createCoreRpcHttpError({
      code: "center_agent.slack_connection_state_unavailable",
      reason: "Slack connection state is unavailable.",
      status: 503,
    });
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId: authorization.activeOrganization.organizationId,
  });
  if (!binding) {
    throw createCoreRpcHttpError({
      code: "center_agent.slack_workspace_not_connected",
      reason:
        "Connect this Organization to Slack before asking the Center Agent to send a file.",
      status: 409,
    });
  }
  const botToken = await resolveSlackBotToken({
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  const publicationTarget = await resolveCenterAgentSlackFilePublicationTarget({
    botToken,
    request: parsed.data,
    slackTeamId: binding.slackTeamId,
    sourceDelivery,
  });
  return await executeCenterAgentSlackFilePublication({
    authorization,
    botToken,
    bytes,
    contentSha256,
    fileName: parsed.data.fileName,
    publicationSource: parsed.data.publicationSource,
    representedHuman,
    sourceNativeDeliveryId,
    target: publicationTarget.target,
    ...(parsed.data.initialComment
      ? { initialComment: parsed.data.initialComment }
      : {}),
    ...(publicationTarget.threadTs
      ? { threadTs: publicationTarget.threadTs }
      : {}),
    ...(parsed.data.title ? { title: parsed.data.title } : {}),
  });
}
export async function rpcCenterAgentRecordConnectorActionAudit(
  env: CoreBindings,
  input: CenterAgentRecordConnectorActionAuditInput
): Promise<CenterAgentRecordConnectorActionAuditResponse> {
  const parsed = centerAgentRecordConnectorActionAuditBodySchema.safeParse({
    connectionName: input.connectionName,
    actionId: input.actionId,
    operationId: input.operationId,
    outcome: input.outcome,
    service: input.service,
    speakerMember: input.speakerMember,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent connector action audit payload",
      code: "invalid_payload",
    });
  }
  const { authorization, member } = await prepareRemoteAgentMemberRequest(
    env,
    requireRpcContext(input.context),
    parsed.data.speakerMember
  );
  if (!(member.profileId && member.userId)) {
    throw createCoreRpcHttpError({
      code: "center_agent.connector_action_speaker_required",
      reason:
        "Connector actions require a verified active human Organization member.",
      status: 403,
    });
  }
  if (parsed.data.outcome === "attempted") {
    if (!parsed.data.connectionName) {
      throw createCoreRpcHttpError({
        code: "plugin.connection_required",
        reason:
          "Update the Agent runtime to verify the selected plugin account before writing.",
        status: 409,
      });
    }
    await requireRemotePluginConnection({
      db: authorization.db,
      organizationId: authorization.activeOrganization.organizationId,
      connectionName: parsed.data.connectionName,
      service: parsed.data.service,
      requesterUserId: member.userId,
      remoteOwnerUserId:
        "personalExecution" in authorization
          ? (authorization.personalExecution.request.agentProfileOwnerUserId ??
            null)
          : undefined,
      effect: "write",
    });
  }
  const action = resolveCenterAgentConnectorAuditAction(parsed.data.outcome);
  const attribution = await writeCenterAgentAuditEntry({
    action,
    authorization,
    onBehalfOfProfileId: member.profileId,
    resource: {
      type: "connector_action",
      id: `${parsed.data.service}:${parsed.data.actionId}:${parsed.data.operationId}`,
    },
    sourceNativeDeliveryId: member.sourceNativeDeliveryId,
  });
  return centerAgentRecordConnectorActionAuditResponseSchema.parse({
    attribution,
    recorded: true,
  });
}
export async function rpcCenterAgentReadConnectorActionOperation(
  env: CoreBindings,
  input: CenterAgentReadConnectorActionOperationInput
): Promise<CenterAgentReadConnectorActionOperationResponse> {
  const parsed = centerAgentReadConnectorActionOperationBodySchema.safeParse({
    includeRequestAuthorization: input.includeRequestAuthorization,
    includeExecutionPermit: input.includeExecutionPermit,
    includeRecoveryWindow: input.includeRecoveryWindow,
    actionId: input.actionId,
    operationId: input.operationId,
    service: input.service,
    speakerMember: input.speakerMember,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent connector action operation read payload",
      status: 400,
    });
  }
  const prepared = await prepareRemoteAgentMemberRequest(
    env,
    requireRpcContext(input.context),
    parsed.data.speakerMember,
    { service: parsed.data.service, actionId: parsed.data.actionId }
  );
  const requester = resolveCenterAgentConnectorActionRequester(prepared.member);
  const existing = await readCenterAgentConnectorActionOperationForRecovery({
    actionId: parsed.data.actionId,
    db: prepared.authorization.db,
    scope: buildCenterAgentConnectorActionOperationScope({
      actorProfileId: prepared.authorization.actorProfileId,
      operationId: parsed.data.operationId,
      organizationId: prepared.authorization.activeOrganization.organizationId,
      requester,
    }),
    service: parsed.data.service,
  });
  return centerAgentReadConnectorActionOperationResponseSchema.parse({
    ...(parsed.data.includeRequestAuthorization
      ? {
          requestAuthorization: prepared.member.userId
            ? await readPluginActionRequestStatusForOperation({
                db: prepared.authorization.db,
                organizationId:
                  prepared.authorization.activeOrganization.organizationId,
                userId: prepared.member.userId,
                actorProfileId: prepared.authorization.actorProfileId,
                operationId: parsed.data.operationId,
                actionId: parsed.data.actionId,
                service: parsed.data.service,
              })
            : null,
        }
      : {}),
    operation: existing
      ? {
          ...(parsed.data.includeExecutionPermit
            ? {
                replay: await readConnectorActionReplayPermission({
                  db: prepared.authorization.db,
                  operation: existing,
                  nowMs: Date.now(),
                }),
              }
            : {}),
          ...(parsed.data.includeRecoveryWindow
            ? {
                replayWindowRemainingMs:
                  resolveConnectorActionReplayWindowRemainingMs(
                    existing.createdAtMs,
                    Date.now()
                  ),
              }
            : {}),
          actionId: existing.actionId,
          connectionName: existing.connectionName,
          createdAtMs: existing.createdAtMs,
          executionConnection: existing.executionConnection,
          linearIssueReceipt: existing.linearIssueReceipt,
          operationId: existing.operationId,
          providerExecutionId: existing.providerExecutionId,
          service: existing.service,
          status: existing.status,
        }
      : null,
  });
}
export async function rpcCenterAgentRecordConnectorActionOperation(
  env: CoreBindings,
  input: CenterAgentRecordConnectorActionOperationInput
): Promise<CenterAgentRecordConnectorActionOperationResponse> {
  const parsed = centerAgentRecordConnectorActionOperationBodySchema.safeParse({
    verificationOf: input.verificationOf,
    includeExecutionPermit: input.includeExecutionPermit,
    includeRecoveryWindow: input.includeRecoveryWindow,
    actionId: input.actionId,
    effect: input.effect,
    connectionName: input.connectionName,
    operationId: input.operationId,
    outcome: input.outcome,
    providerExecutionId: input.providerExecutionId,
    requestSignature: input.requestSignature,
    issueDestination: input.issueDestination,
    issueDestinationAuthority: input.issueDestinationAuthority,
    linearIssueReceipt: input.linearIssueReceipt,
    githubIssueCompletion: input.githubIssueCompletion,
    includeGitHubTaskSync: input.includeGitHubTaskSync,
    service: input.service,
    speakerMember: input.speakerMember,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent connector action operation payload",
      status: 400,
    });
  }
  const prepared = await prepareRemoteAgentMemberRequest(
    env,
    requireRpcContext(input.context),
    parsed.data.speakerMember,
    {
      service: parsed.data.service,
      actionId: parsed.data.actionId,
      connectionName: parsed.data.connectionName,
      requestSignature: parsed.data.requestSignature,
      effect: parsed.data.effect,
    }
  );
  const { authorization, member } = prepared;
  const requester = resolveCenterAgentConnectorActionRequester(member);
  const scope = buildCenterAgentConnectorActionOperationScope({
    actorProfileId: authorization.actorProfileId,
    operationId: parsed.data.operationId,
    organizationId: authorization.activeOrganization.organizationId,
    requester,
  });
  const existing = await readCenterAgentConnectorActionOperationForRequest({
    actionId: parsed.data.actionId,
    db: authorization.db,
    requestSignature: parsed.data.requestSignature,
    scope,
    service: parsed.data.service,
  });
  let attribution = existing?.attribution;
  let connectionName = existing?.operation.connectionName;
  let executionConnection =
    existing?.operation.executionConnection ?? undefined;
  let connectionUpdatedAtMs = existing?.operation.connectionUpdatedAtMs;
  const sourceRequestKey =
    member.sourceRequestKey ?? member.sourceNativeDeliveryId ?? undefined;
  if (parsed.data.outcome === "attempted") {
    requireConnectorTaskProvenance({
      existingOperation: Boolean(existing),
      effect: parsed.data.effect,
      sourceRequestKey,
    });
    // The operation freezes identity and attribution, never current permission.
    const exactConnectionName = connectionName ?? parsed.data.connectionName;
    const connection = await requireConnectorOperationConnection(
      {
        connectionName: exactConnectionName,
        db: authorization.db,
        organizationId: authorization.activeOrganization.organizationId,
        service: parsed.data.service,
        requesterUserId: member.userId,
        remoteOwnerUserId:
          "personalExecution" in authorization
            ? (authorization.personalExecution.request
                .agentProfileOwnerUserId ?? null)
            : undefined,
        effect: parsed.data.effect ?? "unspecified",
      },
      existing,
      parsed.data.connectionName
    );
    assertBoundPluginConnection(
      await readPluginConnectionExecutionBinding(
        env,
        requireRpcContext(input.context),
        parsed.data.service
      ),
      parsed.data.service,
      connection
    );
    if (!existing) {
      attribution = {
        actorProfileId: authorization.actorProfileId,
        onBehalfOf:
          member.profileId && member.userId
            ? {
                displayName: member.displayName,
                profileId: member.profileId,
                userId: member.userId,
              }
            : null,
      };
      connectionName = parsed.data.connectionName;
      const ownerDisplayName =
        connection.scope === "member"
          ? member.displayName
          : await resolveConnectorConnectionOwnerDisplayName({
              connectionName: connection.connectionName,
              env,
              ownerUserId: connection.userId,
            });
      executionConnection = {
        connectionName: connection.connectionName,
        ownerDisplayName,
        ownerUserId: connection.userId,
        scope: connection.scope,
        service: connection.service,
      };
      connectionUpdatedAtMs = connection.updatedAtMs;
    }
  }
  const verificationOf = await requireConnectorVerificationRead({
    db: authorization.db,
    scope,
    reference: parsed.data.verificationOf,
    effect: parsed.data.effect,
    connection: executionConnection,
    connectionUpdatedAtMs,
  });
  const issueAdmission = await prepareProjectIssueActionAdmission({
    env,
    context: requireRpcContext(input.context),
    db: authorization.db,
    organizationId: authorization.activeOrganization.organizationId,
    actorProfileId: authorization.actorProfileId,
    userId: member.userId,
    operation: parsed.data,
    existingOperation: Boolean(existing),
    sourceRequestKey,
    sourceSpaceId: member.sourceSpaceId,
    sourceNativeDeliveryId: member.sourceNativeDeliveryId,
    connection: executionConnection,
    connectionUpdatedAtMs,
    personalExecution: "personalExecution" in authorization,
  });
  const githubIssueObservation = await verifyGitHubIssueCompletion(parsed.data);
  const result = await recordCenterAgentConnectorActionOperation({
    actionId: parsed.data.actionId,
    actorProfileId: authorization.actorProfileId,
    attribution,
    connectionName: connectionName ?? parsed.data.connectionName,
    db: authorization.db,
    executionConnection,
    connectionUpdatedAtMs,
    nowMs: Date.now(),
    operationId: parsed.data.operationId,
    organizationId: authorization.activeOrganization.organizationId,
    outcome: parsed.data.outcome,
    linearIssueReceipt: parsed.data.linearIssueReceipt,
    githubIssueObservation,
    providerExecutionId: parsed.data.providerExecutionId,
    requester,
    requestSignature: parsed.data.requestSignature,
    issueRoutingDecision: issueAdmission.issueRoutingDecision,
    executionGuard: issueAdmission.executionGuard,
    service: parsed.data.service,
    sourceNativeDeliveryId: member.sourceNativeDeliveryId,
    sourceSpaceId: member.sourceSpaceId,
    sourceRequestKey: issueAdmission.sourceRequestKey,
    effectSignature: parsed.data.requestSignature,
    effect: parsed.data.effect,
    allowReplay: parsed.data.includeExecutionPermit === true,
  });
  return await presentConnectorOperationWithGitHubSync(
    env,
    existing?.sourceSpaceId,
    {
      actorProfileId: authorization.actorProfileId,
      result,
      db: authorization.db,
      request: parsed.data,
      verificationOf,
    }
  );
}

async function presentConnectorOperationWithGitHubSync(
  env: CoreBindings,
  sourceSpaceId: string | null | undefined,
  input: Parameters<typeof presentConnectorOperationResult>[0]
) {
  const githubTaskSync = await syncCompletedGitHubIssue({
    env,
    db: input.db,
    operation: input.result.operation,
    sourceSpaceId: sourceSpaceId ?? null,
  });
  const response = await presentConnectorOperationResult(input);
  return {
    ...response,
    ...(input.request.includeGitHubTaskSync && githubTaskSync
      ? { githubTaskSync }
      : {}),
  };
}

function requireConnectorTaskProvenance(input: {
  existingOperation: boolean;
  effect?: string;
  sourceRequestKey?: string;
}): void {
  if (
    !input.existingOperation &&
    input.effect !== "read" &&
    !input.sourceRequestKey
  ) {
    throw createCoreRpcHttpError({
      code: "plugin.task_provenance_unavailable",
      reason:
        "OpenMeld could not verify the original task for this write. Retry the same task and operation ID when task history is available. Do not create a replacement operation.",
      status: 409,
    });
  }
}

async function presentConnectorOperationResult(input: {
  actorProfileId: string;
  verificationOf?: Awaited<ReturnType<typeof requireConnectorVerificationRead>>;
  db: PostgresDatabase;
  request: ReturnType<
    typeof centerAgentRecordConnectorActionOperationBodySchema.parse
  >;
  result: Awaited<ReturnType<typeof recordCenterAgentConnectorActionOperation>>;
}) {
  const { result, request } = input;
  if (
    request.outcome === "attempted" &&
    !result.executionAllowed &&
    !request.includeExecutionPermit
  ) {
    throw createCoreRpcHttpError({
      code: "plugin.operation_recovery_required",
      reason: `Operation ${result.operation.operationId} is ${result.operation.status}. Use a current runtime to read its recovery receipt; do not repeat the write with another ID.`,
      status: 409,
    });
  }
  return centerAgentRecordConnectorActionOperationResponseSchema.parse({
    ...(input.verificationOf ? { verificationOf: input.verificationOf } : {}),
    ...(request.includeExecutionPermit
      ? {
          executionAllowed: result.executionAllowed,
          replay: await readConnectorActionReplayPermission({
            actorProfileId: input.actorProfileId,
            db: input.db,
            operation: result.operation,
            nowMs: Date.now(),
          }),
        }
      : {}),
    ...(request.includeRecoveryWindow
      ? {
          replayWindowRemainingMs:
            resolveConnectorActionReplayWindowRemainingMs(
              result.operation.createdAtMs,
              Date.now()
            ),
        }
      : {}),
    attribution: result.attribution,
    executionConnection: result.operation.executionConnection,
    operationId: result.operation.operationId,
    providerExecutionId: result.operation.providerExecutionId,
    recorded: true,
    replayed: result.replayed,
    status: result.operation.status,
  });
}
async function requireConnectorOperationConnection(
  access: Parameters<typeof requireRemotePluginConnection>[0],
  existing: Awaited<
    ReturnType<typeof readCenterAgentConnectorActionOperationForRequest>
  >,
  requestedConnectionName: string
) {
  const original = existing?.operation.executionConnection;
  const invalid = () =>
    createCoreRpcHttpError({
      code: "center_agent.connector_action_connection_invalid",
      reason: "The operation must use its original available account.",
      status: 409,
    });
  if (requestedConnectionName !== access.connectionName) {
    throw invalid();
  }
  const connection = await requireRemotePluginConnection(access);
  if (
    original &&
    (connection.scope !== original.scope ||
      (existing?.operation.connectionUpdatedAtMs !== null &&
        connection.updatedAtMs !== existing?.operation.connectionUpdatedAtMs) ||
      connection.userId !== original.ownerUserId ||
      connection.service !== original.service)
  ) {
    throw invalid();
  }
  return connection;
}
function resolveCenterAgentConnectorActionRequester(
  member: CenterAgentOrganizationMember
): CenterAgentConnectorActionRequester {
  if (member.userId) {
    return {
      kind: "represented_member",
      representedUserId: member.userId,
    };
  }
  if (member.sourceNativeDeliveryId) {
    return {
      kind: "connected_message_channel_member",
      sourceNativeDeliveryId: member.sourceNativeDeliveryId,
    };
  }
  throw new Error(
    "A Center Agent connector action requester was not authorized."
  );
}
async function resolveConnectorConnectionOwnerDisplayName(input: {
  connectionName: string;
  env: CoreBindings;
  ownerUserId: string;
}): Promise<string> {
  const authWorker = input.env.OPENMELD_AUTH_WORKER;
  if (!authWorker) {
    logConnectorConnectionOwnerResolutionFailure({
      connectionName: input.connectionName,
      ownerUserId: input.ownerUserId,
      stage: "binding",
    });
    throw connectorConnectionOwnerUnavailableError();
  }
  let result: unknown;
  try {
    result = await callRequiredAuthWorkerRpc({
      authWorker,
      call: async (worker) =>
        await worker.resolveUserDisplayName({ userId: input.ownerUserId }),
      unavailable: CONNECTOR_CONNECTION_OWNER_UNAVAILABLE,
    });
  } catch (error) {
    logConnectorConnectionOwnerResolutionFailure({
      connectionName: input.connectionName,
      error,
      ownerUserId: input.ownerUserId,
      stage: "rpc",
    });
    throw error;
  }
  const parsed = authRpcResolveUserDisplayNameResultSchema.safeParse(result);
  if (
    !(parsed.success && parsed.data.ok) ||
    parsed.data.userId !== input.ownerUserId
  ) {
    logConnectorConnectionOwnerResolutionFailure({
      authCode:
        parsed.success && !parsed.data.ok ? parsed.data.code : undefined,
      connectionName: input.connectionName,
      ownerUserId: input.ownerUserId,
      stage: parsed.success ? "result" : "response",
    });
    throw connectorConnectionOwnerUnavailableError();
  }
  return parsed.data.displayName;
}
const CONNECTOR_CONNECTION_OWNER_UNAVAILABLE = {
  code: "connector.connection_owner_unavailable",
  reason: "The connector connection owner identity is temporarily unavailable.",
} as const;
function connectorConnectionOwnerUnavailableError(): Error {
  return createCoreRpcHttpError({
    ...CONNECTOR_CONNECTION_OWNER_UNAVAILABLE,
    status: 503,
  });
}
function logConnectorConnectionOwnerResolutionFailure(input: {
  authCode?: string;
  connectionName: string;
  error?: unknown;
  ownerUserId: string;
  stage: "binding" | "response" | "result" | "rpc";
}): void {
  const event = "core.connector.connection_owner_unavailable";
  console.error(`[${event}]`, {
    event,
    connectionName: input.connectionName,
    ownerUserId: input.ownerUserId,
    stage: input.stage,
    ...(input.authCode ? { authCode: input.authCode } : {}),
    ...(input.error === undefined
      ? {}
      : {
          error: toErrorMessage(input.error),
          errorName:
            input.error instanceof Error
              ? input.error.name
              : typeof input.error,
          errorStack:
            input.error instanceof Error ? input.error.stack : undefined,
        }),
  });
}
function resolveCenterAgentConnectorAuditAction(
  outcome: CenterAgentRecordConnectorActionAuditInput["outcome"]
): CenterAgentAction {
  switch (outcome) {
    case "attempted":
      return "execute_connector_action";
    case "completed":
      return "complete_connector_action";
    case "failed":
      return "fail_connector_action";
    case "outcome_unknown":
      return "record_connector_action_outcome_unknown";
    default:
      throw new Error(`Unsupported connector audit outcome: ${outcome}`);
  }
}
function parseCenterAgentWakeAgentProfilesInSpaceInput(
  input: CenterAgentWakeAgentProfilesInSpaceInput
) {
  if (input.pluginActions && !input.completionMode) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "plugin.recorded_delegation_required",
      reason: "Plugin authorization requires a recorded one-hop delegation.",
    });
  }
  const parsed = centerAgentWakeAgentProfilesInSpaceBodySchema.safeParse({
    pluginActions: input.pluginActions,
    evidenceRefs: input.evidenceRefs,
    agentProfileIds: input.agentProfileIds,
    ...(input.completionMode === undefined
      ? {}
      : { completionMode: input.completionMode }),
    ...(input.replyLanguageTag === undefined
      ? {}
      : { replyLanguageTag: input.replyLanguageTag }),
    ...(input.fallbackAgentProfileId === undefined
      ? {}
      : { fallbackAgentProfileId: input.fallbackAgentProfileId }),
    ...(input.mentionProfileIds === undefined
      ? {}
      : { mentionProfileIds: input.mentionProfileIds }),
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
    ...(input.referenceProfileIds === undefined
      ? {}
      : { referenceProfileIds: input.referenceProfileIds }),
    spaceId: input.spaceId,
    text: input.text,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Space Wake payload",
      code: "invalid_payload",
    });
  }
  return parsed.data;
}

export async function rpcCenterAgentWakeAgentProfilesInSpaces(
  env: CoreBindings,
  input: CenterAgentWakeAgentProfilesInSpacesInput,
  waitUntil: (work: Promise<unknown>) => void
): Promise<CenterAgentWakeAgentProfilesInSpacesResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentWakeAgentProfilesInSpacesBodySchema.safeParse({
    destinations: input.destinations,
    replyLanguageTag: input.replyLanguageTag,
    onBehalfOf: input.onBehalfOf,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "Invalid multi-Space Wake.",
    });
  }
  const request = parsed.data;
  const destinations = request.destinations
    .map((destination) => ({
      spaceId: destination.spaceId,
      text: buildDelegatedTaskText(destination.text, request.replyLanguageTag),
      agentProfileIds: [...new Set(destination.agentProfileIds)].sort(),
      mentionProfileIds: [
        ...new Set(destination.mentionProfileIds ?? []),
      ].sort(),
      referenceProfileIds: [
        ...new Set(destination.referenceProfileIds ?? []),
      ].sort(),
    }))
    .sort((left, right) => left.spaceId.localeCompare(right.spaceId));
  const db = requireAgentTaskCoordinationDb(env);
  const member = await requireCenterAgentWakeMembers({
    actorProfileId: authorization.actorProfileId,
    db: requireCenterAgentDb(env),
    organizationId: authorization.activeOrganization.organizationId,
    targetProfileIds: [
      ...new Set(
        destinations.flatMap((destination) => destination.agentProfileIds)
      ),
    ],
  });
  for (const destination of destinations) {
    await requireCenterAgentSpaceInActiveOrganization({
      authorization,
      env,
      spaceId: destination.spaceId,
    });
  }
  const parentSubmissionId = normalizeOptionalText(
    authorization.context.agentControllerConversationId
  );
  if (!parentSubmissionId) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "center_agent.delegation_parent_unavailable",
      reason:
        "The active Center Agent task could not be linked to this delegation.",
    });
  }
  const batchKey = hashClientMessageIdMaterial(
    JSON.stringify({
      destinations,
      parentSubmissionId,
      requestId: authorization.context.actorContext.requestId ?? null,
      actorProfileId: authorization.actorProfileId,
      onBehalfOf: request.onBehalfOf ?? null,
      replyLanguageTag: request.replyLanguageTag ?? null,
    })
  );
  const publicationIdAt = (index: number) =>
    `ca-wake:batch:${batchKey}:${index}`;
  const publicationIds = destinations.map((_, index) => publicationIdAt(index));
  const rootId = publicationIdAt(0);
  const firstDestination = destinations[0];
  if (!firstDestination) {
    throw new Error("Wake batch has no destinations");
  }
  const delegation = planCenterAgentWakeDelegation({
    childSpaceId: firstDestination.spaceId,
    clientMessageId: rootId,
    targetProfileIds: firstDestination.agentProfileIds,
    additionalDestinations: destinations.slice(1).map((destination, index) => ({
      childSpaceId: destination.spaceId,
      clientMessageId: publicationIdAt(index + 1),
      targetProfileIds: destination.agentProfileIds,
    })),
  });
  await requireCenterAgentContinuationParent({
    actorProfileId: authorization.actorProfileId,
    claimRoutineContinuation: false,
    continuationDelegationId: delegation.delegationId,
    destinationNeutralContinuations:
      shouldWriteDestinationNeutralTaskContinuations(env),
    db,
    organizationId: authorization.activeOrganization.organizationId,
    parentSubmissionId,
    resumesParent: true,
    routineDelegationCompletionMode: "resume_parent_when_all_terminal",
  });
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization,
    onBehalfOfProfileId: request.onBehalfOf?.profileId ?? null,
  });
  const profile = buildProfileDisplay({
    agentControllerRef: member.agentControllerRef,
    ownerName: member.ownerName,
    ownerUserId: member.ownerUserId,
    profileId: member.profileId,
    profileKind: "agent",
    profileName: member.profileName,
  });
  await prepareCenterAgentWakePublicationBatch({
    commands: destinations.map((destination, index) => ({
      activationTargets: destination.agentProfileIds,
      attribution,
      batchRootPublicationId: rootId,
      ...(index === 0 ? { batchPublicationIds: publicationIds } : {}),
      clientMessageId: publicationIdAt(index),
      completionMode: "resume_parent_when_all_terminal",
      replyLanguageTag: request.replyLanguageTag,
      context: authorization.context,
      delegationId: delegation.delegationId,
      fallbackAgentProfileId: null,
      organizationId: authorization.activeOrganization.organizationId,
      parentSubmissionId,
      profile,
      mentionTargets: destination.mentionProfileIds,
      referenceTargets: destination.referenceProfileIds,
      spaceAddressingVersion: OPENMELD_SPACE_ADDRESSING_VERSION,
      spaceId: destination.spaceId,
      subscriptionIds: delegation.childTasks
        .filter((child) => child.task.spaceId === destination.spaceId)
        .map((child) => child.subscriptionId),
      text: destination.text,
      v: 1,
    })),
    db,
    destinationNeutralContinuations:
      shouldWriteDestinationNeutralTaskContinuations(env),
    nowMs: Date.now(),
  });
  // Persist the continuation before queued can end the parent turn.
  // This is an acceptance receipt for the entire durable plan. Each Space's
  // exact publication is independently redriven by the existing scheduler.
  waitUntil(
    Promise.allSettled(
      publicationIds.map(async (publicationId) => {
        await executeCenterAgentWakePublication({
          db,
          destinationNeutralContinuations:
            shouldWriteDestinationNeutralTaskContinuations(env),
          nowMs: Date.now(),
          publicationId,
          publishSignal: (command) =>
            rpcPostCenterAgentWakePublicationSignal(env, command),
          resolveSignal: (command) =>
            rpcResolveCenterAgentWakePublicationSignal(env, command),
        });
      })
    ).then((results) => {
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") {
          console.error("[core.center_agent.wake_batch.publication_failed]", {
            publicationId: publicationIds[index],
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      }
    })
  );
  return centerAgentWakeAgentProfilesInSpacesResponseSchema.parse({
    status: "queued",
    delegationId: delegation.delegationId,
    childTasks: delegation.childTasks,
  });
}

export async function rpcCenterAgentWakeAgentProfilesInSpace(
  env: CoreBindings,
  input: CenterAgentWakeAgentProfilesInSpaceInput
): Promise<CenterAgentWakeAgentProfilesInSpaceResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = parseCenterAgentWakeAgentProfilesInSpaceInput(input);
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.spaceId,
  });
  const db = requireCenterAgentDb(env);
  const taskCoordinationDb = requireAgentTaskCoordinationDb(env);
  const targetProfileIds = [...new Set(parsed.agentProfileIds)].sort();
  const referenceProfileIds = [
    ...new Set(parsed.referenceProfileIds ?? []),
  ].sort();
  const mentionProfileIds = [...new Set(parsed.mentionProfileIds ?? [])].sort();
  const spaceAddressingVersion =
    resolveCenterAgentSpaceAddressingVersion(input);
  const validatedProfileIds = [
    ...targetProfileIds,
    ...(parsed.fallbackAgentProfileId ? [parsed.fallbackAgentProfileId] : []),
  ];
  const centerAgentMember = await requireCenterAgentWakeMembers({
    actorProfileId: authorization.actorProfileId,
    db,
    organizationId: authorization.activeOrganization.organizationId,
    targetProfileIds: validatedProfileIds,
  });
  if (parsed.onBehalfOf?.profileId === authorization.actorProfileId) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        "onBehalfOfProfileId must identify the human member the Center Agent is helping.",
      code: "center_agent.on_behalf_of_center_agent_disallowed",
    });
  }
  const clientMessageId = buildCenterAgentWakeClientMessageId({
    pluginActions: parsed.pluginActions,
    evidenceRefs: parsed.evidenceRefs,
    activationTargets: targetProfileIds,
    completionMode: parsed.completionMode,
    context: authorization.context,
    onBehalfOfProfileId: parsed.onBehalfOf?.profileId ?? null,
    fallbackAgentProfileId: parsed.fallbackAgentProfileId ?? null,
    mentionProfileIds,
    spaceId: parsed.spaceId,
    referenceProfileIds,
    spaceAddressingVersion,
    text: parsed.text,
  });
  const profile = buildProfileDisplay({
    agentControllerRef: centerAgentMember.agentControllerRef,
    ownerName: centerAgentMember.ownerName,
    ownerUserId: centerAgentMember.ownerUserId,
    profileId: centerAgentMember.profileId,
    profileKind: "agent",
    profileName: centerAgentMember.profileName,
  });
  let delegation: ReturnType<typeof planCenterAgentWakeDelegation> | null =
    null;
  let attribution: CenterAgentWakeAgentProfilesInSpaceResponse["attribution"];
  let publication:
    | {
        signal: Extract<
          SignalEnvelope,
          {
            type: "signal.text";
          }
        >;
      }
    | {
        publicationStatus: "pending";
        retryAfterSeconds: number;
      };
  if (parsed.completionMode) {
    const delegatedWake = await executeCenterAgentDelegatedWake({
      pluginActions: parsed.pluginActions,
      evidenceRefs: parsed.evidenceRefs,
      authorization,
      clientMessageId,
      completionMode: parsed.completionMode,
      replyLanguageTag: parsed.replyLanguageTag,
      db: taskCoordinationDb,
      env,
      fallbackAgentProfileId: parsed.fallbackAgentProfileId ?? null,
      mentionProfileIds,
      onBehalfOfProfileId: parsed.onBehalfOf?.profileId ?? null,
      profile,
      referenceProfileIds,
      spaceAddressingVersion,
      spaceId: parsed.spaceId,
      targetProfileIds,
      text: parsed.text,
    });
    attribution = delegatedWake.attribution;
    delegation = delegatedWake.delegation;
    publication =
      delegatedWake.publicationStatus === "accepted"
        ? {
            signal: delegatedWake.signal,
          }
        : {
            publicationStatus: "pending",
            retryAfterSeconds: delegatedWake.retryAfterSeconds,
          };
  } else {
    attribution = await recordCenterAgentDirectWakeAttribution({
      authorization,
      clientMessageId,
      onBehalfOfProfileId: parsed.onBehalfOf?.profileId ?? null,
      spaceId: parsed.spaceId,
    });
    const postedSignal = await rpcPostSignalOnceByClientMessageId(env, {
      authoringPolicy: "user_authored",
      clientMessageId,
      context: authorization.context,
      messageEnvelope: {
        activationTargets: targetProfileIds,
        ...(input.mentionProfileIds === undefined
          ? {}
          : { mentionTargets: mentionProfileIds }),
        referenceTargets: referenceProfileIds,
        text: parsed.text,
      },
      meta: {
        clientMessageId,
        evidenceRefs: parsed.evidenceRefs,
      },
      profile,
      spaceAddressingVersion,
      spaceId: parsed.spaceId,
      text: parsed.text,
    });
    if (postedSignal.type !== "signal.text") {
      throw new Error(
        `Center Agent Space Wake expected signal.text but received ${postedSignal.type}`
      );
    }
    publication = {
      signal: postedSignal,
    };
  }
  const response = buildCenterAgentWakeAgentProfilesInSpaceResponse({
    agentProfileIds: targetProfileIds,
    attribution,
    delegation,
    organizationId: authorization.activeOrganization.organizationId,
    publication,
    spaceId: parsed.spaceId,
  });
  if (input.mentionProfileIds !== undefined || !("signal" in response)) {
    return response;
  }
  return {
    ...response,
    signal: projectLegacyCenterAgentSpaceAddressingSignal({
      referenceProfileIds,
      signal: response.signal,
    }),
  };
}
async function recordCenterAgentDirectWakeAttribution(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  clientMessageId: string;
  onBehalfOfProfileId: string | null;
  spaceId: string;
}): Promise<CenterAgentWakeAgentProfilesInSpaceResponse["attribution"]> {
  // Write before the idempotent Space post, so a crash cannot leave an
  // accepted Wake without requester provenance. Replays preserve the row.
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization: input.authorization,
    onBehalfOfProfileId: input.onBehalfOfProfileId,
  });
  await insertCenterAgentAuditJournalEntryIfMissing({
    action: "wake_agent_profiles_in_space",
    actorProfileId: input.authorization.actorProfileId,
    attribution,
    db: input.authorization.db,
    id: `center-agent-wake:${input.clientMessageId}`,
    nowMs: Date.now(),
    organizationId: input.authorization.activeOrganization.organizationId,
    resource: { type: "space", id: input.spaceId },
  });
  const recorded = await readCenterAgentWakeAuditAttribution({
    clientMessageId: input.clientMessageId,
    db: input.authorization.db,
  });
  if (
    recorded?.organizationId !==
      input.authorization.activeOrganization.organizationId ||
    recorded.actorProfileId !== input.authorization.actorProfileId ||
    recorded.resourceType !== "space" ||
    recorded.resourceId !== input.spaceId ||
    recorded.onBehalfOfProfileId !==
      (attribution.onBehalfOf?.profileId ?? null) ||
    recorded.onBehalfOfUserId !== (attribution.onBehalfOf?.userId ?? null)
  ) {
    throw new Error("Center Agent Wake requester provenance conflicted");
  }
  return attribution;
}
function buildCenterAgentWakeAgentProfilesInSpaceResponse(input: {
  agentProfileIds: string[];
  attribution: CenterAgentWakeAgentProfilesInSpaceResponse["attribution"];
  delegation: ReturnType<typeof planCenterAgentWakeDelegation> | null;
  organizationId: string;
  publication:
    | {
        signal: Extract<
          SignalEnvelope,
          {
            type: "signal.text";
          }
        >;
      }
    | {
        publicationStatus: "pending";
        retryAfterSeconds: number;
      };
  spaceId: string;
}): CenterAgentWakeAgentProfilesInSpaceResponse {
  const response = {
    agentProfileIds: input.agentProfileIds,
    attribution: input.attribution,
    ...(input.delegation
      ? {
          childTasks: input.delegation.childTasks,
          delegationId: input.delegation.delegationId,
          ...(input.delegation.fallbackTask
            ? { fallbackTask: input.delegation.fallbackTask }
            : {}),
        }
      : {}),
    organizationId: input.organizationId,
    ...input.publication,
    resource: { type: "space" as const, id: input.spaceId },
    spaceId: input.spaceId,
  };
  const validated =
    centerAgentWakeAgentProfilesInSpaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space Wake response: ${validated.error.message}`
    );
  }
  return validated.data;
}
export async function rpcCenterAgentWatchAgentTask(
  env: CoreBindings,
  input: CenterAgentWatchAgentTaskInput
): Promise<CenterAgentWatchAgentTaskResponse> {
  if (!input.speakerMember) {
    throw createCoreRpcHttpError({
      code: "center_agent.represented_member_required",
      reason: "This task requires a verified member request.",
      status: 403,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      input.speakerMember
    );
  const parsed = centerAgentWatchAgentTaskBodySchema.safeParse({
    completionCondition: input.completionCondition,
    instruction: input.instruction,
    ...(input.replyLanguageTag === undefined
      ? {}
      : { replyLanguageTag: input.replyLanguageTag }),
    task: input.task,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent task watch payload",
      status: 400,
    });
  }
  const db = requireCenterAgentDb(env);
  const taskCoordinationDb = requireAgentTaskCoordinationDb(env);
  let controllerTaskRegistration:
    | {
        ownerUserId: string;
        registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"];
      }
    | undefined;
  switch (parsed.data.task.kind) {
    case "space_wake": {
      await requireCenterAgentSpaceInActiveOrganization({
        authorization,
        env,
        spaceId: parsed.data.task.spaceId,
      });
      if (
        !(await isCenterAgentSpaceWakeWatchTargetRegistered({
          organizationId: authorization.activeOrganization.organizationId,
          task: parsed.data.task,
          taskCoordinationDb,
          wakeEvidenceDb: db,
        }))
      ) {
        throw createCoreRpcHttpError({
          code: "center_agent.task_watch_target_not_found",
          reason:
            "The exact Space Wake task is not available in this Organization.",
          status: 404,
        });
      }
      break;
    }
    case "native_delivery": {
      const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
        db,
        deliveryId: parsed.data.task.deliveryId,
      });
      if (
        !delivery ||
        delivery.organizationId !==
          authorization.activeOrganization.organizationId
      ) {
        throw createCoreRpcHttpError({
          code: "center_agent.task_watch_target_not_found",
          reason:
            "The exact hosted Agent task is not available in this Organization.",
          status: 404,
        });
      }
      break;
    }
    case "controller_task": {
      const registeredTask = await readRegisteredAgentControllerTask({
        db: taskCoordinationDb,
        task: parsed.data.task,
      });
      if (
        !registeredTask ||
        registeredTask.organizationId !==
          authorization.activeOrganization.organizationId ||
        registeredTask.ownerUserId !== representedHuman.userId
      ) {
        throw createCoreRpcHttpError({
          code: "center_agent.task_watch_target_not_found",
          reason:
            "The exact Agent Controller task is not registered in this Organization.",
          status: 404,
        });
      }
      if (
        !doesControllerTaskSupportCompletionCondition({
          completionCondition: parsed.data.completionCondition,
          registrationSource: registeredTask.registrationSource,
        })
      ) {
        throw createCoreRpcHttpError({
          code: "center_agent.task_watch_controller_callback_unavailable",
          reason:
            "This Agent Controller task does not publish the requested lifecycle event.",
          status: 409,
        });
      }
      controllerTaskRegistration = {
        ownerUserId: registeredTask.ownerUserId,
        registrationSource: registeredTask.registrationSource,
      };
      break;
    }
    default:
      assertNeverAgentTask(parsed.data.task);
  }
  const parentSubmissionId = normalizeOptionalText(
    authorization.context.agentControllerConversationId
  );
  if (!parentSubmissionId) {
    throw createCoreRpcHttpError({
      code: "center_agent.task_watch_parent_unavailable",
      reason: "The active Center Agent task could not be linked to this watch.",
      status: 409,
    });
  }
  const watchId = buildCenterAgentTaskWatchId({
    completionCondition: parsed.data.completionCondition,
    context: authorization.context,
    instruction: parsed.data.instruction,
    taskKey: buildAgentTaskKey(parsed.data.task),
  });
  let watch: Awaited<ReturnType<typeof prepareCenterAgentTaskWatch>>;
  try {
    watch = await prepareCenterAgentTaskWatch({
      actorProfileId: authorization.actorProfileId,
      completionCondition: parsed.data.completionCondition,
      ...(controllerTaskRegistration ? { controllerTaskRegistration } : {}),
      db: taskCoordinationDb,
      env,
      instruction: parsed.data.instruction,
      nowMs: Date.now(),
      replyLanguageTag: parsed.data.replyLanguageTag,
      organizationId: authorization.activeOrganization.organizationId,
      parentSubmissionId,
      task: parsed.data.task,
      watchId,
    });
  } catch (error) {
    if (!(error instanceof CenterAgentDelegationPreparationError)) {
      throw error;
    }
    throw createCoreRpcHttpError({
      code: error.code,
      reason: error.message,
      status: resolveCenterAgentTaskWatchPreparationErrorStatus(error.code),
    });
  }
  const resource = {
    id: buildAgentTaskKey(parsed.data.task),
    type: "agent_task",
  };
  const attribution = await writeCenterAgentAuditEntry({
    action: "watch_agent_task",
    authorization,
    onBehalfOfProfileId: watch.onBehalfOfProfileId,
    resource,
  });
  return centerAgentWatchAgentTaskResponseSchema.parse({
    completionCondition: watch.completionCondition,
    outcome: watch.outcome,
    status: watch.status,
    subscriptionId: watch.subscriptionId,
    task: watch.task,
    watchId: watch.watchId,
    attribution,
    organizationId: authorization.activeOrganization.organizationId,
    resource,
  });
}
export async function rpcCenterAgentContinueTaskSummary(
  env: CoreBindings,
  input: ReturnType<typeof centerAgentContinueTaskSummaryBodySchema.parse> & {
    context?: CoreRpcContextInput;
  }
) {
  const parsed = centerAgentContinueTaskSummaryBodySchema.safeParse({
    sourceSubscriptionId: input.sourceSubscriptionId,
    inspectOnly: input.inspectOnly,
    includePublishedResult: input.includePublishedResult,
    replyLanguageTag: input.replyLanguageTag,
    speakerMember: input.speakerMember,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Invalid task summary recovery request.",
      status: 400,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember
    );
  return centerAgentContinueTaskSummaryResponseSchema.parse(
    await continueTaskSummary({
      actorProfileId: authorization.actorProfileId,
      db: requireAgentTaskCoordinationDb(env),
      env,
      inspectOnly: parsed.data.inspectOnly === true,
      includePublishedResult: parsed.data.includePublishedResult,
      nowMs: Date.now(),
      operatorUserId: representedHuman.userId,
      organizationId: authorization.activeOrganization.organizationId,
      sourceSubscriptionId: parsed.data.sourceSubscriptionId,
      replyLanguageTag: parsed.data.replyLanguageTag,
    })
  );
}
async function isCenterAgentSpaceWakeWatchTargetRegistered(input: {
  organizationId: string;
  task: Extract<
    CenterAgentWatchAgentTaskInput["task"],
    {
      kind: "space_wake";
    }
  >;
  taskCoordinationDb: PostgresDatabase;
  wakeEvidenceDb: PostgresDatabase;
}): Promise<boolean> {
  const delegation = await readAgentDelegationByChildTask({
    db: input.taskCoordinationDb,
    task: input.task,
  });
  if (delegation) {
    const taskKey = buildAgentTaskKey(input.task);
    const delegatedChild = delegation.children.find(
      (child) => buildAgentTaskKey(child.task) === taskKey
    );
    return (
      delegation.organizationId === input.organizationId &&
      (delegatedChild?.state === "active" ||
        delegatedChild?.state === "terminal")
    );
  }
  const dispatchLookup = await readSpaceDispatchLookupByClientMessageId({
    clientMessageId: input.task.sourceClientMessageId,
    db: input.wakeEvidenceDb,
    spaceId: input.task.spaceId,
    targetProfileId: input.task.targetProfileId,
  });
  if (dispatchLookup.matches.length > 0) {
    return true;
  }
  return false;
}
function resolveCenterAgentTaskWatchPreparationErrorStatus(code: string) {
  if (code === "center_agent.task_watch_self_reference") {
    return 400;
  }
  if (code === "center_agent.task_watch_target_not_found") {
    return 404;
  }
  return 409;
}
export async function rpcCenterAgentListAgentTasks(
  env: CoreBindings,
  input: CenterAgentListAgentTasksInput
): Promise<CenterAgentListAgentTasksResponse> {
  if (!input.speakerMember) {
    throw createCoreRpcHttpError({
      code: "center_agent.represented_member_required",
      reason: "This task requires a verified member request.",
      status: 403,
    });
  }
  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      input.speakerMember
    );
  const parsed = centerAgentListAgentTasksBodySchema.safeParse({
    ...(input.agentControllerRef === undefined
      ? {}
      : { agentControllerRef: input.agentControllerRef }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent task list payload",
      status: 400,
    });
  }
  const limit = parsed.data.limit ?? 10;
  const listed = await listRegisteredAgentControllerTasks({
    ...(parsed.data.agentControllerRef === undefined
      ? {}
      : { agentControllerRef: parsed.data.agentControllerRef }),
    db: requireAgentTaskCoordinationDb(env),
    limit: limit + 1,
    organizationId: authorization.activeOrganization.organizationId,
    ownerUserId: representedHuman.userId,
  });
  await writeCenterAgentAuditEntry({
    action: "read_agent_tasks",
    authorization,
    onBehalfOfProfileId: null,
    resource: null,
  });
  return centerAgentListAgentTasksResponseSchema.parse({
    hasMore: listed.length > limit,
    organizationId: authorization.activeOrganization.organizationId,
    tasks: listed.slice(0, limit).map(({ outcome, registeredTask }) => ({
      outcome,
      registeredAtMs: registeredTask.occurredAtMs,
      registrationSource: registeredTask.registrationSource,
      supportedCompletionConditions:
        resolveControllerTaskSupportedCompletionConditions(
          registeredTask.registrationSource
        ),
      task: registeredTask.task,
    })),
  });
}
function doesControllerTaskSupportCompletionCondition(input: {
  completionCondition: AgentTaskCompletionCondition;
  registrationSource: import("@openmeld/schemas/types").AgentControllerTaskLifecycleEventSource;
}): boolean {
  return resolveControllerTaskSupportedCompletionConditions(
    input.registrationSource
  ).includes(input.completionCondition);
}
function resolveControllerTaskSupportedCompletionConditions(
  registrationSource: import("@openmeld/schemas/types").AgentControllerTaskLifecycleEventSource
): AgentTaskCompletionCondition[] {
  if (registrationSource === "claude_task_created") {
    return ["terminal", "succeeded"];
  }
  if (
    registrationSource === "claude_subagent_start" ||
    registrationSource === "codex_subagent_start" ||
    registrationSource === "codex_user_prompt_submit"
  ) {
    return ["terminal"];
  }
  return [];
}
async function requireCenterAgentWakeMembers(input: {
  actorProfileId: string;
  db: PostgresDatabase;
  organizationId: string;
  targetProfileIds: string[];
}) {
  const targetMembers = await Promise.all(
    input.targetProfileIds.map((profileId) =>
      readResolvedOrganizationSpaceMember({
        db: input.db,
        organizationId: input.organizationId,
        profileId,
      })
    )
  );
  for (const [index, targetMember] of targetMembers.entries()) {
    const profileId = input.targetProfileIds[index];
    if (!targetMember) {
      throw createCoreRpcHttpError({
        status: 404,
        reason: "Target Agent Profile is not available in this Organization.",
        code: "center_agent.wake_target_profile_not_found",
      });
    }
    if (targetMember.profileKind !== "agent") {
      throw createCoreRpcHttpError({
        status: 400,
        reason: "Target profile must be an Agent Profile.",
        code: "center_agent.wake_target_agent_required",
      });
    }
    if (profileId === input.actorProfileId) {
      throw createCoreRpcHttpError({
        status: 400,
        reason: "Center Agent cannot Wake itself through this tool.",
        code: "center_agent.wake_target_self",
      });
    }
  }
  const centerAgentMember = await readResolvedOrganizationSpaceMember({
    db: input.db,
    organizationId: input.organizationId,
    profileId: input.actorProfileId,
  });
  if (!(centerAgentMember && centerAgentMember.profileKind === "agent")) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Center Agent profile is not available in this Organization.",
      code: "center_agent.profile_not_found",
    });
  }
  return centerAgentMember;
}
async function executeCenterAgentDelegatedWake(input: {
  evidenceRefs?: CenterAgentWakeAgentProfilesInSpaceInput["evidenceRefs"];
  pluginActions?: CenterAgentWakeAgentProfilesInSpaceInput["pluginActions"];
  authorization: CurrentDesignatedCenterAgentAuthorization;
  clientMessageId: string;
  completionMode: CenterAgentWakePublicationCommand["completionMode"];
  replyLanguageTag?: string;
  db: PostgresDatabase;
  env: CoreBindings;
  fallbackAgentProfileId: string | null;
  mentionProfileIds: string[];
  onBehalfOfProfileId: string | null;
  profile: Profile;
  referenceProfileIds: string[];
  spaceAddressingVersion?: typeof OPENMELD_SPACE_ADDRESSING_VERSION;
  spaceId: string;
  targetProfileIds: string[];
  text: string;
}): Promise<
  {
    attribution: CenterAgentWakeAgentProfilesInSpaceResponse["attribution"];
    delegation: ReturnType<typeof planCenterAgentWakeDelegation>;
  } & (
    | {
        publicationStatus: "accepted";
        signal: Extract<
          SignalEnvelope,
          {
            type: "signal.text";
          }
        >;
      }
    | {
        publicationStatus: "pending";
        retryAfterSeconds: number;
      }
  )
> {
  const parentSubmissionId = normalizeOptionalText(
    input.authorization.context.agentControllerConversationId
  );
  if (!parentSubmissionId) {
    throw createCoreRpcHttpError({
      code: "center_agent.delegation_parent_unavailable",
      reason:
        "The active Center Agent task could not be linked to this delegation.",
      status: 409,
    });
  }
  const delegation = planCenterAgentWakeDelegation({
    childSpaceId: input.spaceId,
    clientMessageId: input.clientMessageId,
    ...(input.fallbackAgentProfileId
      ? { fallbackAgentProfileId: input.fallbackAgentProfileId }
      : {}),
    targetProfileIds: input.targetProfileIds,
  });
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization: input.authorization,
    onBehalfOfProfileId: input.onBehalfOfProfileId,
  });
  await prepareCenterAgentWakePublication({
    command: {
      pluginActions: await prepareDelegatedPluginActions({
        env: input.env,
        db: input.db,
        organizationId: input.authorization.activeOrganization.organizationId,
        actorProfileId: input.authorization.actorProfileId,
        parentSubmissionId,
        attribution,
        targetProfileIds: input.targetProfileIds,
        requests: input.pluginActions,
      }),
      evidenceRefs: input.evidenceRefs,
      activationTargets: input.targetProfileIds,
      attribution,
      clientMessageId: input.clientMessageId,
      completionMode: input.completionMode,
      ...(input.replyLanguageTag
        ? { replyLanguageTag: input.replyLanguageTag }
        : {}),
      context: input.authorization.context,
      delegationId: delegation.delegationId,
      fallbackAgentProfileId: input.fallbackAgentProfileId,
      organizationId: input.authorization.activeOrganization.organizationId,
      parentSubmissionId,
      profile: input.profile,
      mentionTargets: input.mentionProfileIds,
      referenceTargets: input.referenceProfileIds,
      spaceAddressingVersion: input.spaceAddressingVersion,
      spaceId: input.spaceId,
      subscriptionIds: delegation.subscriptionIds,
      text: buildDelegatedTaskText(input.text, input.replyLanguageTag),
      v: 1,
    },
    db: input.db,
    nowMs: Date.now(),
  });
  try {
    const publication = await executeCenterAgentWakePublication({
      db: input.db,
      destinationNeutralContinuations:
        shouldWriteDestinationNeutralTaskContinuations(input.env),
      nowMs: Date.now(),
      publicationId: input.clientMessageId,
      publishSignal: async (command) =>
        await rpcPostCenterAgentWakePublicationSignal(input.env, command),
      resolveSignal: async (command) =>
        await rpcResolveCenterAgentWakePublicationSignal(input.env, command),
    });
    return publication.status === "accepted"
      ? {
          attribution: publication.attribution,
          delegation,
          publicationStatus: "accepted",
          signal: publication.signal,
        }
      : {
          attribution: publication.attribution,
          delegation,
          publicationStatus: "pending",
          retryAfterSeconds: publication.retryAfterSeconds,
        };
  } catch (error) {
    if (!(error instanceof CenterAgentDelegationPreparationError)) {
      throw error;
    }
    throw createCoreRpcHttpError({
      code: error.code,
      reason: error.message,
      status:
        error.code === "center_agent.delegation_v1_single_child_required"
          ? 400
          : 409,
    });
  }
}
export async function rpcPostCenterAgentWakePublicationSignal(
  env: CoreBindings,
  command: CenterAgentWakePublicationCommand
): Promise<SignalEnvelope> {
  const parent = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: requireCenterAgentDb(env),
    submissionId: command.parentSubmissionId,
  });
  if (
    !parent ||
    parent.organizationId !== command.organizationId ||
    parent.profileId !== command.attribution.actorProfileId
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.delegation_parent_unavailable",
      reason: "The original Center Agent request is unavailable.",
      status: 409,
    });
  }
  const originalRequest =
    parent.workerSubmitRequest ?? parent.executionRecoverySubmitRequest;
  return await rpcPostSignalOnceByClientMessageId(env, {
    requestTimeContext: originalRequest?.turnEnvelope.requestTimeContext,
    authoringPolicy: "user_authored",
    clientMessageId: command.clientMessageId,
    context: command.context,
    messageEnvelope: {
      activationTargets: command.activationTargets,
      ...(command.mentionTargets.length > 0
        ? { mentionTargets: command.mentionTargets }
        : {}),
      referenceTargets: command.referenceTargets,
      text: command.text,
    },
    meta: {
      clientMessageId: command.clientMessageId,
      ...(command.evidenceRefs ? { evidenceRefs: command.evidenceRefs } : {}),
    },
    profile: command.profile,
    spaceAddressingVersion: command.spaceAddressingVersion,
    spaceId: command.spaceId,
    text: command.text,
  });
}
export async function rpcResolveCenterAgentWakePublicationSignal(
  env: CoreBindings,
  command: CenterAgentWakePublicationCommand
): Promise<Extract<
  SignalEnvelope,
  {
    type: "signal.text";
  }
> | null> {
  const { stub } = resolveRpcSpaceStubOrThrow(env, command.spaceId);
  const resolution = await stub.rpcResolveOrRejectTextSignalByClientMessageId({
    clientMessageId: command.clientMessageId,
    spaceId: command.spaceId,
  });
  return resolution.status === "accepted" ? resolution.signal : null;
}
function buildCenterAgentWakeClientMessageId(input: {
  evidenceRefs?: CenterAgentWakeAgentProfilesInSpaceInput["evidenceRefs"];
  pluginActions?: CenterAgentWakeAgentProfilesInSpaceInput["pluginActions"];
  activationTargets: readonly string[];
  completionMode?: CenterAgentDelegationCompletionMode;
  context: CoreRpcContextInput;
  fallbackAgentProfileId: string | null;
  mentionProfileIds: readonly string[];
  onBehalfOfProfileId: string | null;
  referenceProfileIds: readonly string[];
  spaceAddressingVersion?: typeof OPENMELD_SPACE_ADDRESSING_VERSION;
  spaceId: string;
  text: string;
}): string {
  const actorContext = input.context.actorContext;
  const material = JSON.stringify({
    ...(input.pluginActions ? { pluginActions: input.pluginActions } : {}),
    ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
    actorRequestId: actorContext.requestId ?? null,
    agentControllerConversationId:
      input.context.agentControllerConversationId ?? null,
    completionMode: input.completionMode ?? null,
    fallbackAgentProfileId: input.fallbackAgentProfileId,
    ...(input.mentionProfileIds.length > 0
      ? { mentions: [...input.mentionProfileIds].sort() }
      : {}),
    onBehalfOfProfileId: input.onBehalfOfProfileId,
    profileId: actorContext.openMeldProfileId,
    ...(input.referenceProfileIds.length > 0
      ? { references: [...input.referenceProfileIds].sort() }
      : {}),
    ...(input.spaceAddressingVersion
      ? { spaceAddressingVersion: input.spaceAddressingVersion }
      : {}),
    spaceId: input.spaceId,
    targets: [...input.activationTargets].sort(),
    text: input.text.trim(),
  });
  return `ca-wake:${hashClientMessageIdMaterial(material)}`;
}
export function resolveCenterAgentSpaceAddressingVersion(input: {
  mentionProfileIds?: readonly string[];
  requestedAddressingModel?: "wake_reference_mention";
}): typeof OPENMELD_SPACE_ADDRESSING_VERSION | undefined {
  return input.mentionProfileIds !== undefined ||
    input.requestedAddressingModel === "wake_reference_mention"
    ? OPENMELD_SPACE_ADDRESSING_VERSION
    : undefined;
}
function hashClientMessageIdMaterial(value: string): string {
  let primary = 5381;
  let secondary = 52_711;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    primary = (primary * 33 + code) % 1_000_000_007;
    secondary = (secondary * 131 + code) % 1_000_000_009;
  }
  return `${primary.toString(36)}${secondary.toString(36)}`;
}
function buildCenterAgentTaskWatchId(input: {
  completionCondition: CenterAgentWatchAgentTaskInput["completionCondition"];
  context: CoreRpcContextInput;
  instruction: string;
  taskKey: string;
}): string {
  return `watch:${hashClientMessageIdMaterial(
    JSON.stringify({
      agentControllerConversationId:
        input.context.agentControllerConversationId ?? null,
      completionCondition: input.completionCondition,
      instruction: input.instruction.trim(),
      taskKey: input.taskKey,
    })
  )}`;
}
function assertNeverAgentTask(value: never): never {
  throw new Error(`Unsupported Agent Task Handle: ${String(value)}`);
}
export async function rpcCenterAgentUpdateSpaceSettings(
  env: CoreBindings,
  input: CenterAgentUpdateSpaceSettingsInput
): Promise<CenterAgentUpdateSpaceSettingsResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentUpdateSpaceSettingsBodySchema.safeParse({
    ...(input.accessMode === undefined ? {} : { accessMode: input.accessMode }),
    ...(input.guide === undefined ? {} : { guide: input.guide }),
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    spaceId: input.spaceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent Space settings payload",
      code: "invalid_payload",
    });
  }
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.data.spaceId,
  });
  const accessModeState =
    parsed.data.accessMode === undefined
      ? undefined
      : await rpcSetSpaceAccessMode(env, {
          accessMode: parsed.data.accessMode,
          context: authorization.context,
          ...(parsed.data.password === undefined
            ? {}
            : { password: parsed.data.password }),
          spaceId: parsed.data.spaceId,
        });
  const shouldUpdateMeta =
    parsed.data.purpose !== undefined || parsed.data.guide !== undefined;
  const meta = shouldUpdateMeta
    ? await rpcUpdateSpaceMeta(env, {
        context: authorization.context,
        ...(parsed.data.guide === undefined
          ? {}
          : { guide: parsed.data.guide }),
        ...(parsed.data.purpose === undefined
          ? {}
          : { purpose: parsed.data.purpose }),
        spaceId: parsed.data.spaceId,
      })
    : undefined;
  const attribution = await writeCenterAgentAuditEntry({
    action: "update_space_settings",
    authorization,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    resource: { type: "space", id: parsed.data.spaceId },
  });
  const response: CenterAgentUpdateSpaceSettingsResponse = {
    ...(accessModeState === undefined ? {} : { accessModeState }),
    attribution,
    ...(meta === undefined ? {} : { meta }),
    organizationId: authorization.activeOrganization.organizationId,
    resource: { type: "space", id: parsed.data.spaceId },
    spaceId: parsed.data.spaceId,
  };
  const validated =
    centerAgentUpdateSpaceSettingsResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space settings response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function requireCenterAgentSpaceInActiveOrganization(input: {
  authorization: Awaited<ReturnType<typeof requireRemoteAgentToolCaller>>;
  env: CoreBindings;
  spaceId: string;
}): Promise<void> {
  if (
    "personalExecution" in input.authorization &&
    input.authorization.personalExecution.delivery.spaceId !== input.spaceId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "This Remote Agent tool can only access its current Space.",
      code: "remote_agent.space_mismatch",
    });
  }
  const spaceTarget = await readSpaceIndexOrganizationJoinTarget({
    db: requireSpaceIndexDb(input.env),
    spaceId: input.spaceId,
  });
  if (!spaceTarget) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Space was not found in the active Organization.",
      code: "center_agent.space_not_found",
    });
  }
  if (
    spaceTarget.organizationId ===
    input.authorization.activeOrganization.organizationId
  ) {
    return;
  }
  throw createCoreRpcHttpError({
    status: 403,
    reason: "Space does not belong to the active Organization.",
    code: "center_agent.space_org_mismatch",
  });
}
export async function rpcOpenCenterAgentDirectMessageSpace(
  env: CoreBindings,
  input: OpenCenterAgentDirectMessageSpaceInput
): Promise<OpenCenterAgentDirectMessageSpaceResponse> {
  const context = requireRpcContext(input.context);
  const sessionCreation =
    input.sessionCreationId === undefined
      ? undefined
      : createCenterAgentSessionBodySchema.safeParse({
          creationId: input.sessionCreationId,
        });
  if (sessionCreation && !sessionCreation.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Provide a valid session creation ID.",
    });
  }
  const timing = createCenterAgentDirectMessageOpenTiming({
    env,
    requestId: context.actorContext.requestId,
  });
  let centerAgentProfileId: string | null = null;
  let failure: unknown;
  let opened: {
    created: boolean;
    spaceId: string;
  } | null = null;
  try {
    const activeOrganization = await timing.measure(
      "membership",
      async () =>
        await requireActiveOrganizationMembershipOrThrow({
          context,
          env,
        })
    );
    const db = requireCenterAgentDb(env);
    const designation = await timing.measure(
      "designation",
      async () =>
        await readOrInitializeCenterAgentDesignation({
          activeOrganization,
          db,
          context,
          env,
          required: true,
        })
    );
    if (!designation) {
      throw createCoreRpcHttpError({
        status: 404,
        reason: "This Organization has no designated Center Agent.",
        code: "center_agent.designation_required",
      });
    }
    centerAgentProfileId = designation.agentProfileId;
    const humanMember = timing.measureSync("human_member", () =>
      requireHumanSpaceMemberFromContext({
        context,
        userId: activeOrganization.userId,
      })
    );
    const centerAgentMember = await timing.measure(
      "center_agent_member",
      async () =>
        await readResolvedOrganizationSpaceMember({
          db,
          organizationId: activeOrganization.organizationId,
          profileId: designation.agentProfileId,
        })
    );
    if (!(centerAgentMember && centerAgentMember.profileKind === "agent")) {
      throw createCoreRpcHttpError({
        status: 409,
        reason: "The designated Center Agent profile is not available.",
        code: "center_agent.profile_not_found",
      });
    }
    const legacySpaceId = resolveCenterAgentDirectMessageSpaceId(
      env.OPENMELD_SPACES,
      {
        centerAgentProfileId: designation.agentProfileId,
        memberProfileId: humanMember.profileId,
        organizationId: activeOrganization.organizationId,
      }
    );
    const openedSpace = await timing.measure("direct_message_open", async () =>
      sessionCreation?.success
        ? await createAgentDirectMessageSessionSpace(env, {
            context,
            creationId: sessionCreation.data.creationId,
            member: humanMember,
            organizationId: activeOrganization.organizationId,
            targetMember: centerAgentMember,
          })
        : await openDirectMessageSpaceInternal(env, {
            context,
            member: humanMember,
            legacySpaceId,
            organizationId: activeOrganization.organizationId,
            targetMember: centerAgentMember,
            timing,
          })
    );
    opened = openedSpace;
    const response: OpenCenterAgentDirectMessageSpaceResponse = {
      organizationId: activeOrganization.organizationId,
      centerAgentProfileId: designation.agentProfileId,
      memberProfileId: humanMember.profileId,
      spaceId: openedSpace.spaceId,
      created: openedSpace.created,
    };
    return timing.measureSync("response_validation", () => {
      const validated =
        openCenterAgentDirectMessageSpaceResponseSchema.safeParse(response);
      if (!validated.success) {
        throw new Error(
          `failed to build Center Agent DM Space response: ${validated.error.message}`
        );
      }
      return validated.data;
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    timing.emit({
      centerAgentProfileId,
      ...(opened ? { created: opened.created, spaceId: opened.spaceId } : {}),
      ...(failure === undefined ? {} : { failure }),
    });
  }
}

async function readCurrentMemberCenterAgentDirectMessageSpaceProjection(input: {
  activeOrganization: ActiveOrganization;
  context: CoreRpcContextInput;
  env: CoreBindings;
  spaceId?: string;
}): Promise<CenterAgentDirectMessageSpaceProjection | null> {
  const selector =
    input.spaceId === undefined
      ? undefined
      : centerAgentSessionSelectorSchema.safeParse({ spaceId: input.spaceId });
  if (selector && !selector.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Provide a valid session ID.",
    });
  }
  const designation = await readCenterAgentDesignationRecord({
    db: requireCenterAgentDb(input.env),
    organizationId: input.activeOrganization.organizationId,
  });
  if (!designation) {
    return null;
  }
  const humanMember = requireHumanSpaceMemberFromContext({
    context: input.context,
    userId: input.activeOrganization.userId,
  });
  const pairKey = buildDirectMessagePairKey(
    humanMember.profileId,
    designation.agentProfileId
  );
  const candidate = selector?.success
    ? await readCenterAgentDirectMessageProjectionCandidateBySpaceId({
        db: requireSpaceIndexDb(input.env),
        spaceId: selector.data.spaceId,
      })
    : await readCenterAgentDirectMessageProjectionCandidateByPairKey({
        db: requireSpaceIndexDb(input.env),
        organizationId: input.activeOrganization.organizationId,
        pairKey,
      });
  if (
    !candidate ||
    candidate.organizationId !== input.activeOrganization.organizationId ||
    candidate.directMessagePairKey !== pairKey
  ) {
    return null;
  }
  return deriveCenterAgentDirectMessageSpaceProjection({
    centerAgentProfileId: designation.agentProfileId,
    directMessagePairKey: candidate.directMessagePairKey,
    organizationId: candidate.organizationId,
    spaceId: candidate.spaceId,
    spacePurpose: candidate.spacePurpose,
  });
}
async function readCenterAgentDirectMessageSpaceProjectionBySpaceId(input: {
  env: CoreBindings;
  spaceId: string;
}): Promise<CenterAgentDirectMessageSpaceProjection | null> {
  const candidate =
    await readCenterAgentDirectMessageProjectionCandidateBySpaceId({
      db: requireSpaceIndexDb(input.env),
      spaceId: input.spaceId,
    });
  if (!candidate) {
    return null;
  }
  const designation = await readCenterAgentDesignationRecord({
    db: requireCenterAgentDb(input.env),
    organizationId: candidate.organizationId,
  });
  if (!designation) {
    return null;
  }
  return deriveCenterAgentDirectMessageSpaceProjection({
    centerAgentProfileId: designation.agentProfileId,
    directMessagePairKey: candidate.directMessagePairKey,
    organizationId: candidate.organizationId,
    spaceId: candidate.spaceId,
    spacePurpose: candidate.spacePurpose,
  });
}
async function assertAdditionalMembersCanBeAddedToSpace(input: {
  env: CoreBindings;
  members: readonly ResolvedSpaceMemberProfile[];
  spaceId: string;
}): Promise<void> {
  const projection = await readCenterAgentDirectMessageSpaceProjectionBySpaceId(
    {
      env: input.env,
      spaceId: input.spaceId,
    }
  );
  if (!projection) {
    return;
  }
  const allowedProfileIds = new Set([
    projection.memberProfileId,
    projection.centerAgentProfileId,
  ]);
  const hasAdditionalMember = input.members.some(
    (member) => !allowedProfileIds.has(member.profileId)
  );
  if (!hasAdditionalMember) {
    return;
  }
  throw createCoreRpcHttpError({
    status: 403,
    reason: "Center Agent Direct Messages cannot add additional members.",
    code: "space.forbidden",
  });
}
async function assertCenterAgentDirectMessageMutationAllowed(input: {
  env: CoreBindings;
  reason: string;
  spaceId: string;
}): Promise<void> {
  const projection = await readCenterAgentDirectMessageSpaceProjectionBySpaceId(
    {
      env: input.env,
      spaceId: input.spaceId,
    }
  );
  if (!projection) {
    return;
  }
  throw createCoreRpcHttpError({
    status: 403,
    reason: input.reason,
    code: "space.forbidden",
  });
}
export async function rpcOpenDirectMessageSpace(
  env: CoreBindings,
  input: OpenDirectMessageSpaceInput
): Promise<OpenDirectMessageSpaceResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const db = requireCenterAgentDb(env);
  const member =
    context.actorContext.profileKind === "human"
      ? requireHumanSpaceMemberFromContext({
          context,
          userId: activeOrganization.userId,
        })
      : await readResolvedOrganizationSpaceMember({
          db,
          organizationId: activeOrganization.organizationId,
          profileId: context.actorContext.openMeldProfileId,
        });
  if (
    !member ||
    member.ownerUserId !== activeOrganization.userId ||
    member.profileKind !== context.actorContext.profileKind
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "direct_message.caller_forbidden",
      reason: "Use an active profile owned by your signed-in account.",
    });
  }
  return await openDirectMessageForCaller(
    env,
    { ...input, context },
    member,
    activeOrganization.organizationId
  );
}

/** Native execution identity is verified before entering the shared DM owner. */
export async function rpcRemoteAgentOpenDirectMessageSpace(
  env: CoreBindings,
  input: OpenDirectMessageSpaceInput
): Promise<OpenDirectMessageSpaceResponse> {
  const authorization = await requireRemoteAgentToolCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const member = await readResolvedOrganizationSpaceMember({
    db: authorization.db,
    organizationId: authorization.activeOrganization.organizationId,
    profileId: authorization.actorProfileId,
  });
  if (!member || member.profileKind !== "agent") {
    throw createCoreRpcHttpError({
      status: 403,
      code: "direct_message.caller_forbidden",
      reason: "The calling Agent is no longer available in this organization.",
    });
  }
  return await openDirectMessageForCaller(
    env,
    { ...input, context: authorization.context },
    member,
    authorization.activeOrganization.organizationId
  );
}

export async function rpcRemoteAgentGetOrganizationDirectory(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput }
): Promise<OrganizationDirectoryResponse> {
  const authorization = await requireRemoteAgentToolCaller({
    context: requireRpcContext(input.context),
    env,
  });
  return await rpcGetCurrentOrganizationDirectory(env, {
    context: authorization.context,
  });
}

function validateDirectMessagePublication(
  request: OpenDirectMessageSpaceBody,
  targetMember: ResolvedSpaceMemberProfile
): void {
  if (request.message?.wake && targetMember.profileKind !== "agent") {
    throw createCoreRpcHttpError({
      status: 400,
      code: "direct_message.wake_requires_agent",
      reason: "Only an Agent can be asked to start work.",
    });
  }
  if (request.message?.wake && !request.spaceId) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "direct_message.wake_requires_space",
      reason:
        "Open the Direct Message first, then send work using its spaceId so it can be stopped immediately.",
    });
  }
  if (request.spaceId && (!request.message || request.creationId)) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        "Use spaceId with a message in an existing Direct Message. Open new sessions separately.",
    });
  }
}

async function assertDirectMessageSessionCreationAllowed(input: {
  db: ReturnType<typeof requireCenterAgentDb>;
  member: ResolvedSpaceMemberProfile;
  organizationId: string;
  targetMember: ResolvedSpaceMemberProfile;
}): Promise<void> {
  const { member, targetMember } = input;
  const designation = await readCenterAgentDesignationRecord({
    db: input.db,
    organizationId: input.organizationId,
  });
  const isHumanCenterPair =
    (member.profileKind === "human" &&
      targetMember.profileId === designation?.agentProfileId) ||
    (targetMember.profileKind === "human" &&
      member.profileId === designation?.agentProfileId);
  // MemberAgent program: any Human–Agent pair can hold several Sessions.
  const isHumanAgentPair =
    isMemberAgentsEnabled() &&
    [member.profileKind, targetMember.profileKind].sort().join(":") ===
      "agent:human";
  if (!(isHumanCenterPair || isHumanAgentPair)) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "direct_message.new_session_requires_center",
      reason: isMemberAgentsEnabled()
        ? "New chat sessions are available between a person and an Agent. Other Direct Messages reuse the current conversation."
        : "New chat sessions are available between a person and their Center Agent. Other Direct Messages reuse the current conversation.",
    });
  }
}
async function openDirectMessageForCaller(
  env: CoreBindings,
  input: OpenDirectMessageSpaceInput & { context: CoreRpcContextInput },
  member: ResolvedSpaceMemberProfile,
  organizationId: string
): Promise<OpenDirectMessageSpaceResponse> {
  const parsed = openDirectMessageSpaceBodySchema.safeParse({
    targetProfileId: input.targetProfileId,
    spaceId: input.spaceId,
    creationId: input.creationId,
    message: input.message,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ?? "Invalid Direct Message request.",
    });
  }
  const { context } = input;
  const db = requireCenterAgentDb(env);
  if (parsed.data.targetProfileId === member.profileId) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Choose another profile to start a Direct Message.",
      code: "direct_message.self_not_allowed",
    });
  }
  const targetMember = await readResolvedOrganizationSpaceMember({
    db,
    organizationId,
    profileId: parsed.data.targetProfileId,
  });
  if (!targetMember) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "That profile is not available in this Organization.",
      code: "direct_message.target_not_found",
    });
  }

  validateDirectMessagePublication(parsed.data, targetMember);
  if (parsed.data.creationId) {
    await assertDirectMessageSessionCreationAllowed({
      db,
      member,
      organizationId,
      targetMember,
    });
  }
  const participants = { context, member, organizationId, targetMember };
  let opened: { spaceId: string; created: boolean };
  if (parsed.data.spaceId) {
    opened = { spaceId: parsed.data.spaceId, created: false };
  } else if (parsed.data.creationId) {
    opened = await createAgentDirectMessageSessionSpace(env, {
      ...participants,
      creationId: parsed.data.creationId,
    });
  } else {
    opened = await openDirectMessageSpaceInternal(env, participants);
  }
  const message = parsed.data.message;
  const signal = message
    ? await resolveRpcSpaceStubOrThrow(
        env,
        opened.spaceId
      ).stub.rpcPostDirectMessageSignal({
        spaceId: opened.spaceId,
        organizationId,
        pairKey: buildDirectMessagePairKey(
          member.profileId,
          targetMember.profileId
        ),
        authoringPolicy: "user_authored",
        context,
        profile: buildProfileDisplay({
          agentControllerRef: member.agentControllerRef,
          ownerName: member.ownerName,
          ownerUserId: member.ownerUserId,
          profileId: member.profileId,
          profileKind: member.profileKind,
          profileName: member.profileName,
        }),
        text: message.text,
        clientMessageId: message.clientMessageId,
        meta: { clientMessageId: message.clientMessageId },
        messageEnvelope: {
          text: message.text,
          activationTargets: message.wake ? [targetMember.profileId] : [],
          // A human can explicitly send context without triggering an implicit DM Wake.
          referenceTargets:
            !message.wake && targetMember.profileKind === "agent"
              ? [targetMember.profileId]
              : [],
        },
        spaceAddressingVersion: OPENMELD_SPACE_ADDRESSING_VERSION,
      })
    : undefined;
  const response = {
    organizationId,
    memberProfileId: member.profileId,
    targetProfileId: targetMember.profileId,
    spaceId: opened.spaceId,
    created: opened.created,
    creationId: parsed.data.creationId,
    ...(signal ? { signal } : {}),
  };
  return openDirectMessageSpaceResponseSchema.parse(response);
}
export async function rpcConvertDirectMessageToSpace(
  env: CoreBindings,
  input: ConvertDirectMessageToSpaceInput
): Promise<ConvertDirectMessageToSpaceResponse> {
  const parsed = convertDirectMessageToSpaceBodySchema.safeParse({
    includeMemberSnapshots: input.includeMemberSnapshots,
    name: input.name,
    profileIds: input.profileIds,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Direct Message conversion request.",
      status: 400,
    });
  }
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const { spaceId } = await requireActiveOrganizationSpaceTarget({
    env,
    organizationId: activeOrganization.organizationId,
    spaceId: input.spaceId,
  });
  const db = requireCenterAgentDb(env);
  const members = await Promise.all(
    parsed.data.profileIds.map(async (profileId) => {
      const member = await readResolvedOrganizationSpaceMember({
        db,
        organizationId: activeOrganization.organizationId,
        profileId,
      });
      if (!member) {
        throw createCoreRpcHttpError({
          code: "direct_message.target_not_found",
          reason: "A selected profile is not available in this Organization.",
          status: 404,
        });
      }
      return member;
    })
  );
  const { stub } = resolveRpcSpaceStubOrThrow(env, spaceId);
  const currentMembers = await stub.rpcGetIdentityDirectory({
    context,
    spaceId,
  });
  const currentMemberProfileIds = new Set(
    currentMembers.entries.map((member) => member.profileId)
  );
  if (
    !members.some((member) => !currentMemberProfileIds.has(member.profileId))
  ) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Choose at least one new member.",
      status: 400,
    });
  }
  const currentAgentMembers = await Promise.all(
    currentMembers.entries
      .filter((member) => member.profileKind === "agent")
      .map(async (member) => {
        const resolved = await readResolvedOrganizationSpaceMember({
          db,
          organizationId: activeOrganization.organizationId,
          profileId: member.profileId,
        });
        if (!resolved) {
          throw createCoreRpcHttpError({
            code: "agent_profile.not_found",
            reason: "Agent Profile was not found.",
            status: 404,
          });
        }
        return resolved;
      })
  );
  if (isMemberAgentsEnabled()) {
    // Agents already in the Direct Message were consented to; a new one
    // is asked for like any other addition.
    await rejectNonOwnerPersonalAgentAdditions({
      db,
      members: members.filter(
        (member) => !currentMemberProfileIds.has(member.profileId)
      ),
      organizationId: activeOrganization.organizationId,
      rootUserId: normalizeOptionalText(context.actorContext.ownerUserId),
    });
  }
  const membersWithAgentOwners = await resolveSpaceMembersWithAgentOwners({
    context,
    env,
    expandAgentOwnersInDirectMessageConversion: true,
    members: [...members, ...currentAgentMembers],
    spaceId,
    stub,
  });
  const response = await stub.rpcConvertDirectMessageToSpace({
    context,
    ...(parsed.data.includeMemberSnapshots
      ? { includeMemberSnapshots: true }
      : {}),
    members: membersWithAgentOwners.filter(
      (member) => !currentMemberProfileIds.has(member.profileId)
    ),
    name: parsed.data.name,
    spaceId,
  });
  const validated =
    convertDirectMessageToSpaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Direct Message conversion response: ${validated.error.message}`
    );
  }
  return validated.data;
}
type DirectMessageSpaceOpenInput = {
  context: CoreRpcContextInput;
  member: ResolvedSpaceMemberProfile;
  legacySpaceId?: string;
  organizationId: string;
  targetMember: ResolvedSpaceMemberProfile;
  timing?: CenterAgentDirectMessageOpenTimingRecorder;
};
type OpenedDirectMessageSpace = { created: boolean; spaceId: string };

export function openDirectMessageSpaceInternal(
  env: CoreBindings,
  input: DirectMessageSpaceOpenInput & { initialOnly: true }
): Promise<OpenedDirectMessageSpace | null>;
export function openDirectMessageSpaceInternal(
  env: CoreBindings,
  input: DirectMessageSpaceOpenInput
): Promise<OpenedDirectMessageSpace>;
export async function openDirectMessageSpaceInternal(
  env: CoreBindings,
  input: DirectMessageSpaceOpenInput & { initialOnly?: boolean }
): Promise<OpenedDirectMessageSpace | null> {
  const measureStage = async <T>(
    stage: CenterAgentDirectMessageOpenTimingStage,
    operation: () => Promise<T> | T
  ): Promise<T> =>
    input.timing
      ? await input.timing.measure(stage, operation)
      : await operation();
  const pairKey = buildDirectMessagePairKey(
    input.member.profileId,
    input.targetMember.profileId
  );
  const spaceIndexDb = requireSpaceIndexDb(env);
  const reusableCandidate = await measureStage(
    "reusable_candidate_lookup",
    async () =>
      await readReusableDirectMessageSpaceIndexCandidate({
        db: spaceIndexDb,
        organizationId: input.organizationId,
        pairKey,
      })
  );
  if (reusableCandidate) {
    if (
      !hasCompleteDirectMessageMembership({
        candidate: reusableCandidate,
        member: input.member,
        targetMember: input.targetMember,
      })
    ) {
      await measureStage(
        "members_upsert",
        async () =>
          await addDirectMessageMembers(env, {
            context: input.context,
            member: input.member,
            spaceId: reusableCandidate.spaceId,
            targetMember: input.targetMember,
          })
      );
    }
    return { created: false, spaceId: reusableCandidate.spaceId };
  }
  const guide = buildDirectMessageSpaceGuide({
    firstName: input.member.profileName,
    secondName: input.targetMember.profileName,
  });
  const name = `${input.member.profileName} and ${input.targetMember.profileName}`;

  const legacySpaceId = input.legacySpaceId;
  if (legacySpaceId) {
    const legacyCandidate = await measureStage(
      "legacy_candidate_lookup",
      async () =>
        await readDirectMessageSpaceIndexCandidateBySpaceId({
          db: spaceIndexDb,
          spaceId: legacySpaceId,
        })
    );
    if (
      legacyCandidate &&
      legacyCandidate.organizationId === input.organizationId &&
      isUndegradedDirectMessageCandidate(legacyCandidate)
    ) {
      await measureStage(
        "meta_upsert",
        async () =>
          await initializeDirectMessageSpaceMeta(env, {
            ownerUserId:
              input.member.ownerUserId ?? input.targetMember.ownerUserId,
            context: input.context,
            guide,
            name,
            organizationId: input.organizationId,
            pairKey,
            spaceId: legacyCandidate.spaceId,
          })
      );
      await measureStage(
        "members_upsert",
        async () =>
          await addDirectMessageMembers(env, {
            context: input.context,
            member: input.member,
            spaceId: legacyCandidate.spaceId,
            targetMember: input.targetMember,
          })
      );
      return { created: false, spaceId: legacyCandidate.spaceId };
    }
  }
  const generation = await measureStage(
    "generation_count",
    async () =>
      await countDirectMessageSpacesForPair({
        db: spaceIndexDb,
        organizationId: input.organizationId,
        pairKey,
      })
  );
  // Automatic setup may finish its original chat, but a deleted or converted
  // chat records a deliberate user choice. Only an explicit open creates the
  // next generation. The index retains both deletion and conversion history.
  if (input.initialOnly && generation > 0) {
    return null;
  }
  const spaceId = resolveDirectMessageSpaceId(env.OPENMELD_SPACES, {
    generation,
    organizationId: input.organizationId,
    pairKey,
  });
  const initialized = await measureStage(
    "meta_upsert",
    async () =>
      await initializeDirectMessageSpaceMeta(env, {
        ownerUserId: input.member.ownerUserId ?? input.targetMember.ownerUserId,
        context: input.context,
        guide,
        name,
        organizationId: input.organizationId,
        pairKey,
        spaceId,
      })
  );
  await measureStage(
    "members_upsert",
    async () =>
      await addDirectMessageMembers(env, {
        context: input.context,
        member: input.member,
        spaceId,
        targetMember: input.targetMember,
      })
  );
  return { created: initialized.created, spaceId };
}
async function createAgentDirectMessageSessionSpace(
  env: CoreBindings,
  input: {
    context: CoreRpcContextInput;
    creationId: string;
    member: ResolvedSpaceMemberProfile;
    organizationId: string;
    targetMember: ResolvedSpaceMemberProfile;
  }
): Promise<{
  created: boolean;
  spaceId: string;
}> {
  const pairKey = buildDirectMessagePairKey(
    input.member.profileId,
    input.targetMember.profileId
  );
  // The namespace predates agent Sessions; keeping it keeps every existing
  // Center Agent creation ID resolving to the same Space.
  const spaceId = resolveNamedSpaceId(
    env.OPENMELD_SPACES,
    JSON.stringify([
      "center-agent-session-v1",
      input.organizationId,
      pairKey,
      input.creationId,
    ])
  ).toString();
  const initialized = await initializeDirectMessageSpaceMeta(env, {
    ownerUserId: input.member.ownerUserId ?? input.targetMember.ownerUserId,
    context: input.context,
    guide: buildDirectMessageSpaceGuide({
      firstName: input.member.profileName,
      secondName: input.targetMember.profileName,
    }),
    name: "New chat",
    organizationId: input.organizationId,
    pairKey,
    spaceId,
  });
  await addDirectMessageMembers(env, {
    context: input.context,
    member: input.member,
    spaceId,
    targetMember: input.targetMember,
  });
  return { created: initialized.created, spaceId };
}
function hasCompleteDirectMessageMembership(input: {
  member: ResolvedSpaceMemberProfile;
  candidate: {
    activeAgentCount: number | null;
    activeHumanCount: number | null;
    activeMemberCount: number | null;
  };
  targetMember: ResolvedSpaceMemberProfile;
}): boolean {
  const expectedAgentCount = [input.member, input.targetMember].filter(
    (member) => member.profileKind === "agent"
  ).length;
  const expectedHumanCount = 2 - expectedAgentCount;
  return (
    input.candidate.activeMemberCount === 2 &&
    input.candidate.activeAgentCount === expectedAgentCount &&
    input.candidate.activeHumanCount === expectedHumanCount
  );
}
function isUndegradedDirectMessageCandidate(input: {
  activeMemberCount: number | null;
}): boolean {
  return (
    typeof input.activeMemberCount === "number" && input.activeMemberCount <= 2
  );
}
async function initializeDirectMessageSpaceMeta(
  env: CoreBindings,
  input: {
    context: CoreRpcContextInput;
    ownerUserId: string | null;
    guide: string;
    name: string;
    organizationId: string;
    pairKey: string;
    spaceId: string;
  }
): Promise<{
  created: boolean;
  meta: SpaceMeta;
}> {
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcInitializeDirectMessageMeta({
    spaceId: input.spaceId,
    name: input.name,
    purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
    pairKey: input.pairKey,
    creator: toSpaceCreator(input.context),
    ownerUserIds: input.ownerUserId ? [input.ownerUserId] : [],
    guide: input.guide,
    organizationId: input.organizationId,
    visibility: "private",
  });
}
async function addDirectMessageMembers(
  env: CoreBindings,
  input: {
    context: CoreRpcContextInput;
    member: ResolvedSpaceMemberProfile;
    spaceId: string;
    targetMember: ResolvedSpaceMemberProfile;
  }
): Promise<void> {
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await stub.rpcPostMembers({
    spaceId: input.spaceId,
    members: [input.member, input.targetMember],
    context: input.context,
  });
}
function buildDirectMessageSpaceGuide(input: {
  firstName: string;
  secondName: string;
}): string {
  return `This Space was created as a direct message between ${input.firstName} and ${input.secondName}. Direct Message status is derived from its origin and current active membership.`;
}
export async function rpcGetAgentExecutionReadiness(
  env: CoreBindings,
  input: GetAgentExecutionReadinessInput
): Promise<GetAgentExecutionReadinessResponse> {
  const request = requireAgentExecutionReadinessRequest(input);
  await assertAgentProfileOwnerMatchesRequest({
    agentProfileId: request.agentProfileId,
    env,
    owner: request.owner,
  });
  const generatedAt = new Date().toISOString();
  const readiness = await resolveCoreAgentExecutionReadinessForProfile({
    activeOrganizationId: normalizeOptionalText(
      request.context.activeOrganizationId
    ),
    env,
    generatedAt,
    profileId: request.agentProfileId,
  });
  return buildGetAgentExecutionReadinessResponse({
    generatedAt,
    readiness,
    responseVersion: request.responseVersion,
  });
}
export async function rpcGetAgentExecutionReadinessBatch(
  env: CoreBindings,
  input: GetAgentExecutionReadinessBatchInput
): Promise<GetAgentExecutionReadinessBatchResponse> {
  const request = requireAgentExecutionReadinessBatchRequest(input);
  const reads = createAgentExecutionReadinessReads({
    profileFacts: await readAuthProfileFacts({
      authWorker: env.OPENMELD_AUTH_WORKER,
      profileIds: request.agentProfileIds,
    }),
  });
  await Promise.all(
    request.agentProfileIds.map((agentProfileId) =>
      assertAgentProfileOwnerMatchesRequest({
        agentProfileId,
        env,
        owner: request.owner,
        reads,
      })
    )
  );
  const generatedAt = new Date().toISOString();
  const db = getPostgresDatabase(env);
  if (db) {
    await reads.preloadPrimaryBindings({
      db,
      nowMs: Date.parse(generatedAt),
      owner: request.owner,
      profileIds: request.agentProfileIds,
    });
  }
  const targetRuntime = await resolveAgentExecutionTargetRuntimeContext({
    env,
    owner: request.owner,
    targetRuntime: request.targetRuntime ?? null,
  });
  // One RuntimeTransport round trip for the whole batch instead of one per profile.
  // Invalid batch responses retain the per-profile fallback; exhausted
  // transport failures propagate without another read per Profile.
  const preloadedRoutes = await lookupRuntimeTransportRoutesBatch({
    blockForgottenDevices: true,
    env,
    ownerUserId: request.owner.id,
    profileIds: request.agentProfileIds,
    requestId: request.context.actorContext.requestId,
  });
  const preloadedOwnerService = await lookupRuntimeTransportOwnerService({
    blockForgottenDevices: true,
    env,
    ownerUserId: request.owner.id,
    requestId: request.context.actorContext.requestId,
  }).catch(() => null);
  const readinessItems = await mapWithConcurrency(
    request.agentProfileIds,
    ORGANIZATION_AGENT_RUNTIME_PROFILE_CONCURRENCY,
    (profileId) =>
      resolveCoreAgentExecutionReadinessForProfile({
        reads,
        preloadedOwnerService,
        activeOrganizationId: normalizeOptionalText(
          request.context.activeOrganizationId
        ),
        env,
        generatedAt,
        ...(preloadedRoutes?.routes[profileId] === undefined
          ? {}
          : { preloadedDaemonRoute: preloadedRoutes.routes[profileId] }),
        profileId,
        targetRuntime,
      })
  );
  return buildGetAgentExecutionReadinessBatchResponse({
    generatedAt,
    readinessItems,
    responseVersion: request.responseVersion,
  });
}
export async function rpcEnsureAgentProfilePrimaryBinding(
  env: CoreBindings,
  input: EnsureAgentProfilePrimaryBindingInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const body = ensureAgentProfilePrimaryBindingBodySchema.safeParse({
    sharedConversationAcknowledged: input.sharedConversationAcknowledged,
    agentControllerRef: input.agentControllerRef,
    agentControllerCollaborationMode: input.agentControllerCollaborationMode,
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    deviceId: input.deviceId,
    lane: input.lane,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    modelId: input.modelId,
    openCodePermission: input.openCodePermission,
    reasoningLevel: input.reasoningLevel,
    sessionInventorySelection: input.sessionInventorySelection,
    writeMode: input.writeMode,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Agent Profile Binding payload",
      code: "invalid_payload",
    });
  }
  const runtimeLookupInput = createRuntimeLookupInput({
    deviceId: body.data.deviceId,
    lane: body.data.lane,
    owner: request.owner,
  });
  const openMeldServiceRuntimeId =
    resolveSubmittedAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: body.data.openMeldServiceRuntimeId,
      runtimeLookupInput,
    });
  if (!openMeldServiceRuntimeId.ok) {
    return buildRejectedAgentProfileBindingResponse([
      "agent_profile_binding.agent_controller_report_invalid",
    ]);
  }
  if (
    body.data.sessionInventorySelection &&
    !(await canResumeAgentActivitySessionSelection({
      activeOrganizationId: normalizeOptionalText(
        request.context.activeOrganizationId
      ),
      agentControllerRef: body.data.agentControllerRef,
      agentProfileId: request.agentProfileId,
      db,
      deviceId: body.data.deviceId,
      nowMs: Date.now(),
      ownerUserId: request.owner.id,
      selection: body.data.sessionInventorySelection,
    }))
  ) {
    return buildRejectedAgentProfileBindingResponse([
      "agent_profile_binding.session_resume_unavailable",
    ]);
  }
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  const bindingMutationContext: {
    previousBindingId: string | null;
  } = {
    previousBindingId: null,
  };
  let controllerMutationOperationId: string | null = null;
  try {
    let result: AgentProfileBindingCommandResult;
    try {
      const bindingStore = createPostgresAgentProfileBindingCommandStore({
        acquireExecutionTargetMutationAdmission: async ({ currentBinding }) => {
          bindingMutationContext.previousBindingId =
            currentBinding?.bindingId ?? null;
          if (controllerMutationOperationId) {
            return;
          }
          const controllerMutationAdmission =
            await acquireAgentProfileExecutionTargetMutationAdmission({
              agentProfileId: request.agentProfileId,
              env,
              ownerUserId: request.owner.id,
            });
          if (controllerMutationAdmission.status !== "acquired") {
            throw new AgentProfileExecutionTargetMutationAdmissionError(
              resolveControllerChangeAdmissionReasonCode(
                controllerMutationAdmission
              )
            );
          }
          controllerMutationOperationId =
            controllerMutationAdmission.operationId;
          if (body.data.agentControllerConversationId) {
            const mode = await resolveRuntimeTransportOwnerShard(
              env,
              request.owner.id
            ).rpcAgentProfileExecutionMode({
              ownerUserId: request.owner.id,
              targetProfileId: request.agentProfileId,
            });
            if (mode.migration !== "legacy") {
              throw new AgentProfileExecutionTargetMutationAdmissionError(
                "execution_context.legacy_association_frozen"
              );
            }
          }
        },
        db,
        ...(body.data.sessionInventorySelection
          ? {
              sessionInventoryEligibility: {
                activeOrganizationId: normalizeOptionalText(
                  request.context.activeOrganizationId
                ),
                agentControllerRef: body.data.agentControllerRef,
                agentProfileId: request.agentProfileId,
                deviceId: body.data.deviceId,
                ownerUserId: request.owner.id,
                selection: body.data.sessionInventorySelection,
              },
            }
          : {}),
      });
      result = await ensurePrimaryAgentProfileBinding({
        agentProfileId: request.agentProfileId,
        localComponentsManifest: (
          await readCoreLocalComponentsRelease(env.OPENMELD_CLI_RELEASES)
        ).manifest,
        bindingStore: {
          ...bindingStore,
          readPrimaryBinding: async (readInput) => {
            const currentBinding =
              await bindingStore.readPrimaryBinding(readInput);
            bindingMutationContext.previousBindingId =
              currentBinding?.bindingId ?? null;
            return currentBinding;
          },
        },
        agentControllerConversationId: body.data.agentControllerConversationId,
        agentControllerRef: body.data.agentControllerRef,
        createdByProfileId: request.context.actorContext.openMeldProfileId,
        agentControllerCollaborationMode:
          body.data.agentControllerCollaborationMode,
        agentControllerPermissionMode: body.data.agentControllerPermissionMode,
        modelId: body.data.modelId,
        nowMs: Date.now(),
        openCodePermission: body.data.openCodePermission,
        ownerAuthorization: {
          owner: request.owner,
          status: "allowed",
        },
        profileOwnerValidation,
        reasoningLevel: body.data.reasoningLevel,
        runtimeAgentControllerReportStore: {
          readCurrentReport: async (reportInput) =>
            await readCurrentRuntimeAgentControllerReport({
              agentControllerRef: reportInput.agentControllerRef,
              db,
              openMeldServiceRuntimeId: reportInput.openMeldServiceRuntimeId,
            }),
        },
        openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
        runtimeLookupInput,
        runtimeLookupStore: {
          readRuntimeRecord: async (lookupInput) =>
            await readRuntimeRegistryRecord({
              db,
              runtimeLookupInput: lookupInput.runtimeLookupInput,
            }),
        },
        writeMode: body.data.writeMode,
      });
    } catch (error) {
      if (error instanceof AgentProfileExecutionTargetMutationAdmissionError) {
        return buildRejectedAgentProfileBindingResponse([error.reasonCode]);
      }
      throwAgentProfileBindingCommandHttpError(error);
    }
    if (result.status === "rejected") {
      return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
    }
    const lookupResult = await lookupPrimaryAgentProfileBinding({
      agentProfileId: request.agentProfileId,
      owner: request.owner,
      store: createPostgresAgentProfileBindingLookupStore({ db }),
    });
    await notifyRuntimeTransportRouteCatalogChanged({
      affectedProfileIds: [request.agentProfileId],
      env,
      ownerUserId: request.owner.id,
      reason: "agent_profile_binding_changed",
    }).catch((error) => {
      console.warn("[core.agent_profile_binding.route_catalog_notify_failed]", {
        event: "core.agent_profile_binding.route_catalog_notify_failed",
        agentProfileId: request.agentProfileId,
        ownerUserId: request.owner.id,
        error: toErrorMessage(error),
      });
    });
    await assignBoundProfileToMemberAgent(env, {
      agentProfileId: request.agentProfileId,
      db,
      ownerUserId: request.owner.id,
    });
    return buildAcceptedAgentProfileBindingResponse({
      binding: mapAgentProfileBindingLookupResultToProjection(lookupResult),
      result,
    });
  } finally {
    if (controllerMutationOperationId) {
      await releaseAgentProfileExecutionTargetMutationAdmission({
        agentProfileId: request.agentProfileId,
        env,
        operationId: controllerMutationOperationId,
        ownerUserId: request.owner.id,
      });
    }
  }
}
export async function rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
  env: CoreBindings,
  input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const body =
    updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema.safeParse(
      {
        agentControllerPermissionMode: input.agentControllerPermissionMode,
      }
    );
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Agent Profile Binding Agent Controller Permission Mode payload",
      code: "invalid_payload",
    });
  }
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  let result: AgentProfileBindingCommandResult;
  try {
    result = await withAgentProfileExecutionTargetMutationAdmission({
      agentProfileId: request.agentProfileId,
      env,
      mutate: async () =>
        await updatePrimaryAgentProfileBindingAgentControllerPermissionMode({
          agentProfileId: request.agentProfileId,
          localComponentsManifest: (
            await readCoreLocalComponentsRelease(env.OPENMELD_CLI_RELEASES)
          ).manifest,
          agentControllerPermissionMode:
            body.data.agentControllerPermissionMode,
          bindingStore: createPostgresAgentProfileBindingCommandStore({ db }),
          nowMs: Date.now(),
          ownerAuthorization: {
            owner: request.owner,
            status: "allowed",
          },
          profileOwnerValidation,
        }),
      ownerUserId: request.owner.id,
    });
  } catch (error) {
    if (error instanceof AgentProfileExecutionTargetMutationAdmissionError) {
      return buildRejectedAgentProfileBindingResponse([error.reasonCode]);
    }
    throwAgentProfileBindingCommandHttpError(error);
  }
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }
  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createPostgresAgentProfileBindingLookupStore({ db }),
  });
  await notifyRuntimeTransportRouteCatalogChanged({
    affectedProfileIds: [request.agentProfileId],
    env,
    ownerUserId: request.owner.id,
    reason: "agent_profile_binding_changed",
  }).catch((error) => {
    console.warn("[core.agent_profile_binding.route_catalog_notify_failed]", {
      event: "core.agent_profile_binding.route_catalog_notify_failed",
      agentProfileId: request.agentProfileId,
      ownerUserId: request.owner.id,
      error: toErrorMessage(error),
    });
  });
  return buildAcceptedAgentProfileBindingResponse({
    binding: mapAgentProfileBindingLookupResultToProjection(lookupResult),
    result,
  });
}
export async function rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
  env: CoreBindings,
  input: UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const body =
    updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema.safeParse(
      {
        agentControllerCollaborationMode:
          input.agentControllerCollaborationMode,
      }
    );
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Agent Profile Binding Agent Controller Collaboration Mode payload",
      code: "invalid_payload",
    });
  }
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  let result: AgentProfileBindingCommandResult;
  try {
    result = await withAgentProfileExecutionTargetMutationAdmission({
      agentProfileId: request.agentProfileId,
      env,
      mutate: async () =>
        await updatePrimaryAgentProfileBindingAgentControllerCollaborationMode({
          agentProfileId: request.agentProfileId,
          agentControllerCollaborationMode:
            body.data.agentControllerCollaborationMode,
          bindingStore: createPostgresAgentProfileBindingCommandStore({ db }),
          nowMs: Date.now(),
          ownerAuthorization: {
            owner: request.owner,
            status: "allowed",
          },
          profileOwnerValidation,
        }),
      ownerUserId: request.owner.id,
    });
  } catch (error) {
    if (error instanceof AgentProfileExecutionTargetMutationAdmissionError) {
      return buildRejectedAgentProfileBindingResponse([error.reasonCode]);
    }
    throwAgentProfileBindingCommandHttpError(error);
  }
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }
  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createPostgresAgentProfileBindingLookupStore({ db }),
  });
  await notifyRuntimeTransportRouteCatalogChanged({
    affectedProfileIds: [request.agentProfileId],
    env,
    ownerUserId: request.owner.id,
    reason: "agent_profile_binding_changed",
  }).catch((error) => {
    console.warn("[core.agent_profile_binding.route_catalog_notify_failed]", {
      event: "core.agent_profile_binding.route_catalog_notify_failed",
      agentProfileId: request.agentProfileId,
      ownerUserId: request.owner.id,
      error: toErrorMessage(error),
    });
  });
  return buildAcceptedAgentProfileBindingResponse({
    binding: mapAgentProfileBindingLookupResultToProjection(lookupResult),
    result,
  });
}
export async function rpcUpdateAgentProfilePrimaryBindingModelSelection(
  env: CoreBindings,
  input: UpdateAgentProfilePrimaryBindingModelSelectionInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const body =
    updateAgentProfilePrimaryBindingModelSelectionBodySchema.safeParse({
      modelId: input.modelId,
      reasoningLevel: input.reasoningLevel,
    });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Agent Profile Binding model selection payload",
      code: "invalid_payload",
    });
  }
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  let result: AgentProfileBindingCommandResult;
  try {
    result = await withAgentProfileExecutionTargetMutationAdmission({
      agentProfileId: request.agentProfileId,
      env,
      mutate: async () =>
        await updatePrimaryAgentProfileBindingModelSelection({
          runtimeAgentControllerReportStore: {
            readCurrentReport: async (reportInput) =>
              await readCurrentRuntimeAgentControllerReport({
                ...reportInput,
                db,
              }),
          },
          agentProfileId: request.agentProfileId,
          bindingStore: createPostgresAgentProfileBindingCommandStore({ db }),
          modelId: body.data.modelId,
          nowMs: Date.now(),
          ownerAuthorization: {
            owner: request.owner,
            status: "allowed",
          },
          profileOwnerValidation,
          reasoningLevel: body.data.reasoningLevel,
        }),
      ownerUserId: request.owner.id,
    });
  } catch (error) {
    if (error instanceof AgentProfileExecutionTargetMutationAdmissionError) {
      return buildRejectedAgentProfileBindingResponse([error.reasonCode]);
    }
    throwAgentProfileBindingCommandHttpError(error);
  }
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }
  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createPostgresAgentProfileBindingLookupStore({ db }),
  });
  await notifyRuntimeTransportRouteCatalogChanged({
    affectedProfileIds: [request.agentProfileId],
    env,
    ownerUserId: request.owner.id,
    reason: "agent_profile_binding_changed",
  }).catch((error) => {
    console.warn("[core.agent_profile_binding.route_catalog_notify_failed]", {
      event: "core.agent_profile_binding.route_catalog_notify_failed",
      agentProfileId: request.agentProfileId,
      ownerUserId: request.owner.id,
      error: toErrorMessage(error),
    });
  });
  await reconcileAgentModelInbox({
    env,
    ownerUserId: request.owner.id,
    agentProfileId: request.agentProfileId,
    nowMs: Date.now(),
  }).catch((error) =>
    console.warn("[core.model_inbox.reconcile_failed]", { error })
  );
  return buildAcceptedAgentProfileBindingResponse({
    binding: mapAgentProfileBindingLookupResultToProjection(lookupResult),
    result,
  });
}
export async function rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(
  env: CoreBindings,
  input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const { db, request } = await requireAgentProfileWorkspaceScope(env, input);
  const body =
    updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema.safeParse({
      openCodePermission: input.openCodePermission,
    });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Agent Profile Binding OpenCode permissions payload",
      code: "invalid_payload",
    });
  }
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  let result: AgentProfileBindingCommandResult;
  try {
    result = await withAgentProfileExecutionTargetMutationAdmission({
      agentProfileId: request.agentProfileId,
      env,
      mutate: async () =>
        await updatePrimaryAgentProfileBindingOpenCodePermission({
          agentProfileId: request.agentProfileId,
          bindingStore: createPostgresAgentProfileBindingCommandStore({ db }),
          nowMs: Date.now(),
          openCodePermission: body.data.openCodePermission,
          ownerAuthorization: {
            owner: request.owner,
            status: "allowed",
          },
          profileOwnerValidation,
        }),
      ownerUserId: request.owner.id,
    });
  } catch (error) {
    if (error instanceof AgentProfileExecutionTargetMutationAdmissionError) {
      return buildRejectedAgentProfileBindingResponse([error.reasonCode]);
    }
    throwAgentProfileBindingCommandHttpError(error);
  }
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }
  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createPostgresAgentProfileBindingLookupStore({ db }),
  });
  await notifyRuntimeTransportRouteCatalogChanged({
    affectedProfileIds: [request.agentProfileId],
    env,
    ownerUserId: request.owner.id,
    reason: "agent_profile_binding_changed",
  }).catch((error) => {
    console.warn("[core.agent_profile_binding.route_catalog_notify_failed]", {
      event: "core.agent_profile_binding.route_catalog_notify_failed",
      agentProfileId: request.agentProfileId,
      ownerUserId: request.owner.id,
      error: toErrorMessage(error),
    });
  });
  return buildAcceptedAgentProfileBindingResponse({
    binding: mapAgentProfileBindingLookupResultToProjection(lookupResult),
    result,
  });
}
export async function rpcNotifyAgentProfileRouteCatalogChanged(
  env: CoreBindings,
  input: NotifyAgentProfileRouteCatalogChangedInput
): Promise<NotifyAgentProfileRouteCatalogChangedResponse> {
  const request = requireAgentProfileBindingRequest(input);
  const parsedBody = notifyAgentProfileRouteCatalogChangedBodySchema.safeParse({
    reason: input.reason,
  });
  if (!parsedBody.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsedBody.error.issues[0]?.message ??
        "invalid Agent Profile route catalog notification payload",
      code: "invalid_payload",
    });
  }
  const result = await notifyRuntimeTransportRouteCatalogChanged({
    affectedProfileIds: [request.agentProfileId],
    env,
    ownerUserId: request.owner.id,
    reason: parsedBody.data.reason ?? "agent_profile_binding_changed",
  });
  const validated =
    notifyAgentProfileRouteCatalogChangedResponseSchema.safeParse(result);
  if (!validated.success) {
    return {
      ok: false,
      notifiedSessions: 0,
    };
  }
  return validated.data;
}
export async function rpcNotifyAgentProfilesRouteCatalogChanged(
  env: CoreBindings,
  input: NotifyAgentProfilesRouteCatalogChangedInput
): Promise<NotifyAgentProfileRouteCatalogChangedResponse> {
  const context = requireRpcContext(input.context);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  const parsedBody = notifyAgentProfilesRouteCatalogChangedBodySchema.safeParse(
    {
      agentProfileIds: input.agentProfileIds,
      reason: input.reason,
    }
  );
  if (!parsedBody.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsedBody.error.issues[0]?.message ??
        "invalid Agent Profile route catalog notification payload",
      code: "invalid_payload",
    });
  }
  const result = await notifyRuntimeTransportRouteCatalogChanged({
    affectedProfileIds: parsedBody.data.agentProfileIds,
    env,
    ownerUserId,
    reason: parsedBody.data.reason ?? "agent_profile_binding_changed",
  });
  const validated =
    notifyAgentProfileRouteCatalogChangedResponseSchema.safeParse(result);
  if (!validated.success) {
    return {
      ok: false,
      notifiedSessions: 0,
    };
  }
  return validated.data;
}
export async function rpcWriteCurrentDeviceObservedMetadata(
  env: CoreBindings,
  input: WriteCurrentDeviceObservedMetadataInput
): Promise<WriteCurrentDeviceObservedMetadataResponse> {
  const request = requireStartRequest(
    input.context,
    input.deviceId,
    forgetComputerRouteParamsSchema
  );
  const parsed = writeCurrentDeviceObservedMetadataBodySchema.safeParse({
    metadata: input.metadata,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid current device observed metadata payload",
      code: "invalid_payload",
    });
  }
  return await writeCurrentDeviceObservedMetadataUseCase({
    store: buildCurrentDeviceTargetStore(env),
    userId: request.userId,
    deviceId: request.deviceId,
    metadata: parsed.data.metadata,
  });
}
export async function rpcFirstWork(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput } & (
    | import("@openmeld/schemas").FirstWorkAction
    | { action?: undefined }
  )
) {
  const context = requireRpcContext(input.context);
  const scope = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const human = requireHumanSpaceMemberFromContext({
    context,
    userId: scope.userId,
  });
  const db = requireCenterAgentDb(env);
  let record = await readFirstWork(db, scope);
  if (input.action === "start") {
    // The same bootstrap owner used by Center Agent conversations. Fresh
    // organizations must have a real candidate before opening the picker.
    await readOrInitializeCenterAgentDesignation({
      activeOrganization: scope,
      context,
      db,
      env,
      required: true,
    });
    record = await reserveFirstWork(db, {
      ...scope,
      profileId: human.profileId,
      spaceId: resolveNewSpaceId(env.OPENMELD_SPACES).toString(),
      runId: input.runId,
      previousRunId: input.previousRunId,
    });
  }
  if (input.action === "progress" && record?.runId === input.runId) {
    record = await updateFirstWork(db, { ...scope, ...input });
  }
  if (input.action === "create") {
    if (
      !record ||
      record.runId !== input.runId ||
      record.profileId !== human.profileId
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        code: "onboarding.run_changed",
        reason: "The tutorial changed in another tab. Open Help to continue.",
      });
    }
    // Same Space owner and authorization as ordinary creation. The reserved ID
    // makes retries safe if the create response is lost. Never add members here.
    await createSpaceWithResolvedId(env, {
      ...input.space,
      context,
      organizationId: scope.organizationId,
      spaceId: record.spaceId,
      name: input.space.name,
      visibility: input.space.visibility ?? "private",
      accessMode: input.space.accessMode ?? "members_only",
    });
    if (record.step === "create-space") {
      record = await updateFirstWork(db, {
        ...scope,
        runId: record.runId,
        revision: record.revision,
        step: "add-center-agent",
        paused: false,
      });
    }
  }
  // This association never grants Space access. SpaceEntryGate and every
  // ordinary Space request still enforce current membership and access.
  return firstWorkResponseSchema.parse({
    record: await readFirstWork(db, scope),
    hasStartedTutorial: await hasStartedTutorial(db, scope.userId),
  });
}

export async function rpcCreateSpace(
  env: CoreBindings,
  input?: CreateSpaceInput
): Promise<CreateSpaceResult> {
  const context = requireRpcContext(input?.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  assertValidCreateSpaceInput(input);
  const normalizedName = normalizeCreateSpaceName(input?.name);
  const normalizedPurpose = normalizeCreateSpacePurpose(input);
  const normalizedGuide = normalizeCreateSpaceGuide(input);
  const accessMode = normalizeCreateSpaceAccessMode(input);
  const visibility = normalizeCreateSpaceVisibility(input);
  const password = normalizeCreateSpacePassword(input);
  validateCreateSpaceAccessModePasswordContract({ accessMode, password });
  return await createSpaceWithResolvedId(env, {
    spaceId: resolveNewSpaceId(env.OPENMELD_SPACES).toString(),
    ...(normalizedName === undefined ? {} : { name: normalizedName }),
    ...(typeof normalizedPurpose === "string"
      ? { purpose: normalizedPurpose }
      : {}),
    ...(typeof normalizedGuide === "string" ? { guide: normalizedGuide } : {}),
    ...(accessMode === undefined ? {} : { accessMode }),
    organizationId: activeOrganization.organizationId,
    ...(password === undefined ? {} : { password }),
    visibility,
    context,
  });
}
export async function rpcListSignals(
  env: CoreBindings,
  input: ListSignalsInput
): Promise<ListSignalsResult> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const fromProfileIds = normalizeStringArray(input.fromProfileIds);
  const signalTypes = normalizeStringArray(input.signalTypes);
  const cursor = normalizeOptionalText(input.cursor);
  const afterSignalId = normalizeOptionalText(input.afterSignalId);
  const aroundSignalId = normalizeOptionalText(input.aroundSignalId);
  return unwrapSpaceRpcJsonResult(
    await stub.rpcListSignalsResult({
      spaceId,
      ...(input.messageRead ? { messageRead: input.messageRead } : {}),
      ...(input.q ? { q: input.q } : {}),
      ...buildListSignalsNumberFilters(input),
      ...(cursor ? { cursor } : {}),
      ...(input.recent === true ? { recent: true } : {}),
      ...(afterSignalId ? { afterSignalId } : {}),
      ...(aroundSignalId ? { aroundSignalId } : {}),
      ...(fromProfileIds.length > 0 ? { fromProfileIds } : {}),
      ...buildListSignalsTypeFilter(signalTypes),
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    })
  );
}
function buildListSignalsNumberFilters(input: ListSignalsInput): {
  afterCount?: number;
  afterTs?: number;
  beforeCount?: number;
  limit?: number;
} {
  return {
    ...normalizeNonNegativeIntegerField("afterTs", input.afterTs),
    ...normalizeNonNegativeIntegerField("limit", input.limit),
    ...normalizeNonNegativeIntegerField("beforeCount", input.beforeCount),
    ...normalizeNonNegativeIntegerField("afterCount", input.afterCount),
  };
}
function normalizeNonNegativeIntegerField<K extends string>(
  key: K,
  value: unknown
): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value)
    ? ({ [key]: Math.max(0, Math.trunc(value)) } as Partial<Record<K, number>>)
    : {};
}
function buildListSignalsTypeFilter(signalTypes: string[]): {
  signalTypes?: readonly (
    | "signal.text"
    | "signal.status"
    | "signal.system_notice"
  )[];
} {
  return signalTypes.length > 0
    ? {
        signalTypes: signalTypes as readonly (
          | "signal.text"
          | "signal.status"
          | "signal.system_notice"
        )[],
      }
    : {};
}
export async function rpcPostSignal(
  env: CoreBindings,
  input: PostSignalInput
): Promise<SignalEnvelope> {
  const context = requireWritableRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const text = String(input.text ?? "");
  const normalizedText = text.trim();
  if (normalizedText.length === 0 && (input.files?.length ?? 0) === 0) {
    throw new Error("A message must include text or at least one file");
  }
  const attachments = await resolvePostSignalAttachments(env, {
    attachments: input.attachments,
    context,
    spaceId,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
  const postInput = {
    ...(input.agentStreamId === undefined
      ? {}
      : { agentStreamId: input.agentStreamId }),
    spaceId,
    profile: input.profile,
    text: normalizedText,
    ...(input.deviceWait ? { deviceWait: input.deviceWait } : {}),
    ...(input.contextSelection
      ? { contextSelection: input.contextSelection }
      : {}),
    contextSelections: input.contextSelections,
    taskDraft: input.taskDraft,
    authoringPolicy: input.authoringPolicy,
    ...(attachments ? { attachments } : {}),
    ...(input.files ? { files: input.files } : {}),
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(password === undefined ? {} : { password }),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    ...(input.spaceAddressingVersion
      ? { spaceAddressingVersion: input.spaceAddressingVersion }
      : {}),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  };
  const clientMessageId = input.meta?.clientMessageId;
  if (input.authoringPolicy === "user_authored" && clientMessageId) {
    return await stub.rpcPostSignalOnceByClientMessageId({
      ...postInput,
      clientMessageId,
    });
  }
  return await stub.rpcPostSignal(postInput);
}
export async function rpcPostSignalOnceByClientMessageId(
  env: CoreBindings,
  input: PostSignalOnceByClientMessageIdInput
): Promise<SignalEnvelope> {
  const context = requireWritableRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const text = String(input.text ?? "");
  const normalizedText = text.trim();
  if (normalizedText.length === 0 && (input.files?.length ?? 0) === 0) {
    throw new Error("A message must include text or at least one file");
  }
  const attachments = await resolvePostSignalAttachments(env, {
    attachments: input.attachments,
    context,
    spaceId,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
  const postInput = {
    requestChainBasis: input.requestChainBasis,
    ...(input.requestTimeContext
      ? { requestTimeContext: input.requestTimeContext }
      : {}),
    ...(input.deviceWait ? { deviceWait: input.deviceWait } : {}),
    ...(input.contextSelection
      ? { contextSelection: input.contextSelection }
      : {}),
    contextSelections: input.contextSelections,
    taskDraft: input.taskDraft,
    ...(input.agentStreamId === undefined
      ? {}
      : { agentStreamId: input.agentStreamId }),
    spaceId,
    clientMessageId: input.clientMessageId,
    profile: input.profile,
    text: normalizedText,
    authoringPolicy: input.authoringPolicy,
    ...(attachments ? { attachments } : {}),
    ...(input.files ? { files: input.files } : {}),
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(password === undefined ? {} : { password }),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    ...(input.spaceAddressingVersion
      ? { spaceAddressingVersion: input.spaceAddressingVersion }
      : {}),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  };
  if (input.pluginContinuation) {
    // An old receiver cannot silently ignore an optional constraint.
    return await stub.rpcPostPluginConnectionContinuation({
      ...postInput,
      pluginContinuation: input.pluginContinuation,
    });
  }
  return await stub.rpcPostSignalOnceByClientMessageId(postInput);
}
export async function rpcReadPluginConnectionLocalSource(
  env: CoreBindings,
  input: import("@openmeld/schemas").PluginConnectionLocalSourceRequest
) {
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return (
    await import("@openmeld/schemas")
  ).pluginConnectionLocalSourceResponseSchema.parse(
    await stub.rpcReadPluginConnectionLocalSource(input)
  );
}
/** Internal admitted execution projection, not a public connection route. */
export async function rpcReadPluginConnectionContinuationBinding(
  env: CoreBindings,
  input: ReadPluginConnectionContinuationBindingRequest
) {
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return readPluginConnectionContinuationBindingResponseSchema.parse(
    await stub.rpcReadPluginConnectionContinuationBinding(input)
  ).binding;
}
export async function rpcPostStatusSignal(
  env: CoreBindings,
  input: PostStatusSignalInput
): Promise<SignalEnvelope> {
  const context = requireWritableRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  if (!input.spaceAccess) {
    return await postFormalSignalWithFetch({
      stub,
      path: "/rpc/signals/status",
      context,
      ...(password === undefined ? {} : { password }),
      body: {
        profile: input.profile,
        data: input.data,
        ...(input.finalOutcomeAuthority
          ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
          : {}),
        ...(input.threadContext ? { threadContext: input.threadContext } : {}),
      },
    });
  }
  return await stub.rpcPostStatusSignal({
    spaceId,
    profile: input.profile,
    data: input.data,
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(password === undefined ? {} : { password }),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcPostSystemNoticeSignal(
  env: CoreBindings,
  input: PostSystemNoticeSignalInput
): Promise<SignalEnvelope> {
  const context = requireWritableRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  if (input.preHeadFailurePublication && !input.spaceAccess) {
    throw new Error("dispatch.pre_head_failure_publication_authority_required");
  }
  if (!input.spaceAccess) {
    return await postFormalSignalWithFetch({
      stub,
      path: "/rpc/signals/system-notice",
      context,
      ...(password === undefined ? {} : { password }),
      body: {
        profile: input.profile,
        data: input.data,
        ...(input.finalOutcomeAuthority
          ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
          : {}),
        ...(input.threadContext ? { threadContext: input.threadContext } : {}),
      },
    });
  }
  if (input.preHeadFailurePublication) {
    // The named required receiver rejects an older Space before publication.
    // An optional field on the ordinary RPC would be silently ignored there.
    return await stub.rpcPostPreHeadFailureNoticeSignal({
      ...input,
      context,
      spaceId,
      preHeadFailurePublication: input.preHeadFailurePublication,
    });
  }
  return await stub.rpcPostSystemNoticeSignal({
    spaceId,
    profile: input.profile,
    data: input.data,
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(password === undefined ? {} : { password }),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcPostExecutionRecoveryNoticeSignal(
  env: CoreBindings,
  input: PostExecutionRecoveryNoticeSignalInput
): Promise<PostExecutionRecoveryNoticeSignalResponse> {
  const context = requireWritableRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcPostExecutionRecoveryNoticeSignal({
    spaceId,
    profile: input.profile,
    data: input.data,
    ...(password === undefined ? {} : { password }),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcPostTransientSignal(
  env: CoreBindings,
  input: PostTransientSignalInput
): Promise<void> {
  assertWritableRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const password = resolveRpcSpaceAccessPassword(input);
  const normalizedText = String(input.text ?? "").trim();
  if (normalizedText.length === 0) {
    throw new Error("text is required");
  }
  await stub.rpcPostTransientSignal({
    spaceId,
    profile: input.profile,
    text: normalizedText,
    ...(password === undefined ? {} : { password }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
}
export async function rpcGetSpaceMeta(
  env: CoreBindings,
  input: GetSpaceMetaInput
): Promise<SpaceMeta> {
  const context = requireRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetMeta({
    spaceId,
    ...(password === undefined ? {} : { password }),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcGetSpaceContract(
  env: CoreBindings,
  input: GetSpaceContractInput
): Promise<SpaceContract> {
  const context = requireRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetContract({
    spaceId,
    ...(password === undefined ? {} : { password }),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcGetSpaceBoard(
  env: CoreBindings,
  input: GetSpaceBoardInput
): Promise<SpaceBoardResponse> {
  const parsed = getSpaceBoardInputSchema.safeParse({
    spaceId: input.spaceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: parsed.error.issues[0]?.message ?? "space board input is invalid",
    });
  }
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  const room = unwrapSpaceRpcJsonResult(
    await stub.rpcGetBoardResult({
      spaceId,
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    })
  );
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "space.board_execution_store_unavailable",
      reason: "Space Board execution store is unavailable.",
    });
  }
  const executions = await readSpaceBoardExecutionProjection({ db, spaceId });
  const profileNameById = new Map(
    room.agentProfiles.map((profile) => [
      profile.profileId,
      profile.profileName,
    ])
  );
  const response = spaceBoardResponseSchema.safeParse({
    space: room.space,
    members: room.members,
    workingNow: executions.workingNow.map((execution) => ({
      ...execution,
      profileName: profileNameById.get(execution.profileId) ?? null,
    })),
    recentOutcomes: executions.recentOutcomes.map((outcome) => ({
      ...outcome,
      profileName: profileNameById.get(outcome.profileId) ?? null,
    })),
  });
  if (!response.success) {
    throw new Error("failed to build Space Board response", {
      cause: response.error,
    });
  }
  return response.data;
}
export async function rpcGetSpaceUpdates(
  env: CoreBindings,
  input: GetSpaceUpdatesInput
): Promise<GetSpaceUpdatesResponse> {
  const parsed = getSpaceUpdatesInputSchema.safeParse({
    spaceId: input.spaceId,
    afterSignalId: input.afterSignalId,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ?? "space updates input is invalid",
    });
  }
  const context = requireRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcGetUpdates({
    spaceId,
    afterSignalId: parsed.data.afterSignalId,
    ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    ...(password === undefined ? {} : { password }),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcGetSpaceStatus(
  env: CoreBindings,
  input: GetSpaceStatusInput
): Promise<GetSpaceStatusResponse> {
  const parsed = getSpaceStatusInputSchema.safeParse({
    spaceId: input.spaceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ?? "space status input is invalid",
    });
  }
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return unwrapSpaceRpcJsonResult(
    await stub.rpcGetStatusResult({
      spaceId,
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    })
  );
}
export async function rpcGetSpaceEntryResolution(
  env: CoreBindings,
  input: GetSpaceEntryResolutionRpcInput
): Promise<GetSpaceEntryResolutionResponse> {
  const parsed = getSpaceEntryResolutionInputSchema.safeParse({
    spaceId: input.spaceId,
    signalId: input.signalId,
    threadRootSignalId: input.threadRootSignalId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Space entry resolution input is invalid",
    });
  }
  const target = parsed.data;
  const indexed = await readSpaceIndexOrganizationJoinTarget({
    includeDeletedSpaces: true,
    db: requireSpaceIndexDb(env),
    spaceId: target.spaceId,
  });
  if (!indexed) {
    return buildUnavailableSpaceEntryResolution(target);
  }
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  // The Space authorizes entry independently of the Organization audience, so
  // both reads start together. The audience still settles first to keep its
  // errors ahead of any access error, as when the reads ran in sequence.
  const accessPromise = resolveSpaceEntryAccess({
    env,
    spaceAccess,
    spaceId: target.spaceId,
  });
  accessPromise.catch(() => undefined);
  const { organizationMember, organizationSlug } =
    await resolveSpaceEntryOrganizationAudience({
      context,
      env,
      organizationId: indexed.organizationId,
    });
  const access = await accessPromise;
  const guest =
    !organizationMember && context
      ? (await resolveSpaceStub(
          env.OPENMELD_SPACES,
          target.spaceId
        )?.rpcHasSpaceGuestAccess({ spaceId: target.spaceId, context })) ===
        true
      : false;
  if (
    access.kind === "allowed" &&
    access.meta.accessMode === "members_only" &&
    !organizationMember &&
    !guest
  ) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason:
        "Space membership could not be reconciled with Organization membership.",
      status: 503,
    });
  }
  const response = buildSpaceEntryResolution({
    access,
    authenticated: Boolean(context),
    indexed: {
      deletedAt: indexed.deletedAt,
      organizationId: indexed.organizationId,
      ...(organizationSlug ? { organizationSlug } : {}),
      ...(indexed.creatorProfileId
        ? {
            owner: {
              profileId: indexed.creatorProfileId,
              ...(indexed.creatorProfileName
                ? { displayName: indexed.creatorProfileName }
                : {}),
            },
          }
        : {}),
      ...(indexed.spaceName ? { spaceName: indexed.spaceName } : {}),
      visibility: indexed.visibility,
    },
    organizationMember,
    target,
  });
  if (guest && response.view.state === "allowed") {
    response.view.experience = "guest";
  }
  if (response.view.state === "allowed" && target.signalId) {
    const { stub } = resolveRpcSpaceStubOrThrow(env, target.spaceId);
    response.target = await stub.rpcResolveReadTarget({
      ...target,
      spaceAccess,
    });
  }
  return getSpaceEntryResolutionResponseSchema.parse(response);
}
async function resolveSpaceEntryOrganizationAudience(input: {
  context?: CoreRpcContextInput;
  env: CoreBindings;
  organizationId: string;
}): Promise<{
  organizationMember: boolean;
  organizationSlug: string | null;
}> {
  const callerPrincipalId = normalizeOptionalText(
    input.context?.actorContext.callerPrincipalId
  );
  if (!callerPrincipalId) {
    return { organizationMember: false, organizationSlug: null };
  }
  const membership = await resolveOrganizationMembershipWithRouteSlug({
    env: input.env,
    organizationId: input.organizationId,
    requestId: input.context?.actorContext.requestId,
    userId: callerPrincipalId,
  });
  if (!membership.ok) {
    if (membership.code === "organization.context_unavailable") {
      throw createCoreRpcHttpError({
        code: membership.code,
        reason: membership.message,
        status: membership.status,
      });
    }
    return { organizationMember: false, organizationSlug: null };
  }
  const { organizationSlug } = membership;
  if (!organizationSlug) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason: "The Space Organization route could not be resolved.",
      status: 503,
    });
  }
  return { organizationMember: true, organizationSlug };
}
async function resolveSpaceEntryAccess(input: {
  env: CoreBindings;
  spaceAccess: SpaceAccessContext;
  spaceId: string;
}): Promise<SpaceEntryAccessResult> {
  let entry: SpaceEntryAccessResponse;
  try {
    const { stub } = resolveRpcSpaceStubOrThrow(input.env, input.spaceId);
    // The owning Space authorizes once and reads current participation locally.
    entry = await stub.rpcGetEntryAccess({
      spaceId: input.spaceId,
      spaceAccess: input.spaceAccess,
    });
  } catch (error) {
    const code = readCoreRpcErrorCode(error);
    if (
      code === "space.membership_required" ||
      code === "space.password_invalid" ||
      code === "space.password_required"
    ) {
      return { code, kind: "denied" };
    }
    throw error;
  }
  const { meta, activeMember } = entry;
  if (!meta.accessMode) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "space.access_unavailable",
      reason: "The Space access mode could not be resolved.",
    });
  }
  return {
    activeMember,
    kind: "allowed",
    meta: {
      name: meta.name,
      accessMode: meta.accessMode,
      allowGuests: meta.allowGuests === true,
      linkJoinPolicy: meta.linkJoinPolicy,
    },
  };
}
export async function rpcGetSpaceConversationState(
  env: CoreBindings,
  input: GetSpaceConversationStateRpcInput
): Promise<GetSpaceConversationStateResponse> {
  const parsed = getSpaceConversationStateInputSchema.safeParse({
    spaceId: input.spaceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space conversation state input is invalid",
    });
  }
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcGetConversationState({
    spaceId,
    ...(password === undefined ? {} : { password }),
    ...(context ? { context } : {}),
    spaceAccess,
  });
}
export async function rpcGetSpaceBootstrap(
  env: CoreBindings,
  input: GetSpaceBootstrapInput
): Promise<SpaceBootstrapResponse> {
  return (await rpcGetSpaceBootstrapWithTiming(env, input)).payload;
}
export async function rpcGetSpaceBootstrapWithTiming(
  env: CoreBindings,
  input: GetSpaceBootstrapInput
): Promise<SpaceBootstrapWithTiming> {
  const { rpcInput, stub } = resolveSpaceBootstrapRpcTarget(env, input);
  return await stub.rpcGetBootstrapWithTiming(rpcInput);
}
function resolveSpaceBootstrapRpcTarget(
  env: CoreBindings,
  input: GetSpaceBootstrapInput
): {
  rpcInput: GetSpaceBootstrapInput;
  stub: SpaceRpcStub;
} {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const fromProfileIds = normalizeStringArray(input.fromProfileIds);
  const signalTypes = normalizeStringArray(input.signalTypes);
  const cursor = normalizeOptionalText(input.cursor);
  const afterSignalId = normalizeOptionalText(input.afterSignalId);
  const aroundSignalId = normalizeOptionalText(input.aroundSignalId);
  return {
    rpcInput: {
      spaceId,
      ...buildListSignalsNumberFilters(input),
      ...(cursor ? { cursor } : {}),
      ...(input.recent === true ? { recent: true } : {}),
      ...(afterSignalId ? { afterSignalId } : {}),
      ...(aroundSignalId ? { aroundSignalId } : {}),
      ...(input.includeAgentStreamPresence === true
        ? { includeAgentStreamPresence: true }
        : {}),
      ...(input.includeAgentReadiness === false
        ? { includeAgentReadiness: false }
        : {}),
      ...(fromProfileIds.length > 0 ? { fromProfileIds } : {}),
      ...buildListSignalsTypeFilter(signalTypes),
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    },
    stub,
  };
}
export async function rpcGetSpaceDispatchResult(
  env: CoreBindings,
  input: GetSpaceDispatchResultInput
): Promise<DispatchResult> {
  const parsed = getSpaceDispatchResultInputSchema.safeParse({
    spaceId: input.spaceId,
    ...(input.dispatchId === undefined ? {} : { dispatchId: input.dispatchId }),
    ...(input.resultRef === undefined ? {} : { resultRef: input.resultRef }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space dispatch result input is invalid",
    });
  }
  const context = requireRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcGetDispatchResult({
    spaceId,
    ...(parsed.data.dispatchId ? { dispatchId: parsed.data.dispatchId } : {}),
    ...(parsed.data.resultRef ? { resultRef: parsed.data.resultRef } : {}),
    ...(password === undefined ? {} : { password }),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcUpdateSpaceMeta(
  env: CoreBindings,
  input: UpdateSpaceMetaInput
): Promise<SpaceMeta> {
  const context = requireRpcContext(input.context);
  const parsedBody = patchSpaceMetaBodySchema.safeParse({
    ...(input.ownership === undefined ? {} : { ownership: input.ownership }),
    ...(input.allowGuests === undefined
      ? {}
      : { allowGuests: input.allowGuests }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.guide === undefined ? {} : { guide: input.guide }),
  });
  if (!parsedBody.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsedBody.error.issues[0]?.message ??
        "Space metadata update is invalid",
    });
  }
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcPatchMeta({
    spaceId,
    ...parsedBody.data,
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcPutSpaceContract(
  env: CoreBindings,
  input: PutSpaceContractInput
): Promise<SpaceContract> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcPutContract({
    spaceId,
    contract: input.contract,
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcPatchSpaceContract(
  env: CoreBindings,
  input: PatchSpaceContractInput
): Promise<SpaceContract> {
  const parsed = patchSpaceContractBodySchema.safeParse(input.contractPatch);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space contract patch input is invalid",
    });
  }
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  if (parsed.data.publicationMode !== undefined) {
    await assertCenterAgentDirectMessageMutationAllowed({
      env,
      reason: "Center Agent Direct Messages cannot change publication mode.",
      spaceId,
    });
  }
  return await stub.rpcPatchContract({
    spaceId,
    contractPatch: parsed.data,
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcDeleteSpace(
  env: CoreBindings,
  input: DeleteSpaceInput
): Promise<DeleteSpaceResult> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await assertCenterAgentDirectMessageMutationAllowed({
    env,
    reason: "Center Agent Direct Messages cannot be deleted.",
    spaceId,
  });
  const approvedAgentCreatorProfileId =
    typeof input.approvedAgentCreatorProfileId === "string"
      ? input.approvedAgentCreatorProfileId.trim()
      : "";
  return await stub.rpcDelete({
    spaceId,
    ...(approvedAgentCreatorProfileId.length > 0
      ? { approvedAgentCreatorProfileId }
      : {}),
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcDeleteConversationForMe(
  env: CoreBindings,
  raw: DeleteConversationForMeInput
): Promise<DeleteConversationForMeResponse> {
  const input = deleteConversationForMeInputSchema.parse(raw);
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcDeleteConversationForMe({ spaceId, context });
}
export async function rpcListAccountSpaces(
  env: CoreBindings,
  input: ListAccountSpacesInput
): Promise<AccountSpaceIndexResponse> {
  const gatewayHost = normalizeRequiredText(input.gatewayHost, "gatewayHost");
  const ownerUserId = normalizeRequiredText(input.ownerUserId, "ownerUserId");
  const selectedProfileId = normalizeRequiredText(
    input.selectedProfileId,
    "selectedProfileId"
  );
  const scope = input.scope === "profile" ? "profile" : "account";
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(500, Math.max(1, Math.trunc(input.limit)))
      : 500;
  return await listAccountSpacesFromSpaceIndex({
    includeDeletedSpaces: input.includeDeletedSpaces === true,
    db: requireSpaceIndexDb(env),
    gatewayHost,
    ownerUserId,
    scope,
    selectedProfileId,
    limit,
    includeDirectMessageProfileIds:
      input.includeDirectMessageProfileIds === true,
    includeRecentlyDeletedItems: input.includeRecentlyDeletedItems === true,
    includePurposes: input.includePurposes === true,
    includeMemberPreviews: input.includeMemberPreviews === true,
    includeMessagePreviews: input.includeMessagePreviews === true,
    includeDirectoryPreviews: input.includeDirectoryPreviews === true,
  });
}
// Ambient sidebar indicator fan-out bound. The owner repositories apply their
// own dedicated lifecycle/progress freshness rules; this limit only keeps the
// account-level candidate set bounded and does not decide execution truth.
const ACCOUNT_SPACE_ACTIVE_WAKE_SPACE_LIMIT = 500;
export async function rpcListAccountSpaceActiveWakeSummary(
  env: CoreBindings,
  input: ListAccountSpaceActiveWakeSummaryInput
): Promise<AccountSpaceActiveWakeSummaryResponse> {
  const parsedInput =
    accountSpaceActiveWakeSummaryRpcInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Invalid account Space active Wake summary input.",
      status: 400,
    });
  }
  const gatewayHost = resolveAccountSpaceActiveWakeGatewayHost({
    configuredGatewayUrl: env.OPENMELD_GATEWAY_URL,
    gatewayHost: parsedInput.data.gatewayHost,
  });
  const generatedAtMs = Date.now();
  const spaceIds = await listAccountSpaceIdsFromSpaceIndex({
    db: requireSpaceIndexDb(env),
    gatewayHost,
    limit: ACCOUNT_SPACE_ACTIVE_WAKE_SPACE_LIMIT,
    ownerUserId: parsedInput.data.ownerUserId,
  });
  if (spaceIds.length === 0) {
    return { generatedAtMs, items: [] };
  }
  return await buildActiveWakeSummaryForSpaceIds({
    env,
    generatedAtMs,
    ownerUserId: parsedInput.data.ownerUserId,
    spaceIds,
  });
}
async function buildActiveWakeSummaryForSpaceIds(input: {
  env: CoreBindings;
  generatedAtMs?: number;
  ownerUserId: string | null;
  spaceIds: readonly string[];
}): Promise<AccountSpaceActiveWakeSummaryResponse> {
  const generatedAtMs = input.generatedAtMs ?? Date.now();
  if (input.spaceIds.length === 0) {
    return { generatedAtMs, items: [] };
  }
  const wakeDb = getPostgresDatabase(input.env);
  if (!wakeDb) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Wake evidence store is unavailable.",
      code: "account_spaces.wake_evidence_store_unavailable",
    });
  }
  const freshAfterMs =
    generatedAtMs - REMOTE_AGENT_ACTIVE_EXECUTION_EVIDENCE_FRESHNESS_MS;
  const [executionTargets, nativeDeliveryTargets] = await Promise.all([
    listActiveRuntimeCoordinatorExecutionTargetsBySpaceIds({
      db: wakeDb,
      freshAfterMs,
      spaceIds: input.spaceIds,
    }),
    listActiveRemoteAgentNativeDeliveryTargetsBySpaceIds({
      db: wakeDb,
      freshAfterMs,
      spaceIds: input.spaceIds,
    }),
  ]);
  const targetCountsBySpaceId = new Map<string, Map<string, number>>();
  for (const target of [...executionTargets, ...nativeDeliveryTargets]) {
    const targetCounts =
      targetCountsBySpaceId.get(target.spaceId) ?? new Map<string, number>();
    targetCounts.set(
      target.targetProfileId,
      (targetCounts.get(target.targetProfileId) ?? 0) + target.activeWakeCount
    );
    targetCountsBySpaceId.set(target.spaceId, targetCounts);
  }
  const targetProfileNamesBySpaceAndId =
    await readActiveWakeTargetProfileNameSnapshots({
      db: getPostgresDatabase(input.env),
      targets: [...targetCountsBySpaceId].flatMap(([spaceId, targetCounts]) =>
        [...targetCounts.keys()].map((profileId) => ({ profileId, spaceId }))
      ),
      viewerOwnerUserId: input.ownerUserId,
    });
  const currentNamesByProfileId = new Map<string, string>();
  const profileIds = [
    ...new Set(
      [...targetCountsBySpaceId.values()].flatMap((counts) => [
        ...counts.keys(),
      ])
    ),
  ];
  // Resolve each active identity once, even when it is working in many Spaces.
  const nameDeadlineAtMs = Date.now() + SPACE_MEMBER_NAME_READ_BUDGET_MS;
  for (let offset = 0; offset < profileIds.length; offset += 8) {
    if (Date.now() >= nameDeadlineAtMs) {
      break;
    }
    await Promise.all(
      profileIds.slice(offset, offset + 8).map(async (profileId) => {
        const name = await readSpaceMemberNameFromAuth({
          env: input.env,
          profileId,
          profileKind: "agent",
          deadlineAtMs: nameDeadlineAtMs,
        });
        if (name) {
          currentNamesByProfileId.set(profileId, name);
        }
      })
    );
  }
  return {
    generatedAtMs,
    items: Array.from(targetCountsBySpaceId, ([spaceId, targetCounts]) => {
      const activeTargets = Array.from(
        targetCounts,
        ([profileId, activeWakeCount]) => ({
          activeWakeCount,
          profileId,
          profileName:
            currentNamesByProfileId.get(profileId) ??
            targetProfileNamesBySpaceAndId.get(
              buildActiveWakeTargetKey({ profileId, spaceId })
            ) ??
            null,
        })
      ).sort((left, right) =>
        (left.profileName ?? left.profileId).localeCompare(
          right.profileName ?? right.profileId
        )
      );
      return {
        activeTargets,
        activeWakeCount: activeTargets.reduce(
          (total, target) => total + target.activeWakeCount,
          0
        ),
        spaceId,
      };
    }).sort((left, right) => left.spaceId.localeCompare(right.spaceId)),
  };
}
async function readActiveWakeTargetProfileNameSnapshots(input: {
  db: PostgresDatabase | undefined;
  targets: readonly {
    profileId: string;
    spaceId: string;
  }[];
  viewerOwnerUserId: string | null;
}): Promise<Map<string, string>> {
  const namesBySpaceAndProfileId = new Map<string, string>();
  if (!input.db || input.targets.length === 0) {
    return namesBySpaceAndProfileId;
  }
  try {
    const snapshots = await listSpaceIndexTargetProfileNameSnapshots({
      db: input.db,
      targets: input.targets,
    });
    for (const snapshot of snapshots) {
      namesBySpaceAndProfileId.set(
        buildActiveWakeTargetKey(snapshot),
        snapshot.profileName
      );
    }
  } catch (error) {
    console.warn("[core.account_spaces.active_wake_target_names_failed]", {
      event: "core.account_spaces.active_wake_target_names_failed",
      error: error instanceof Error ? error.message : String(error),
      targetCount: input.targets.length,
      viewerOwnerUserId: input.viewerOwnerUserId,
    });
  }
  return namesBySpaceAndProfileId;
}
function buildActiveWakeTargetKey(input: {
  profileId: string;
  spaceId: string;
}): string {
  return `${input.spaceId}\u0000${input.profileId}`;
}
export function resolveAccountSpaceActiveWakeGatewayHost(input: {
  configuredGatewayUrl?: string;
  gatewayHost?: string;
}): string {
  if (input.gatewayHost) {
    return input.gatewayHost;
  }
  const configuredGatewayUrl = normalizeOptionalText(
    input.configuredGatewayUrl
  );
  if (!configuredGatewayUrl) {
    throw createCoreRpcHttpError({
      code: "account_spaces.gateway_host_unavailable",
      reason: "Gateway host configuration is unavailable.",
      status: 503,
    });
  }
  try {
    return profileSpaceHistoryGatewayHostSchema.parse(
      new URL(configuredGatewayUrl).host
    );
  } catch {
    throw createCoreRpcHttpError({
      code: "account_spaces.gateway_host_unavailable",
      reason: "Gateway host configuration is invalid.",
      status: 503,
    });
  }
}
export async function rpcGetSpaceCursor(
  env: CoreBindings,
  input: GetSpaceCursorInput
): Promise<SpaceCursor> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const profileId = String(input.profileId ?? "").trim();
  if (profileId.length === 0) {
    throw new Error("profileId is required");
  }
  return await stub.rpcGetCursor({
    spaceId,
    profileId,
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcGetSpaceMembers(
  env: CoreBindings,
  input: GetSpaceMembersInput
): Promise<SpaceMembersSnapshot> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetMembers({
    spaceId,
    ...(password === undefined ? {} : { password }),
    ...(context ? { context } : {}),
    spaceAccess,
  });
}
export async function rpcGetSpaceIdentityDirectory(
  env: CoreBindings,
  input: GetSpaceMembersInput
): Promise<SpaceIdentityDirectory> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetIdentityDirectory({
    spaceId,
    ...(password === undefined ? {} : { password }),
    ...(context ? { context } : {}),
    spaceAccess,
  });
}
export async function rpcGetSpaceMemberDirectory(
  env: CoreBindings,
  input: GetSpaceMembersInput
): Promise<SpaceMemberDirectory> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetMemberDirectory({
    spaceId,
    ...(password === undefined ? {} : { password }),
    ...(context ? { context } : {}),
    spaceAccess,
  });
}
export async function rpcGetSpaceViewerMembership(
  env: CoreBindings,
  input: GetSpaceViewerMembershipInput
): Promise<SpaceViewerMembershipResponse> {
  const context = requireRpcSpaceAccessContext(input);
  const password = resolveRpcSpaceAccessPassword(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetViewerMembership({
    spaceId,
    ...(password === undefined ? {} : { password }),
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
}
export async function rpcRecordSpaceAttachment(
  env: CoreBindings,
  input: RecordSpaceAttachmentInput
): Promise<SpaceAttachmentDescriptor> {
  const payload = recordSpaceAttachmentPayloadSchema.safeParse({
    spaceId: input.spaceId,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
  });
  if (!payload.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        payload.error.issues[0]?.message ??
        "Space attachment metadata is invalid.",
      status: 400,
    });
  }
  const access = await requireSpaceAttachmentAccess(env, {
    ...input,
    spaceId: payload.data.spaceId,
  });
  const createdAtMs = Date.now();
  const descriptor = spaceAttachmentDescriptorSchema.safeParse({
    id: crypto.randomUUID(),
    organizationId: access.organizationId,
    spaceId: access.spaceId,
    mimeType: payload.data.mimeType,
    sizeBytes: payload.data.sizeBytes,
    ...(payload.data.width === undefined ? {} : { width: payload.data.width }),
    ...(payload.data.height === undefined
      ? {}
      : { height: payload.data.height }),
    ...(payload.data.fileName === undefined
      ? {}
      : { fileName: payload.data.fileName }),
    createdAt: new Date(createdAtMs).toISOString(),
  });
  if (!descriptor.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        descriptor.error.issues[0]?.message ??
        "Space attachment metadata is invalid.",
      status: 400,
    });
  }
  await insertSpaceAttachmentRecord({
    db: access.db,
    record: {
      createdAtMs,
      fileName: descriptor.data.fileName ?? null,
      height: descriptor.data.height ?? null,
      id: descriptor.data.id,
      mimeType: descriptor.data.mimeType,
      organizationId: descriptor.data.organizationId,
      sizeBytes: descriptor.data.sizeBytes,
      spaceId: descriptor.data.spaceId,
      uploaderUserId: access.uploaderUserId,
      width: descriptor.data.width ?? null,
    },
  });
  return descriptor.data;
}
export async function rpcDeleteSpaceAttachmentRecord(
  env: CoreBindings,
  input: DeleteSpaceAttachmentRecordInput
): Promise<DeleteSpaceAttachmentRecordResult> {
  const payload = deleteSpaceAttachmentRecordInputSchema.safeParse(input);
  if (!payload.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Space attachment id is invalid.",
      status: 400,
    });
  }
  const result = deleteSpaceAttachmentRecordResultSchema.safeParse({
    deleted: await deleteSpaceAttachmentRecord({
      attachmentId: payload.data.attachmentId,
      db: requireSpaceAttachmentDb(env),
    }),
  });
  if (!result.success) {
    throw new Error(
      `Space attachment deletion result is invalid: ${result.error.message}`
    );
  }
  return result.data;
}
export async function rpcResolveSpaceAttachmentForDownload(
  env: CoreBindings,
  input: ResolveSpaceAttachmentForDownloadInput
): Promise<SpaceAttachmentDescriptor> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const meta = await stub.rpcGetMeta({ spaceId, spaceAccess });
  const payload = resolveSpaceAttachmentForDownloadPayloadSchema.safeParse({
    attachmentId: input.attachmentId,
    spaceId,
  });
  if (!payload.success) {
    throwAttachmentNotFound();
  }
  const attachment = await readSpaceAttachmentRecord({
    attachmentId: payload.data.attachmentId,
    db: requireSpaceAttachmentDb(env),
    organizationId: meta.organizationId,
    spaceId,
  });
  if (!attachment) {
    throwAttachmentNotFound();
  }
  return attachment;
}
export async function rpcSpaceFileUpload(
  env: CoreBindings,
  input: SpaceAttachmentAccessInput & {
    uploadId: string;
    command: import("@openmeld/schemas/types").SpaceFileUploadCommand;
    body?: ReadableStream<Uint8Array>;
  }
): Promise<import("@openmeld/schemas/types").SpaceFileUploadResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcSpaceFileUpload({
    spaceAccess,
    spaceId,
    uploadId: input.uploadId,
    command: input.command,
    body: input.body,
  });
}
export async function rpcSpaceFileUpdateSettings(
  env: CoreBindings,
  input: SpaceAttachmentAccessInput & {
    fileId: string;
    command: import("@openmeld/schemas/types").SpaceFileUpdateSettingsCommand;
  }
): Promise<import("@openmeld/schemas/types").SpaceFileUpdateSettings> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcSpaceFileUpdateSettings({
    spaceId,
    spaceAccess,
    fileId: input.fileId,
    command: input.command,
  });
}
export async function rpcListSpaceFiles(
  env: CoreBindings,
  input: ListSpaceFilesInput
): Promise<ListSpaceFilesResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcListSpaceFiles({
    spaceAccess,
    spaceId,
    query: input.query,
  });
}
export async function rpcGetSpaceFile(
  env: CoreBindings,
  input: GetSpaceFileInput
): Promise<SpaceFileDescriptor> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetSpaceFile({
    fileId: input.fileId,
    spaceAccess,
    spaceId,
  });
}
export async function rpcListSpaceFileRevisions(
  env: CoreBindings,
  input: GetSpaceFileInput
): Promise<ListSpaceFileRevisionsResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcListSpaceFileRevisions({
    fileId: input.fileId,
    spaceAccess,
    spaceId,
  });
}
export async function rpcCreateSpaceFolder(
  env: CoreBindings,
  input: CreateSpaceFolderInput
): Promise<CreateSpaceFolderResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcCreateSpaceFolder({
    body: input.body,
    spaceAccess,
    spaceId,
  });
}
export async function rpcUpdateSpaceFileEntry(
  env: CoreBindings,
  input: UpdateSpaceFileEntryInput
): Promise<UpdateSpaceFileEntryResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcUpdateSpaceFileEntry({
    body: input.body,
    entryId: input.entryId,
    spaceAccess,
    spaceId,
  });
}
export async function rpcTrashSpaceFileEntry(
  env: CoreBindings,
  input: TrashSpaceFileEntryInput
): Promise<TrashSpaceFileEntryResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcTrashSpaceFileEntry({
    clientMutationId: input.clientMutationId,
    entryId: input.entryId,
    spaceAccess,
    spaceId,
  });
}
export async function rpcRestoreSpaceFileEntry(
  env: CoreBindings,
  input: RestoreSpaceFileEntryInput
): Promise<RestoreSpaceFileEntryResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcRestoreSpaceFileEntry({
    body: input.body,
    entryId: input.entryId,
    spaceAccess,
    spaceId,
  });
}
export async function rpcPrepareSpaceFileWrite(
  env: CoreBindings,
  input: SpaceFileWriteInput
): Promise<PrepareSpaceFileWriteResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcPrepareSpaceFileWrite({
    spaceAccess,
    write: input.write,
  });
}
export async function rpcCommitSpaceFileWrite(
  env: CoreBindings,
  input: SpaceFileWriteInput
): Promise<SpaceFileDescriptor> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcCommitSpaceFileWrite({
    spaceAccess,
    write: input.write,
  });
}
export async function rpcResolveSpaceFileContent(
  env: CoreBindings,
  input: ResolveSpaceFileContentRpcInput
): Promise<ResolveSpaceFileContentResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcResolveSpaceFileContent({
    content: input.content,
    spaceAccess,
  });
}
export async function rpcReadSpaceFileContent(
  env: CoreBindings,
  input: ReadSpaceFileContentRpcInput
): Promise<ReadSpaceFileContentRpcResponse> {
  const response = await rpcStreamSpaceFileContent(env, input);
  if (response.revision.sizeBytes > 10 * 1024 * 1024) {
    await response.bytes.cancel();
    throwSpaceFileStorageFailed(
      "Use the streaming download endpoint for this file."
    );
  }
  return {
    ...response,
    bytes: await new Response(response.bytes).arrayBuffer(),
  };
}
export async function rpcStreamSpaceFileContent(
  env: CoreBindings,
  input: ReadSpaceFileContentRpcInput,
  streamOptions?: SpaceFileStreamOptions
): Promise<
  ResolveSpaceFileContentResponse & {
    bytes: ReadableStream<Uint8Array>;
    stream?: SpaceFileStreamMetadata;
  }
> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const resolved = await stub.rpcResolveSpaceFileContent({
    content: input.content,
    spaceAccess,
  });
  // Authorization precedes both range validation and disclosure of file size.
  const options =
    streamOptions === undefined
      ? undefined
      : spaceFileStreamOptionsSchema.safeParse(streamOptions);
  if (options && !options.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Invalid file streaming options.",
      status: 400,
    });
  }
  const stream = options?.success
    ? resolveSpaceFileStreamMetadata({
        options: options.data,
        revisionId: resolved.revision.id,
        sizeBytes: resolved.revision.sizeBytes,
      })
    : undefined;
  const auditEvent = buildSpaceFileContentAuditEvent({
    entryId: resolved.file.id,
    operation: "content_read",
    // A read has no client mutation key, and one request may read many files
    // (for example, one Remote Agent submission). Each read is its own audited
    // access; the shared request ID stays on the event for correlation.
    operationId: crypto.randomUUID(),
    organizationId: resolved.organizationId,
    revisionId: resolved.revision.id,
    spaceAccess,
    spaceId: input.spaceId,
  });
  let bytes: ReadableStream<Uint8Array>;
  try {
    assertSpaceFileObjectScope({
      organizationId: resolved.organizationId,
      spaceId: input.spaceId,
      fileId: input.content.fileId,
      revisionId: resolved.revision.id,
      objectKey: resolved.objectKey,
    });
    const bucket = requireSpaceFileBucket(env);
    let object: R2ObjectBody | null;
    try {
      if (stream?.status === 416) {
        // Do not open the original merely to report an unsatisfiable range.
        return {
          ...resolved,
          stream,
          bytes: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        };
      }
      if (options?.success && options.data.head) {
        const metadata = await bucket.head(resolved.objectKey);
        if (!metadata || metadata.size !== resolved.revision.sizeBytes) {
          throwSpaceFileStorageFailed(
            "This file revision is unavailable or incomplete."
          );
        }
        await stub.rpcRecordSpaceFileAuditEvent({ event: auditEvent });
        return {
          ...resolved,
          stream,
          bytes: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        };
      }
      object =
        stream?.status === 206
          ? await bucket.get(resolved.objectKey, {
              range: { offset: stream.offset, length: stream.length },
            })
          : await bucket.get(resolved.objectKey);
    } catch {
      throwSpaceFileStorageFailed("This file could not be read right now.");
    }
    if (!object) {
      throwSpaceFileStorageFailed("This file revision is unavailable.");
    }
    bytes = object.body;
    if (object.size !== resolved.revision.sizeBytes) {
      await bytes.cancel();
      throwSpaceFileStorageFailed("This file revision is incomplete.");
    }
  } catch (error) {
    await stub.rpcRecordSpaceFileAuditEvent({
      event: {
        ...auditEvent,
        errorCode: readCoreRpcErrorCode(error) ?? "space_file.storage_failed",
        result: "failed",
      },
    });
    throw error;
  }
  await stub.rpcRecordSpaceFileAuditEvent({ event: auditEvent });
  return { ...resolved, bytes, ...(stream ? { stream } : {}) };
}
export async function rpcWriteSpaceFileContent(
  env: CoreBindings,
  input: WriteSpaceFileContentRpcInput
): Promise<SpaceFileDescriptor> {
  if (
    input.write.sizeBytes > SPACE_FILE_RAW_UPLOAD_MAX_BYTES ||
    (input.bytes instanceof ArrayBuffer &&
      input.bytes.byteLength !== input.write.sizeBytes)
  ) {
    throw createCoreRpcHttpError({
      code: "space_file.too_large",
      reason: `Single-request writes must be ${SPACE_FILE_RAW_UPLOAD_MAX_BYTES / (1024 * 1024)} MiB or smaller and match the declared size. Use multipart upload for larger files.`,
      status: 413,
    });
  }
  return await writePreparedSpaceFileContent(env, input);
}
async function writePreparedSpaceFileContent(
  env: CoreBindings,
  input: WriteSpaceFileContentRpcInput
): Promise<SpaceFileDescriptor> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const prepared = await stub.rpcPrepareSpaceFileWrite({
    spaceAccess,
    write: input.write,
  });
  const auditEvent = buildSpaceFileContentAuditEvent({
    entryId: input.write.fileId,
    operation: "content_write",
    operationId: input.write.clientMutationId,
    organizationId: prepared.organizationId,
    revisionId: input.write.revisionId,
    spaceAccess,
    spaceId: input.spaceId,
  });
  if (prepared.committedFile) {
    await stub.rpcRecordSpaceFileAuditEvent({ event: auditEvent });
    return prepared.committedFile;
  }
  try {
    assertSpaceFileObjectScope({
      organizationId: prepared.organizationId,
      spaceId: input.spaceId,
      fileId: input.write.fileId,
      revisionId: input.write.revisionId,
      objectKey: prepared.objectKey,
    });
    const bucket = requireSpaceFileBucket(env);
    await bucket.put(prepared.objectKey, input.bytes, {
      httpMetadata: { contentType: input.write.mimeType },
      customMetadata: {
        fileId: input.write.fileId,
        revisionId: input.write.revisionId,
        spaceId: input.spaceId,
      },
    });
  } catch (error) {
    const normalizedError = normalizeSpaceFileStorageError(
      error,
      "This file could not be stored right now."
    );
    await stub.rpcRecordSpaceFileAuditEvent({
      event: {
        ...auditEvent,
        errorCode:
          readCoreRpcErrorCode(normalizedError) ?? "space_file.storage_failed",
        result: "failed",
      },
    });
    throw normalizedError;
  }
  try {
    return await stub.rpcCommitSpaceFileWrite({
      spaceAccess,
      write: input.write,
    });
  } catch (error) {
    console.warn("[core.space_file.orphan_reconciliation_deferred]", {
      event: "core.space_file.orphan_reconciliation_deferred",
      fileId: input.write.fileId,
      objectKey: prepared.objectKey,
      outcome: "commit_response_uncertain",
      requestId: input.context?.actorContext.requestId,
      revisionId: input.write.revisionId,
      spaceId: input.spaceId,
    });
    throw error;
  }
}
export async function rpcStageSpaceComposerUpload(
  env: CoreBindings,
  input: StageSpaceComposerUploadRpcInput
): Promise<SpaceComposerUploadDescriptor> {
  if (input.bytes.byteLength > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
    throw createCoreRpcHttpError({
      code: "space_file.too_large",
      reason: "Files must be 10 MiB or smaller.",
      status: 413,
    });
  }
  const uploadId = spaceComposerUploadIdSchema.parse(input.uploadId);
  const name = spaceFileNameSchema.parse(input.name);
  const mimeType = spaceFileMimeTypeSchema.parse(input.mimeType);
  const nowMs = normalizeComposerUploadNow(input.nowMs);
  const { scope } = await resolveSpaceComposerUploadScope(env, input);
  try {
    return await stageSpaceComposerUpload({
      bucket: requireSpaceFileBucket(env),
      bytes: input.bytes,
      expiresAtMs: nowMs + SPACE_COMPOSER_UPLOAD_TTL_MS,
      mimeType,
      name,
      scope,
      uploadId,
    });
  } catch (error) {
    throw normalizeSpaceComposerUploadError(error);
  }
}
export async function rpcPublishSpaceComposerUpload(
  env: CoreBindings,
  input: PublishSpaceComposerUploadRpcInput
): Promise<SpaceFileDescriptor> {
  const uploadId = spaceComposerUploadIdSchema.parse(input.uploadId);
  const clientMutationId = spaceFileClientMutationIdSchema.parse(
    input.clientMutationId
  );
  const { scope, spaceAccess } = await resolveSpaceComposerUploadScope(
    env,
    input
  );
  const fileId = await buildSpaceComposerPublishedFileId({
    clientMutationId,
    uploadId,
  });
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const resolveCommittedFile = async () =>
    await stub.rpcResolveCommittedSpaceFileWrite({
      clientMutationId,
      expectedFileId: fileId,
      spaceAccess,
      spaceId: input.spaceId,
    });
  let staged: Awaited<ReturnType<typeof readSpaceComposerUploadStream>>;
  try {
    staged = await readSpaceComposerUploadStream({
      bucket: requireSpaceFileBucket(env),
      nowMs: normalizeComposerUploadNow(input.nowMs),
      scope,
      uploadId,
    });
  } catch (error) {
    if (
      error instanceof SpaceComposerUploadStorageError &&
      (error.kind === "expired" || error.kind === "not_found")
    ) {
      const committedFile = await resolveCommittedFile();
      if (committedFile) {
        return committedFile;
      }
    }
    throw normalizeSpaceComposerUploadError(error);
  }
  const revisionId = await buildSpaceFileRevisionIdFromDigest({
    baseRevision: null,
    contentDigest: await hashSpaceFileStream(staged.body),
    clientMutationId,
    mimeType: staged.descriptor.mimeType,
    name: staged.descriptor.name,
    parentId: null,
  });
  const committedFile = await resolveCommittedFile();
  if (committedFile) {
    if (committedFile.latestRevision.id !== revisionId) {
      throw createCoreRpcHttpError({
        code: "space_file.conflict",
        reason: "This request ID was already used for another upload.",
        status: 409,
      });
    }
    return committedFile;
  }
  return await writePreparedSpaceFileContent(env, {
    bytes: (
      await readSpaceComposerUploadStream({
        bucket: requireSpaceFileBucket(env),
        nowMs: normalizeComposerUploadNow(input.nowMs),
        scope,
        uploadId,
      })
    ).body,
    context: input.context,
    spaceAccess,
    spaceId: input.spaceId,
    write: {
      baseRevision: null,
      clientMutationId,
      fileId,
      mimeType: staged.descriptor.mimeType,
      name: staged.descriptor.name,
      origin: "chat_upload",
      parentId: null,
      revisionId,
      sizeBytes: staged.descriptor.sizeBytes,
      spaceId: input.spaceId,
    },
  });
}
export async function rpcDiscardSpaceComposerUpload(
  env: CoreBindings,
  input: DiscardSpaceComposerUploadRpcInput
): Promise<{
  discarded: true;
  uploadId: string;
}> {
  const uploadId = spaceComposerUploadIdSchema.parse(input.uploadId);
  const { scope } = await resolveSpaceComposerUploadScope(env, input);
  try {
    await discardSpaceComposerUpload({
      bucket: requireSpaceFileBucket(env),
      scope,
      uploadId,
    });
  } catch (error) {
    throw normalizeSpaceComposerUploadError(error);
  }
  return { discarded: true, uploadId };
}
export async function rpcRestoreSpaceFileRevision(
  env: CoreBindings,
  input: RestoreSpaceFileRevisionInput
): Promise<SpaceFileDescriptor> {
  const source = await rpcStreamSpaceFileContent(env, {
    context: input.context,
    content: {
      spaceId: input.spaceId,
      fileId: input.fileId,
      revision: input.revision,
    },
    spaceAccess: input.spaceAccess,
    spaceId: input.spaceId,
  });
  const contentDigest = await hashSpaceFileStream(source.bytes);
  const restored = await rpcStreamSpaceFileContent(env, {
    ...input,
    content: {
      spaceId: input.spaceId,
      fileId: input.fileId,
      revision: input.revision,
    },
  });
  return await rpcWriteSpaceFileContent(env, {
    bytes: restored.bytes,
    context: input.context,
    spaceAccess: input.spaceAccess,
    spaceId: input.spaceId,
    write: {
      spaceId: input.spaceId,
      fileId: input.fileId,
      revisionId: await buildSpaceFileRevisionIdFromDigest({
        baseRevision: input.body.baseRevision,
        contentDigest,
        clientMutationId: input.body.clientMutationId,
        mimeType: source.revision.mimeType,
      }),
      baseRevision: input.body.baseRevision,
      clientMutationId: input.body.clientMutationId,
      mimeType: source.revision.mimeType,
      sizeBytes: source.revision.sizeBytes,
    },
  });
}
function requireSpaceFileBucket(env: CoreBindings): R2Bucket {
  if (!env.OPENMELD_SPACE_ATTACHMENTS) {
    throwSpaceFileStorageFailed("Space file storage is unavailable.");
  }
  return env.OPENMELD_SPACE_ATTACHMENTS;
}
async function resolveSpaceComposerUploadScope(
  env: CoreBindings,
  input: SpaceAttachmentAccessInput
): Promise<{
  scope: SpaceComposerUploadScope;
  spaceAccess: SpaceAccessContext;
}> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const resolved = resolveSpaceComposerUploadScopeResponseSchema.parse(
    await stub.rpcResolveSpaceComposerUploadScope({ spaceAccess, spaceId })
  );
  return {
    scope: {
      actorProfileId: resolved.actorProfileId,
      organizationId: resolved.organizationId,
      spaceId,
    },
    spaceAccess,
  };
}
function normalizeComposerUploadNow(value: number | undefined): number {
  const nowMs = value ?? Date.now();
  if (!(Number.isInteger(nowMs) && nowMs >= 0)) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Composer upload time must be a non-negative integer.",
      status: 400,
    });
  }
  return nowMs;
}
function normalizeSpaceComposerUploadError(error: unknown): unknown {
  if (!(error instanceof SpaceComposerUploadStorageError)) {
    return normalizeSpaceFileStorageError(
      error,
      "This upload could not be processed right now."
    );
  }
  if (error.kind === "expired" || error.kind === "not_found") {
    return createCoreRpcHttpError({
      code: "space_file.not_found",
      reason: error.message,
      status: 404,
    });
  }
  if (error.kind === "conflict") {
    return createCoreRpcHttpError({
      code: "space_file.conflict",
      reason: error.message,
      status: 409,
    });
  }
  return createCoreRpcHttpError({
    code: "space_file.storage_failed",
    reason: error.message,
    status: 503,
  });
}
function assertSpaceFileObjectScope(input: {
  fileId: string;
  objectKey: string;
  organizationId: string;
  revisionId: string;
  spaceId: string;
}): void {
  const expectedObjectKey = buildSpaceFileObjectKey(input);
  if (input.objectKey !== expectedObjectKey) {
    throw createCoreRpcHttpError({
      code: "upstream_unreachable",
      reason: "Space file storage scope did not match its metadata.",
      status: 502,
    });
  }
}
function throwSpaceFileStorageFailed(reason: string): never {
  throw createCoreRpcHttpError({
    code: "space_file.storage_failed",
    reason,
    status: 503,
  });
}
function normalizeSpaceFileStorageError(
  error: unknown,
  reason: string
): unknown {
  return readCoreRpcErrorCode(error)
    ? error
    : createCoreRpcHttpError({
        code: "space_file.storage_failed",
        reason,
        status: 503,
      });
}
function buildSpaceFileContentAuditEvent(input: {
  entryId: string;
  operation: Extract<
    SpaceFileAuditEvent["operation"],
    "content_read" | "content_write"
  >;
  operationId: string;
  organizationId: string;
  revisionId: string;
  spaceAccess: SpaceAccessContext;
  spaceId: string;
}): SpaceFileAuditEvent {
  return buildSpaceFileAuditEvent({
    ...input,
    errorCode: null,
    occurredAtMs: Date.now(),
    result: "succeeded",
  });
}
async function requireSpaceAttachmentAccess(
  env: CoreBindings,
  input: SpaceAttachmentAccessInput
): Promise<{
  db: PostgresDatabase;
  organizationId: string;
  spaceId: string;
  uploaderUserId: string;
}> {
  const context = requireRpcSpaceAccessContext(input);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  let viewerMembership: SpaceViewerMembershipResponse;
  try {
    viewerMembership = await rpcGetSpaceViewerMembership(env, {
      context,
      spaceId: input.spaceId,
      ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    });
  } catch (error) {
    throwSpaceAttachmentMembershipError(error);
  }
  if (viewerMembership.spaceId !== input.spaceId) {
    throw new Error(
      `Space viewer membership scope mismatch: expected ${input.spaceId}, received ${viewerMembership.spaceId}`
    );
  }
  if (viewerMembership.activeMemberProfiles.length === 0) {
    throwSpaceAttachmentMembershipRequired();
  }
  const meta = await rpcGetSpaceMeta(env, {
    context,
    spaceId: viewerMembership.spaceId,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
  if (meta.organizationId !== activeOrganization.organizationId) {
    throw createCoreRpcHttpError({
      code: "space.organization_mismatch",
      reason: "Space does not belong to the active Organization.",
      status: 403,
    });
  }
  return {
    db: requireSpaceAttachmentDb(env),
    organizationId: activeOrganization.organizationId,
    spaceId: meta.spaceId,
    uploaderUserId: activeOrganization.userId,
  };
}
function throwSpaceAttachmentMembershipError(error: unknown): never {
  const code = readCoreRpcErrorCode(error);
  if (code === "space.password_required" || code === "space.password_invalid") {
    throwSpaceAttachmentMembershipRequired();
  }
  throw error;
}
function readCoreRpcErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && code.trim().length > 0) {
      return code.trim();
    }
  }
  if (!(error instanceof Error)) {
    return undefined;
  }
  const jsonStart = error.message.indexOf("{");
  if (jsonStart < 0) {
    return undefined;
  }
  return parseRpcErrorPayload(error.message.slice(jsonStart))?.code;
}
function throwSpaceAttachmentMembershipRequired(): never {
  throw createCoreRpcHttpError({
    code: "space.forbidden",
    reason: "You must be an active Space member to access attachments.",
    status: 403,
  });
}
function throwAttachmentNotFound(): never {
  throw createCoreRpcHttpError({
    code: "attachment_not_found",
    reason: "Space attachment was not found.",
    status: 404,
  });
}
async function resolvePostSignalAttachments(
  env: CoreBindings,
  input: SpaceAttachmentAccessInput & {
    attachments: unknown;
  }
): Promise<SpaceMessageAttachment[] | undefined> {
  if (input.attachments === undefined) {
    return undefined;
  }
  const access = await requireSpaceAttachmentAccess(env, input);
  try {
    return await resolveSpaceMessageAttachmentReferences({
      attachments: input.attachments,
      db: access.db,
      organizationId: access.organizationId,
      spaceId: access.spaceId,
    });
  } catch (error) {
    if (error instanceof SpaceAttachmentReferenceInvalidError) {
      throw createCoreRpcHttpError({
        code: "attachment_reference_invalid",
        reason: error.message,
        status: 422,
      });
    }
    throw error;
  }
}
export async function rpcListSpaceThreads(
  env: CoreBindings,
  input: ListSpaceThreadsInput
): Promise<ListSpaceThreadsResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return unwrapSpaceRpcJsonResult(
    await stub.rpcListThreadsResult({
      spaceId,
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    })
  );
}
export async function rpcGetSpaceThread(
  env: CoreBindings,
  input: GetSpaceThreadInput
): Promise<GetSpaceThreadResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return unwrapSpaceRpcJsonResult(
    await stub.rpcGetThreadResult({
      spaceId,
      threadId: input.threadId,
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    })
  );
}
export async function rpcListSpaceThreadEvents(
  env: CoreBindings,
  input: ListSpaceThreadEventsInput
): Promise<ListSpaceThreadEventsResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return unwrapSpaceRpcJsonResult(
    await stub.rpcListThreadEventsResult({
      spaceId,
      threadId: input.threadId,
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    })
  );
}
export async function rpcListSpaceThreadSignals(
  env: CoreBindings,
  input: ListSpaceThreadSignalsInput
): Promise<ListSpaceThreadSignalsResponse> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const parsedQuery = listSpaceThreadSignalsQuerySchema.safeParse({
    includeWakeContinuation: input.includeWakeContinuation,
    afterSignalId: input.afterSignalId,
    limit: input.limit,
  });
  if (!parsedQuery.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsedQuery.error.issues[0]?.message ??
        "thread signals query is invalid",
      status: 400,
    });
  }
  return unwrapSpaceRpcJsonResult(
    await stub.rpcListThreadSignalsResult({
      ...parsedQuery.data,
      spaceId,
      threadId: input.threadId,
      ...(password === undefined ? {} : { password }),
      ...(context ? { context } : {}),
      spaceAccess,
    })
  );
}
export async function rpcGetSpaceClaimTimeLiveness(
  env: CoreBindings,
  input: SpaceClaimTimeLivenessInput & {
    context?: CoreRpcContextInput;
    password?: string;
  }
): Promise<SpaceClaimTimeLivenessResult> {
  requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetClaimTimeLiveness({
    ...(input.expectedContractVersion === undefined
      ? {}
      : { expectedContractVersion: input.expectedContractVersion }),
    ...(input.expectedDispatchRuleSetVersion === undefined
      ? {}
      : {
          expectedDispatchRuleSetVersion: input.expectedDispatchRuleSetVersion,
        }),
    ...(input.expectedMemberUpdatedAtMs === undefined
      ? {}
      : { expectedMemberUpdatedAtMs: input.expectedMemberUpdatedAtMs }),
    nowMs: input.nowMs,
    relation: input.relation,
    ...(input.sourceClientMessageId === undefined
      ? {}
      : { sourceClientMessageId: input.sourceClientMessageId }),
    ...(input.sourceSignalId === undefined
      ? {}
      : { sourceSignalId: input.sourceSignalId }),
    spaceId,
    targetProfileId: input.targetProfileId,
  });
}
export async function rpcGetSpaceDispatchTrace(
  env: CoreBindings,
  input: GetSpaceDispatchTraceInput
): Promise<SpaceDispatchTraceResponse> {
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const dispatchId = String(input.dispatchId ?? "").trim();
  if (dispatchId.length === 0) {
    throw new Error("dispatchId is required");
  }
  const response = await stub.rpcGetDispatchTrace({
    spaceId,
    dispatchId,
    ...(input.includeRemoteAgentRuntimeDiagnostics === true
      ? { includeRemoteAgentRuntimeDiagnostics: true }
      : {}),
    ...(input.responseContractVersion === undefined
      ? {}
      : { responseContractVersion: input.responseContractVersion }),
    ...access,
  });
  if (input.includeServiceConnectionDiagnostics !== true) {
    return response;
  }
  const diagnostics = await readOwnerServiceConnectionTrace({
    env,
    ownerUserId: input.context?.actorContext.ownerUserId,
    execution: response.trace?.runtimeCoordinatorExecution ?? null,
  });
  return diagnostics
    ? { ...response, serviceConnectionDiagnostics: diagnostics }
    : response;
}
export async function rpcInspectExecutionRecovery(
  env: CoreBindings,
  input: InspectExecutionRecoveryInput
): Promise<InspectExecutionRecoveryResponse> {
  const conversationId = normalizeSpaceId(input.spaceId);
  if (!isHexSpaceId(conversationId)) {
    const hosted = await resolveHostedExecutionRecoveryRoute(env, {
      context: input.context,
      conversationId,
      dispatchId: input.dispatchId,
    });
    return await hosted.stub.rpcInspectHostedExecutionRecovery({
      activeOrganizationId: hosted.activeOrganizationId,
      conversationId,
      dispatchId: hosted.delivery.dispatchId,
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, conversationId);
  const dispatchId = String(input.dispatchId ?? "").trim();
  if (!dispatchId) {
    throw createCoreRpcHttpError({
      code: "execution_recovery.dispatch_id_required",
      reason: "dispatchId is required",
      status: 400,
    });
  }
  return await stub.rpcInspectExecutionRecovery({
    dispatchId,
    spaceId,
    ...access,
  });
}
export async function rpcExecuteExecutionRecovery(
  env: CoreBindings,
  input: ExecuteExecutionRecoveryInput
): Promise<ExecuteExecutionRecoveryResponse> {
  const conversationId = normalizeSpaceId(input.spaceId);
  if (!isHexSpaceId(conversationId)) {
    const hosted = await resolveHostedExecutionRecoveryRoute(env, {
      context: input.context,
      conversationId,
      dispatchId: input.body.expectedIdentity.dispatchId,
    });
    return await hosted.stub.rpcExecuteHostedExecutionRecovery({
      activeOrganizationId: hosted.activeOrganizationId,
      body: input.body,
      conversationId,
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, conversationId);
  return await stub.rpcExecuteExecutionRecovery({
    body: input.body,
    spaceId,
    ...access,
  });
}
async function resolveHostedExecutionRecoveryRoute(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    conversationId: string;
    dispatchId: string;
  }
) {
  const context = requireRpcContext(input.context);
  const activeOrganizationId = context.activeOrganizationId?.trim();
  const conversationId = input.conversationId.trim();
  const dispatchId = input.dispatchId.trim();
  if (!(activeOrganizationId && conversationId && dispatchId)) {
    throw createCoreRpcHttpError({
      code: "execution_recovery.execution_not_found",
      reason: "The requested execution could not be found.",
      status: 404,
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "execution_recovery.storage_unavailable",
      reason: "Execution recovery storage is unavailable.",
      status: 503,
    });
  }
  const delivery = await readRemoteAgentNativeDeliveryByDispatchAndConversation(
    {
      conversationId,
      db,
      dispatchId,
    }
  );
  if (
    !delivery ||
    delivery.conversationKind === "space" ||
    delivery.organizationId !== activeOrganizationId
  ) {
    throw createCoreRpcHttpError({
      code: "execution_recovery.execution_not_found",
      reason: "The requested execution could not be found.",
      status: 404,
    });
  }
  return {
    activeOrganizationId,
    delivery,
    stub: resolveRuntimeTransportExecutionRecoveryShard(
      env,
      delivery.deliveryId
    ),
  };
}
export async function rpcGetSpaceDispatchLookup(
  env: CoreBindings,
  input: GetSpaceDispatchLookupInput
): Promise<GetSpaceDispatchLookupResponse> {
  const parsed = getSpaceDispatchLookupInputSchema.safeParse({
    spaceId: input.spaceId,
    sourceSignalId: input.sourceSignalId,
    clientMessageId: input.clientMessageId,
    ...(input.targetProfileId === undefined
      ? {}
      : { targetProfileId: input.targetProfileId }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space dispatch lookup input is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcGetDispatchLookup({
    spaceId,
    ...(parsed.data.sourceSignalId
      ? { sourceSignalId: parsed.data.sourceSignalId }
      : {}),
    ...(parsed.data.clientMessageId
      ? { clientMessageId: parsed.data.clientMessageId }
      : {}),
    ...(parsed.data.targetProfileId
      ? { targetProfileId: parsed.data.targetProfileId }
      : {}),
    ...access,
  });
}
export async function rpcGetSpaceWakeProgress(
  env: CoreBindings,
  input: GetSpaceWakeProgressInput
): Promise<GetSpaceWakeProgressResponse> {
  const parsed = getSpaceWakeProgressInputSchema.safeParse({
    spaceId: input.spaceId,
    clientMessageId: input.clientMessageId,
    includeDeviceWait: input.includeDeviceWait,
    ...(input.includeTiming === undefined
      ? {}
      : { includeTiming: input.includeTiming }),
    ...(input.includePreviewText === undefined
      ? {}
      : { includePreviewText: input.includePreviewText }),
    ...(input.includeReplyPlacement === undefined
      ? {}
      : { includeReplyPlacement: input.includeReplyPlacement }),
    ...(input.includeSourceContext === undefined
      ? {}
      : { includeSourceContext: input.includeSourceContext }),
    ...(input.includeWaitReason === undefined
      ? {}
      : { includeWaitReason: input.includeWaitReason }),
    ...(input.includeWakeStopEligibility === undefined
      ? {}
      : { includeWakeStopEligibility: input.includeWakeStopEligibility }),
    ...(input.targetProfileId === undefined
      ? {}
      : { targetProfileId: input.targetProfileId }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space wake progress input is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcGetWakeProgress({
    spaceId,
    clientMessageId: parsed.data.clientMessageId,
    includeDeviceWait: parsed.data.includeDeviceWait,
    ...(parsed.data.includeTiming === undefined
      ? {}
      : { includeTiming: parsed.data.includeTiming }),
    ...(parsed.data.includePreviewText === undefined
      ? {}
      : { includePreviewText: parsed.data.includePreviewText }),
    ...(parsed.data.includeReplyPlacement === undefined
      ? {}
      : { includeReplyPlacement: parsed.data.includeReplyPlacement }),
    ...(parsed.data.includeSourceContext === undefined
      ? {}
      : { includeSourceContext: parsed.data.includeSourceContext }),
    ...(parsed.data.includeWaitReason === undefined
      ? {}
      : { includeWaitReason: parsed.data.includeWaitReason }),
    ...(parsed.data.includeWakeStopEligibility === undefined
      ? {}
      : { includeWakeStopEligibility: parsed.data.includeWakeStopEligibility }),
    ...(parsed.data.targetProfileId
      ? { targetProfileId: parsed.data.targetProfileId }
      : {}),
    ...access,
  });
}
export async function rpcGetActiveSpaceWakeProgress(
  env: CoreBindings,
  input: GetActiveSpaceWakeProgressInput
): Promise<GetActiveSpaceWakeProgressResponse> {
  const parsed = getActiveSpaceWakeProgressInputSchema.safeParse({
    spaceId: input.spaceId,
    includeDeviceWait: input.includeDeviceWait,
    ...(input.includePageInfo === undefined
      ? {}
      : { includePageInfo: input.includePageInfo }),
    ...(input.includeTiming === undefined
      ? {}
      : { includeTiming: input.includeTiming }),
    ...(input.includePreviewText === undefined
      ? {}
      : { includePreviewText: input.includePreviewText }),
    ...(input.includeReplyPlacement === undefined
      ? {}
      : { includeReplyPlacement: input.includeReplyPlacement }),
    ...(input.includeSourceContext === undefined
      ? {}
      : { includeSourceContext: input.includeSourceContext }),
    ...(input.includeWaitReason === undefined
      ? {}
      : { includeWaitReason: input.includeWaitReason }),
    ...(input.includeWakeStopEligibility === undefined
      ? {}
      : { includeWakeStopEligibility: input.includeWakeStopEligibility }),
    ...(input.sourceProfileId === undefined
      ? {}
      : { sourceProfileId: input.sourceProfileId }),
    ...(input.targetProfileId === undefined
      ? {}
      : { targetProfileId: input.targetProfileId }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "active space wake progress input is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcGetActiveWakeProgress({
    spaceId,
    includeDeviceWait: parsed.data.includeDeviceWait,
    ...(parsed.data.includePageInfo === undefined
      ? {}
      : { includePageInfo: parsed.data.includePageInfo }),
    ...(parsed.data.includeTiming === undefined
      ? {}
      : { includeTiming: parsed.data.includeTiming }),
    ...(parsed.data.includePreviewText === undefined
      ? {}
      : { includePreviewText: parsed.data.includePreviewText }),
    ...(parsed.data.includeReplyPlacement === undefined
      ? {}
      : { includeReplyPlacement: parsed.data.includeReplyPlacement }),
    ...(parsed.data.includeSourceContext === undefined
      ? {}
      : { includeSourceContext: parsed.data.includeSourceContext }),
    ...(parsed.data.includeWaitReason === undefined
      ? {}
      : { includeWaitReason: parsed.data.includeWaitReason }),
    ...(parsed.data.includeWakeStopEligibility === undefined
      ? {}
      : { includeWakeStopEligibility: parsed.data.includeWakeStopEligibility }),
    ...(parsed.data.sourceProfileId
      ? { sourceProfileId: parsed.data.sourceProfileId }
      : {}),
    ...(parsed.data.targetProfileId
      ? { targetProfileId: parsed.data.targetProfileId }
      : {}),
    ...access,
  });
}
export async function rpcPostSpaceWakeStop(
  env: CoreBindings,
  input: PostSpaceWakeStopInput
): Promise<PostSpaceWakeStopResponse> {
  const parsed = postSpaceWakeStopInputSchema.safeParse({
    spaceId: input.spaceId,
    body: input.body,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ?? "space wake stop input is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcPostWakeStop({
    spaceId,
    body: parsed.data.body,
    ...access,
  });
}
export async function rpcRespondToSpaceAgentInteraction(
  env: CoreBindings,
  input: RespondToSpaceAgentInteractionInput
): Promise<RespondToSpaceAgentInteractionResponse> {
  const parsed = respondToSpaceAgentInteractionInputSchema.safeParse({
    body: input.body,
    spaceId: input.spaceId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space agent interaction response is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcRespondToAgentInteraction({
    body: parsed.data.body,
    spaceId,
    ...access,
  });
}
export async function rpcGetSpaceWakeTraceWaterfall(
  env: CoreBindings,
  input: GetSpaceWakeTraceWaterfallInput
): Promise<GetSpaceWakeTraceWaterfallResponse> {
  const parsed = getSpaceWakeTraceWaterfallInputSchema.safeParse({
    spaceId: input.spaceId,
    sourceSignalId: input.sourceSignalId,
    clientMessageId: input.clientMessageId,
    ...(input.targetProfileId === undefined
      ? {}
      : { targetProfileId: input.targetProfileId }),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space wake trace waterfall input is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  return await stub.rpcGetWakeTraceWaterfall({
    spaceId,
    ...(parsed.data.clientMessageId
      ? { clientMessageId: parsed.data.clientMessageId }
      : {}),
    ...(parsed.data.sourceSignalId
      ? { sourceSignalId: parsed.data.sourceSignalId }
      : {}),
    ...(parsed.data.targetProfileId
      ? { targetProfileId: parsed.data.targetProfileId }
      : {}),
    ...access,
  });
}
export async function rpcGetSpaceLinkPreviews(
  env: CoreBindings,
  input: GetSpaceMessageDetailsInput
) {
  const { getSpaceLinkPreviewsInputSchema, spaceMessageLinksSchema } =
    await import("@openmeld/schemas");
  const parsed = getSpaceLinkPreviewsInputSchema.safeParse({
    spaceId: input.spaceId,
    signalId: input.signalId,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid message link preview request.",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  const source = spaceMessageLinksSchema.parse(
    await stub.rpcGetMessageLinks({ ...parsed.data, ...access })
  );
  const { readLinkPreview } = await import(
    "../space/application/link-preview-fetch"
  );
  const previews: import("@openmeld/schemas").LinkPreview[] = [];
  for (let offset = 0; offset < source.urls.length; offset += 3) {
    previews.push(
      ...(await Promise.all(
        source.urls
          .slice(offset, offset + 3)
          .map((url) => readLinkPreview(spaceId, url))
      ))
    );
  }
  // An edit, recall, or access change during external I/O invalidates the result.
  const current = spaceMessageLinksSchema.parse(
    await stub.rpcGetMessageLinks({ ...parsed.data, ...access })
  );
  return {
    signalId: source.signalId,
    revision: current.revision,
    previews: current.revision === source.revision ? previews : [],
  };
}
export async function rpcReadPluginActionRequestLocations(
  env: CoreBindings,
  input: import("zod/v4").infer<
    typeof import("@openmeld/schemas").listPluginActionRequestsInputSchema
  >
) {
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcReadPluginActionRequestLocations({
    ...input,
    spaceId,
    spaceAccess: resolveRpcSpaceAccess(input),
  });
}
export async function rpcGetSpaceMessageDetails(
  env: CoreBindings,
  input: GetSpaceMessageDetailsInput
): Promise<GetSpaceMessageDetailsResponse> {
  const parsed = getSpaceMessageDetailsInputSchema.safeParse({
    includeThreadContext: input.includeThreadContext,
    delegationVersion: input.delegationVersion,
    delegationCursor: input.delegationCursor,
    spaceId: input.spaceId,
    signalId: input.signalId,
    ...(input.executionContextVersion
      ? { executionContextVersion: input.executionContextVersion }
      : {}),
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "space message details input is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(
    env,
    parsed.data.spaceId
  );
  const details = await stub.rpcGetMessageDetails({
    includeThreadContext: parsed.data.includeThreadContext,
    spaceId,
    signalId: parsed.data.signalId,
    ...(parsed.data.executionContextVersion
      ? { executionContextVersion: parsed.data.executionContextVersion }
      : {}),
    ...access,
  });
  if (parsed.data.delegationVersion !== 1) {
    return details;
  }
  const { readSpaceMessageDelegations } = await import(
    "../space/application/space-message-delegations"
  );
  const delegations = await readSpaceMessageDelegations({
    db: requireAgentTaskCoordinationDb(env),
    details,
    after: parsed.data.delegationCursor,
    readTarget: async (childSpaceId, profileId) => {
      const directory = await rpcGetSpaceIdentityDirectory(env, {
        spaceId: childSpaceId,
        ...(childSpaceId === spaceId ? access : { context: access.context }),
      });
      return (
        directory.entries.find(
          (entry) =>
            entry.profileId === profileId && entry.profileKind === "agent"
        )?.profileName ?? null
      );
    },
    readMessage: async (childSpaceId, signalId) => {
      const child = resolveRpcSpaceStubOrThrow(env, childSpaceId);
      return await child.stub.rpcGetMessageDetails({
        spaceId: child.spaceId,
        signalId,
        executionContextVersion: 1,
        // Source-Space passwords and continuation grants never authorize another Space.
        ...(child.spaceId === spaceId ? access : { context: access.context }),
      });
    },
    readProgress: async (childSpaceId, clientMessageId, targetProfileId) => {
      return await rpcGetSpaceWakeProgress(env, {
        spaceId: childSpaceId,
        clientMessageId,
        targetProfileId,
        includeSourceContext: true,
        includeWakeStopEligibility: true,
        ...(childSpaceId === spaceId ? access : { context: access.context }),
      });
    },
  });
  return { ...details, delegations };
}
export async function rpcCreateSpaceDiagnosticReport(
  env: CoreBindings,
  input: CreateSpaceDiagnosticReportInput
): Promise<CreateSpaceDiagnosticReportResponse> {
  const parsedBody = createSpaceDiagnosticReportBodySchema.safeParse(
    input.body
  );
  if (!parsedBody.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason:
        parsedBody.error.issues[0]?.message ??
        "space diagnostic report input is invalid",
    });
  }
  const access = resolveRpcSpaceAccessForwarding(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcCreateDiagnosticReport({
    spaceId,
    body: parsedBody.data,
    ...access,
  });
}
export async function rpcAddSpaceMembers(
  env: CoreBindings,
  input: AddSpaceMembersInput
): Promise<PostSpaceMembersResponse> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const members = await resolveSpaceMembersWithAgentOwners({
    context,
    env,
    members: input.members,
    ...(input.password === undefined ? {} : { password: input.password }),
    spaceId,
    stub,
  });
  await assertAdditionalMembersCanBeAddedToSpace({
    env,
    members,
    spaceId,
  });
  return await stub.rpcPostMembers({
    spaceId,
    members,
    ...(input.requireActorMembership === true
      ? { requireActorMembership: true }
      : {}),
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
async function resolveSpaceMembersWithAgentOwners(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
  expandAgentOwnersInDirectMessageConversion?: boolean;
  members: readonly ResolvedSpaceMemberProfile[];
  password?: string;
  spaceId: string;
  stub: SpaceRpcStub;
}): Promise<ResolvedSpaceMemberProfile[]> {
  const spaceMeta = await readSpaceMetaForMemberResolution(input);
  const identityDb = requireIdentityDb(input.env);
  const profileContexts = await readSpaceMemberProfileContexts({
    db: identityDb,
    members: input.members,
    spaceId: input.spaceId,
  });
  assertSpaceMemberProfileContexts({
    members: input.members,
    profileContexts,
    spaceOrganizationId: spaceMeta.organizationId,
  });
  if (
    spaceMeta.purpose === OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE &&
    !spaceMeta.directMessage?.convertedAt &&
    input.expandAgentOwnersInDirectMessageConversion !== true
  ) {
    return [...input.members];
  }
  if (
    isMemberAgentsEnabled() &&
    input.expandAgentOwnersInDirectMessageConversion !== true
  ) {
    await rejectNonOwnerPersonalAgentAdditions({
      db: identityDb,
      members: input.members,
      organizationId: spaceMeta.organizationId,
      rootUserId: normalizeOptionalText(input.context.actorContext.ownerUserId),
    });
  }
  const ownerHumans = await resolveAgentOwnerHumanMembers({
    db: identityDb,
    members: input.members,
    organizationId: spaceMeta.organizationId,
    profileContexts,
  });
  const seenProfileIds = new Set<string>();
  return [...input.members, ...ownerHumans].filter((member) => {
    if (seenProfileIds.has(member.profileId)) {
      return false;
    }
    seenProfileIds.add(member.profileId);
    return true;
  });
}
/**
 * Only the owner adds their own Agent (with themselves, atomically). Anyone
 * else asks the owner instead (design-plans/member-agent-program.md §4.6),
 * and a caller without a human root, such as the Center Agent, cannot add
 * another owner's Agent at all.
 */
async function rejectNonOwnerPersonalAgentAdditions(input: {
  db: PostgresDatabase;
  members: readonly ResolvedSpaceMemberProfile[];
  organizationId: string;
  rootUserId: string | null;
}): Promise<void> {
  const targets = await readAgentAccessTargets({
    db: asQueryable(input.db),
    organizationId: input.organizationId,
    profileIds: input.members
      .filter((member) => member.profileKind === "agent")
      .map((member) => member.profileId),
  });
  for (const target of targets.values()) {
    if (target.ownerUserId === input.rootUserId) {
      continue;
    }
    throw createCoreRpcHttpError({
      status: 409,
      code: "agent_access.request_required",
      reason: `Only ${target.ownerName} can add ${target.profileName}. Ask them from Add members or by mentioning it.`,
    });
  }
}
async function readSpaceMetaForMemberResolution(input: {
  context: CoreRpcContextInput;
  password?: string;
  spaceId: string;
  stub: SpaceRpcStub;
}): Promise<SpaceMeta> {
  try {
    return await input.stub.rpcGetMeta({
      context: input.context,
      ...(input.password === undefined ? {} : { password: input.password }),
      spaceId: input.spaceId,
    });
  } catch (error) {
    const status = readCoreRpcHttpStatus(error);
    if (status !== null && status < 500) {
      throw error;
    }
    console.error("[core.space_member.organization_lookup_failed]", {
      event: "core.space_member.organization_lookup_failed",
      error: toErrorMessage(error),
      spaceId: input.spaceId,
    });
    throw createCoreRpcHttpError({
      code: "space.organization_lookup_failed",
      reason: "Space workspace could not be verified.",
      status: 503,
    });
  }
}
async function readSpaceMemberProfileContexts(input: {
  db: PostgresDatabase;
  members: readonly ResolvedSpaceMemberProfile[];
  spaceId: string;
}): Promise<readonly (AgentProfileOrganizationContext | null)[]> {
  return await Promise.all(
    input.members.map(async (member) => {
      try {
        return await readAgentProfileOrganizationContext({
          agentProfileId: member.profileId,
          db: input.db,
        });
      } catch (error) {
        console.error("[core.space_member.agent_profile_lookup_failed]", {
          event: "core.space_member.agent_profile_lookup_failed",
          error: toErrorMessage(error),
          profileId: member.profileId,
          spaceId: input.spaceId,
        });
        throw createCoreRpcHttpError({
          code: "agent_profile.organization_lookup_failed",
          reason: "Agent Profile workspace could not be verified.",
          status: 503,
        });
      }
    })
  );
}
function assertSpaceMemberProfileContexts(input: {
  members: readonly ResolvedSpaceMemberProfile[];
  profileContexts: readonly (AgentProfileOrganizationContext | null)[];
  spaceOrganizationId: string;
}): void {
  for (const [index, member] of input.members.entries()) {
    const profileContext = input.profileContexts[index] ?? null;
    if (!profileContext) {
      if (member.profileKind === "agent") {
        throw createCoreRpcHttpError({
          code: "agent_profile.not_found",
          reason: "Agent Profile was not found.",
          status: 404,
        });
      }
      continue;
    }
    if (member.profileKind !== profileContext.profileKind) {
      throw createCoreRpcHttpError({
        code: "space.member_profile_kind_mismatch",
        reason: "Space member profile kind does not match canonical identity.",
        status: 409,
      });
    }
    if (profileContext.profileKind !== "agent") {
      continue;
    }
    if (
      isAgentProfileEligibleForOrganization({
        managedRole: profileContext.managedRole,
        profileOrganizationId: profileContext.organizationId,
        targetOrganizationId: input.spaceOrganizationId,
      })
    ) {
      continue;
    }
    throw createCoreRpcHttpError({
      code: "agent_profile.organization_mismatch",
      reason:
        "Agent Profile can only join Spaces in the workspace where it was created.",
      status: 403,
    });
  }
}
async function resolveAgentOwnerHumanMembers(input: {
  db: PostgresDatabase;
  members: readonly ResolvedSpaceMemberProfile[];
  organizationId: string;
  profileContexts: readonly (AgentProfileOrganizationContext | null)[];
}): Promise<readonly ResolvedSpaceMemberProfile[]> {
  const designation = await readCenterAgentDesignationRecord({
    db: input.db,
    organizationId: input.organizationId,
  });
  const ownerUserIds = new Set<string>();
  for (const [index, member] of input.members.entries()) {
    const profileContext = input.profileContexts[index] ?? null;
    if (
      member.profileKind === "agent" &&
      profileContext?.profileKind === "agent" &&
      profileContext.ownerUserId &&
      profileContext.managedRole === null &&
      member.profileId !== designation?.agentProfileId
    ) {
      ownerUserIds.add(profileContext.ownerUserId);
    }
  }
  return await Promise.all(
    [...ownerUserIds].map(async (ownerUserId) => {
      const ownerHuman = await readResolvedOrganizationOwnerHumanSpaceMember({
        db: input.db,
        organizationId: input.organizationId,
        ownerUserId,
      });
      if (!ownerHuman) {
        throw createCoreRpcHttpError({
          code: "agent_profile.owner_human_unavailable",
          reason:
            "Agent Profile owner must have an active Human Profile in this Organization.",
          status: 409,
        });
      }
      return ownerHuman;
    })
  );
}
export async function rpcRemoveSpaceMembers(
  env: CoreBindings,
  input: RemoveSpaceMembersInput
): Promise<RemoveSpaceMembersResponse> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await assertCenterAgentDirectMessageMutationAllowed({
    env,
    reason: "Center Agent Direct Messages cannot remove members.",
    spaceId,
  });
  return await stub.rpcRemoveMembers({
    spaceId,
    memberProfileIds: input.memberProfileIds,
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcLeaveSpace(
  env: CoreBindings,
  input: LeaveSpaceInput
): Promise<LeaveSpaceResponse> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await assertCenterAgentDirectMessageMutationAllowed({
    env,
    reason: "Center Agent Direct Messages cannot be left.",
    spaceId,
  });
  return await stub.rpcLeaveSpace({
    spaceId,
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcUpdateSpaceCursor(
  env: CoreBindings,
  input: UpdateSpaceCursorInput
): Promise<SpaceCursor> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const profileId = String(input.profileId ?? "").trim();
  if (profileId.length === 0) {
    throw new Error("profileId is required");
  }
  const cursorPatch = normalizeSpaceCursorPatch({
    ...(typeof input.lastSeenTs === "number"
      ? { lastSeenTs: input.lastSeenTs }
      : {}),
    ...(typeof input.role === "string" ? { role: input.role } : {}),
    ...(typeof input.mentionAlias === "string"
      ? { mentionAlias: input.mentionAlias }
      : {}),
  });
  if (!cursorPatch.ok) {
    throw new Error(cursorPatch.message);
  }
  return await stub.rpcPatchCursor({
    spaceId,
    profileId,
    ...cursorPatch.value,
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}
export async function rpcUpsertSpacePassword(
  env: CoreBindings,
  input: UpsertSpacePasswordInput
): Promise<SpacePasswordStateResult> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await assertCenterAgentDirectMessageMutationAllowed({
    env,
    reason: "Center Agent Direct Messages cannot change access passwords.",
    spaceId,
  });
  return await stub.rpcUpsertPassword({
    spaceId,
    password: input.password,
    context,
  });
}
export async function rpcClearSpacePassword(
  env: CoreBindings,
  input: ClearSpacePasswordInput
): Promise<SpacePasswordStateResult> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await assertCenterAgentDirectMessageMutationAllowed({
    env,
    reason: "Center Agent Direct Messages cannot change access passwords.",
    spaceId,
  });
  return await stub.rpcClearPassword({
    spaceId,
    context,
  });
}
export async function rpcSetSpaceAccessMode(
  env: CoreBindings,
  input: SetSpaceAccessModeInput
): Promise<SpaceAccessModeStateResult> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await assertCenterAgentDirectMessageMutationAllowed({
    env,
    reason: "Center Agent Direct Messages cannot change access settings.",
    spaceId,
  });
  return await stub.rpcSetAccessMode({
    spaceId,
    accessMode: input.accessMode,
    ...(input.allowGuests === undefined
      ? {}
      : { allowGuests: input.allowGuests }),
    ...(input.linkJoinPolicy === undefined
      ? {}
      : { linkJoinPolicy: input.linkJoinPolicy }),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    context,
  });
}
export function resolveRpcSpaceStubOrThrow(
  env: CoreBindings,
  rawSpaceId: string
): {
  spaceId: string;
  stub: SpaceRpcStub;
} {
  const spaceId = normalizeSpaceId(rawSpaceId);
  if (!isHexSpaceId(spaceId)) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "invalid space id: expected 64-char hex id",
      code: "invalid_space_id",
    });
  }
  const stub = resolveSpaceStub(env.OPENMELD_SPACES, spaceId);
  if (!stub) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "space not found",
      code: "space.not_found",
    });
  }
  return {
    spaceId,
    stub: stub as unknown as SpaceRpcStub,
  };
}
async function postFormalSignalWithFetch(input: {
  stub: SpaceRpcStub;
  path: "/rpc/signals/status" | "/rpc/signals/system-notice";
  context: CoreRpcContextInput;
  password?: string;
  body: {
    profile: Profile;
    data: SignalStatusData | SignalSystemNoticeData;
    finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
    threadContext?: SpaceThreadContext;
  };
}): Promise<SignalEnvelope> {
  const response = await input.stub.fetch(
    buildSpaceRpcRequest({
      path: input.path,
      method: "POST",
      context: input.context,
      ...(input.password === undefined
        ? {}
        : { spacePassword: input.password }),
      body: input.body,
    })
  );
  return await readSpaceRpcJsonOrThrow(response);
}
function normalizeSpaceId(value: string): string {
  return String(value ?? "").trim();
}
function resolveCenterAgentDirectMessageSpaceId(
  namespace: DurableObjectNamespace<Space>,
  input: {
    centerAgentProfileId: string;
    memberProfileId: string;
    organizationId: string;
  }
): string {
  const name = [
    "center-agent-dm-v1",
    input.organizationId,
    input.memberProfileId,
    input.centerAgentProfileId,
  ].join(":");
  return resolveNamedSpaceId(namespace, name).toString();
}
function resolveDirectMessageSpaceId(
  namespace: DurableObjectNamespace<Space>,
  input: {
    generation: number;
    organizationId: string;
    pairKey: string;
  }
): string {
  const name = [
    "dm-v1",
    input.organizationId,
    input.pairKey,
    String(input.generation),
  ].join(":");
  return resolveNamedSpaceId(namespace, name).toString();
}
async function createSpaceWithResolvedId(
  env: CoreBindings,
  input: {
    spaceId: string;
    initialOwnerMember?: ResolvedSpaceMemberProfile;
    name?: string;
    purpose?: string;
    guide?: string;
    accessMode?: SpaceAccessMode;
    organizationId: string;
    password?: string;
    visibility: "public" | "private";
    context?: CoreRpcContextInput;
  }
): Promise<CreateSpaceResult> {
  const context = requireRpcContext(input.context);
  const normalizedSpaceId = normalizeSpaceId(input.spaceId);
  if (!isHexSpaceId(normalizedSpaceId)) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "invalid space id: expected 64-char hex id",
      code: "invalid_payload",
    });
  }
  const stub = resolveSpaceStub(env.OPENMELD_SPACES, normalizedSpaceId);
  if (!stub) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "invalid space id: OpenMeld couldn't resolve the durable object",
      code: "invalid_payload",
    });
  }
  const creator = toSpaceCreator(context);
  const spaceStub = stub as unknown as SpaceRpcStub;
  const password = input.password;
  if (password !== undefined) {
    const meta = await initializeSpaceWithOwnerRecovery({
      env,
      organizationId: input.organizationId,
      ownerUserId: input.initialOwnerMember?.ownerUserId,
      spaceId: normalizedSpaceId,
      initialize: () =>
        spaceStub.rpcPatchMetaWithPasswordAtomic({
          spaceId: normalizedSpaceId,
          ...(input.name ? { name: input.name } : {}),
          ...(typeof input.purpose === "string"
            ? { purpose: input.purpose }
            : {}),
          creator,
          ...(typeof input.guide === "string" ? { guide: input.guide } : {}),
          accessMode: input.accessMode ?? "protected",
          organizationId: input.organizationId,
          password,
          visibility: input.visibility,
          context,
          ...(input.initialOwnerMember
            ? { initialOwnerMember: input.initialOwnerMember }
            : {}),
        }),
    });
    return { spaceId: normalizedSpaceId, meta };
  }
  const meta = await initializeSpaceWithOwnerRecovery({
    env,
    organizationId: input.organizationId,
    ownerUserId: input.initialOwnerMember?.ownerUserId,
    spaceId: normalizedSpaceId,
    initialize: () =>
      spaceStub.rpcPatchMeta({
        spaceId: normalizedSpaceId,
        ...(input.initialOwnerMember
          ? { initialOwnerMember: input.initialOwnerMember }
          : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(typeof input.purpose === "string"
          ? { purpose: input.purpose }
          : {}),
        creator,
        ...(typeof input.guide === "string" ? { guide: input.guide } : {}),
        ...(input.accessMode === undefined
          ? {}
          : { accessMode: input.accessMode }),
        initializeIfAbsent: true,
        organizationId: input.organizationId,
        visibility: input.visibility,
        context,
      }),
  });
  return {
    spaceId: normalizedSpaceId,
    meta,
  };
}
async function initializeSpaceWithOwnerRecovery(input: {
  env: CoreBindings;
  organizationId: string;
  ownerUserId?: string | null;
  spaceId: string;
  initialize: () => Promise<SpaceMeta>;
}): Promise<SpaceMeta> {
  try {
    return await input.initialize();
  } catch (error) {
    if (!input.ownerUserId) {
      throw error;
    }
    try {
      // A new Space RPC runs after the failed call's DO reset. Its existing
      // serial check retains protection if Space metadata did commit.
      const recoveryStub = resolveSpaceStub(
        input.env.OPENMELD_SPACES,
        input.spaceId
      );
      if (!recoveryStub) {
        throw new Error("Couldn't resolve Space owner protection recovery.");
      }
      await recoveryStub.rpcCheckSpaceOwnerDeparture({
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        userId: input.ownerUserId,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Space creation failed and owner protection could not be verified or cleaned up."
      );
    }
    throw error;
  }
}
function normalizeCreateSpaceName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length > MAX_SPACE_NAME_LENGTH) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid name: too long",
      code: "invalid_create_payload",
    });
  }
  return normalized.length > 0 ? normalized : undefined;
}
function normalizeCreateSpaceGuide(
  input?: CreateSpaceInput
): string | undefined {
  if (!(input && Object.hasOwn(input, "guide"))) {
    return undefined;
  }
  if (typeof input.guide !== "string") {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid guide",
      code: "invalid_create_payload",
    });
  }
  const normalized = input.guide.trim();
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid guide",
      code: "invalid_create_payload",
    });
  }
  return normalized;
}
function normalizeCreateSpacePurpose(
  input?: CreateSpaceInput
): string | undefined {
  if (!(input && Object.hasOwn(input, "purpose"))) {
    return undefined;
  }
  if (typeof input.purpose !== "string") {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid purpose",
      code: "invalid_create_payload",
    });
  }
  const normalized = input.purpose.trim();
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid purpose",
      code: "invalid_create_payload",
    });
  }
  return normalized;
}
function normalizeCreateSpacePassword(
  input?: CreateSpaceInput
): string | undefined {
  if (!(input && Object.hasOwn(input, "password"))) {
    return undefined;
  }
  if (typeof input.password !== "string") {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid password",
      code: "invalid_create_payload",
    });
  }
  return normalizeSpacePasswordText(input.password);
}
function normalizeCreateSpaceAccessMode(
  input?: CreateSpaceInput
): SpaceAccessMode | undefined {
  if (!(input && Object.hasOwn(input, "accessMode"))) {
    return undefined;
  }
  const parsed = spaceAccessModeSchema.safeParse(input.accessMode);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid accessMode",
      code: "invalid_create_payload",
    });
  }
  return parsed.data;
}
function normalizeCreateSpaceVisibility(
  input?: CreateSpaceInput
): "public" | "private" {
  if (!(input && Object.hasOwn(input, "visibility"))) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Visibility required",
      code: "invalid_create_payload",
    });
  }
  if (input.visibility !== "public" && input.visibility !== "private") {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid visibility",
      code: "invalid_create_payload",
    });
  }
  return input.visibility;
}
function validateCreateSpaceAccessModePasswordContract(input: {
  accessMode: SpaceAccessMode | undefined;
  password: string | undefined;
}): void {
  const accessModeUsesPassword =
    input.accessMode === "public_view_join_password" ||
    input.accessMode === "protected";
  if (
    input.accessMode !== undefined &&
    !accessModeUsesPassword &&
    input.password !== undefined
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Password cannot be set for this access",
      code: "invalid_create_payload",
    });
  }
  if (
    input.accessMode !== undefined &&
    accessModeUsesPassword &&
    input.password === undefined
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Password required for this access",
      code: "invalid_create_payload",
    });
  }
}
function assertValidCreateSpaceInput(input?: CreateSpaceInput): void {
  if (input === undefined) {
    return;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid create payload: expected object",
      code: "invalid_create_payload",
    });
  }
  const unknownFields = Object.keys(input).filter(
    (key) => !CREATE_SPACE_ALLOWED_FIELDS.has(key)
  );
  if (unknownFields.length > 0) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: `Invalid create payload: unknown field "${unknownFields[0]}"`,
      code: "invalid_create_payload",
    });
  }
}
function normalizeStringArray(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized.length > 0) {
      deduped.add(normalized);
    }
  }
  return [...deduped];
}
function buildCurrentDeviceTargetStore(env: CoreBindings) {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "current device target store is unavailable",
    });
  }
  return {
    readCurrentDeviceTarget: async (input: { userId: string }) =>
      await resolveCurrentDeviceFromBindings({
        db,
        userId: input.userId,
      }),
    readOwnedDevices: async (input: { userId: string }) => {
      const registryRows = await listOwnedDeviceRegistryRecords({
        db,
        userId: input.userId,
      });
      return registryRows.map((row) => ({
        deviceId: row.deviceId,
        connectedComputerId: row.connectedComputerId,
        userDisplayName: row.userDisplayName,
        observedDisplayName: row.observedDisplayName,
        platformFamily: row.platformFamily,
        osVersion: row.osVersion,
        deviceType: row.deviceType,
        firstSeenAtMs: row.firstSeenAtMs,
        lastObservedAtMs: row.lastObservedAtMs,
      }));
    },
    readOwnedDeviceExecutionTargets: async (input: {
      nowMs: number;
      userId: string;
    }) =>
      await listOwnedDeviceExecutionTargetRecords({
        db,
        nowMs: input.nowMs,
        userId: input.userId,
      }),
    readOwnedDeviceRegistryRecord: async (input: {
      userId: string;
      deviceId: string;
    }) =>
      await readOwnedDeviceRegistryRecord({
        db,
        userId: input.userId,
        deviceId: input.deviceId,
      }),
    connectCurrentDeviceIdentity: async (input: {
      userId: string;
      deviceId: string;
      requestedConnectedComputerId?: string;
      connectedAtMs: number;
    }) =>
      await connectOwnedDeviceToConnectedComputerRecord({
        db,
        userId: input.userId,
        deviceId: input.deviceId,
        requestedConnectedComputerId: input.requestedConnectedComputerId,
        connectedAtMs: input.connectedAtMs,
      }),
    readConnectedComputerIdentity: async (input: {
      userId: string;
      connectedComputerId: string;
    }) =>
      await readConnectedComputerIdentityRecord({
        db,
        userId: input.userId,
        connectedComputerId: input.connectedComputerId,
      }),
    readForgottenDevice: async (input: { userId: string; deviceId: string }) =>
      await readForgottenDeviceRecord({
        db,
        userId: input.userId,
        deviceId: input.deviceId,
      }),
    deleteForgottenDevice: async (input: {
      userId: string;
      deviceId: string;
    }) =>
      await deleteForgottenDeviceRecord({
        db,
        userId: input.userId,
        deviceId: input.deviceId,
      }),
    forgetCurrentComputer: async (input: {
      userId: string;
      forgottenAtMs: number;
    }) =>
      await forgetCurrentComputerRecordAtomically({
        db,
        userId: input.userId,
        forgottenAtMs: input.forgottenAtMs,
      }),
    forgetComputer: async (input: {
      userId: string;
      deviceId: string;
      forgottenAtMs: number;
    }) =>
      await forgetComputerRecordAtomically({
        db,
        userId: input.userId,
        deviceId: input.deviceId,
        forgottenAtMs: input.forgottenAtMs,
      }),
    upsertOwnedDeviceRegistryRecord: async (input: {
      record: OwnedDeviceRegistryRecord;
    }) =>
      await upsertOwnedDeviceRegistryRecord({
        db,
        record: input.record,
      }),
  };
}
function requireRuntimeReadinessDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "runtime prepare readiness store is unavailable",
      code: "runtime.prepare_readiness.store_unavailable",
    });
  }
  return db;
}
function requireAgentProfileBindingDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Agent Profile Binding store is unavailable",
      code: "agent_profile_binding.store_unavailable",
    });
  }
  return db;
}
function requireSpaceIndexDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Space Index store is unavailable",
      code: "space_index.store_unavailable",
    });
  }
  return db;
}
function requireIdentityDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Organization identity store is unavailable",
      code: "organization.context_unavailable",
    });
  }
  return db;
}
function requireSpaceAttachmentDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "attachment_storage_failed",
      reason: "Space attachment storage is unavailable.",
      status: 503,
    });
  }
  return db;
}
function requireCenterAgentDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Center Agent store is unavailable.",
      code: "center_agent.designation_store_unavailable",
    });
  }
  return db;
}
function requireAgentTaskCoordinationDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "center_agent.task_coordination_store_unavailable",
      reason: "Agent Task Coordination storage is unavailable.",
      status: 503,
    });
  }
  return db;
}
function requireCenterAgentMemoryService(env: CoreBindings) {
  const memoryService = createCoreCenterAgentMemoryService(env);
  if (!memoryService) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Center Agent memory is unavailable.",
      code: "center_agent_memory.unavailable",
    });
  }
  return memoryService;
}
function normalizeExplicitMemorySpeaker(
  value: CenterAgentRememberForOrganizationInput["speakerMember"]
): {
  memberId: string;
  userId: string;
} | null {
  const memberId = normalizeOptionalText(value?.memberId);
  const userId = normalizeOptionalText(value?.userId);
  return memberId && userId ? { memberId, userId } : null;
}
async function requireExplicitMemoryEpisodeOrigin(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  env: CoreBindings;
}): Promise<CenterAgentMemoryEpisodeOrigin> {
  const { authorization } = input;
  const submissionId = normalizeOptionalText(
    authorization.context.agentControllerConversationId
  );
  try {
    if (!submissionId) {
      throw new Error("Remote Agent submission identity is unavailable");
    }
    const db = resolveExplicitMemorySourceDeliveryDb(input.env);
    if (!db) {
      throw new Error("Remote Agent delivery store is unavailable");
    }
    const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
      db,
      submissionId,
    });
    if (!delivery) {
      throw new Error("Remote Agent source delivery is unavailable");
    }
    const sourceRequest = resolveExplicitMemorySourceTurnRequest(delivery);
    return resolveExplicitMemoryEpisodeOrigin({
      createdAtMs: delivery.createdAtMs,
      expectedOrganizationId: authorization.activeOrganization.organizationId,
      expectedProfileId: authorization.actorProfileId,
      organizationId: delivery.organizationId,
      profileId: delivery.profileId,
      sourceMessageId: delivery.triggerMessageId,
      turnEnvelope: sourceRequest.turnEnvelope,
    });
  } catch (error) {
    console.warn("[core.center_agent_memory.explicit_source_unavailable]", {
      error: toErrorMessage(error),
      organizationId: authorization.activeOrganization.organizationId,
      profileId: authorization.actorProfileId,
      submissionId,
    });
    throw createCoreRpcHttpError({
      code: "center_agent_memory.source_provenance_unavailable",
      reason:
        "OpenMeld could not verify the source conversation for this memory. Please try again from the original conversation.",
      status: 409,
    });
  }
}
function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: `${field} is required`,
      code: "invalid_payload",
    });
  }
  return normalized;
}
function normalizeNullableText(value: unknown): string | null {
  return normalizeOptionalText(value);
}
function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
const SLACK_CHANNEL_NAME_PREFIX_PATTERN = /^#+/u;
function normalizeSlackChannelNameForRpc(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(SLACK_CHANNEL_NAME_PREFIX_PATTERN, "")
    .toLowerCase();
}

function toIsoDateTime(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Expected millisecond timestamp");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Expected valid millisecond timestamp");
  }
  return date.toISOString();
}
function toOptionalIsoDateTime(value: number | null): string | null {
  return value === null ? null : toIsoDateTime(value);
}
function toCenterAgentDispatchHistoryEntryDto(
  entry: DispatchHistoryEntry
): CenterAgentDispatchHistoryEntry {
  return {
    attemptCount: entry.attemptCount,
    dispatchId: entry.dispatchId,
    firstSeenAt: toIsoDateTime(entry.firstSeenAtMs),
    lastAttemptAt: toIsoDateTime(entry.lastAttemptAtMs),
    latestAttempt: entry.latestAttempt
      ? {
          attemptId: entry.latestAttempt.attemptId,
          attemptNo: entry.latestAttempt.attemptNo,
          createdAt: toIsoDateTime(entry.latestAttempt.createdAtMs),
          errorCode: entry.latestAttempt.errorCode,
          errorMessage: entry.latestAttempt.errorMessage,
          finishedAt: toOptionalIsoDateTime(entry.latestAttempt.finishedAtMs),
          startedAt: toOptionalIsoDateTime(entry.latestAttempt.startedAtMs),
          status: entry.latestAttempt.status,
        }
      : null,
    status: entry.status,
    targetProfileId: entry.targetProfileId,
  };
}
function requireStartRequest(
  context: CoreRpcContextInput | undefined,
  deviceId: string,
  routeParamsSchema: typeof forgetComputerRouteParamsSchema
): {
  userId: string;
  deviceId: string;
} {
  const parsedRouteParams = routeParamsSchema.safeParse({ deviceId });
  if (!parsedRouteParams.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: parsedRouteParams.error.issues[0]?.message ?? "invalid deviceId",
      code: "invalid_device_id",
    });
  }
  const requestContext = requireRpcContext(context);
  const userId = String(requestContext.actorContext.ownerUserId ?? "").trim();
  if (!userId) {
    throwUnauthenticated();
  }
  return {
    userId,
    deviceId: parsedRouteParams.data.deviceId,
  };
}
function requirePrepareReadinessRequest(
  context: CoreRpcContextInput | undefined,
  deviceId: string
): {
  userId: string;
  deviceId: string;
} {
  const parsedRouteParams = prepareReadinessRouteParamsSchema.safeParse({
    deviceId,
  });
  if (!parsedRouteParams.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: parsedRouteParams.error.issues[0]?.message ?? "invalid deviceId",
      code: "invalid_device_id",
    });
  }
  return {
    userId: requireAuthenticatedOwnerUserId(context),
    deviceId: parsedRouteParams.data.deviceId,
  };
}
function requireRuntimeReportingRequest(
  context: CoreRpcContextInput | undefined,
  deviceId: string
): {
  userId: string;
  deviceId: string;
} {
  const parsedRouteParams = runtimeReportingRouteParamsSchema.safeParse({
    deviceId,
  });
  if (!parsedRouteParams.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: parsedRouteParams.error.issues[0]?.message ?? "invalid deviceId",
      code: "invalid_device_id",
    });
  }
  return {
    userId: requireAuthenticatedOwnerUserId(context),
    deviceId: parsedRouteParams.data.deviceId,
  };
}
function requireAgentProfileBindingRequest(input: {
  agentProfileId: string;
  context?: CoreRpcContextInput;
}): {
  agentProfileId: string;
  context: CoreRpcContextInput;
  owner: AgentProfileBindingOwner;
} {
  const parsedRouteParams = agentProfileBindingRouteParamsSchema.safeParse({
    agentProfileId: input.agentProfileId,
  });
  if (!parsedRouteParams.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsedRouteParams.error.issues[0]?.message ?? "invalid agentProfileId",
      code: "invalid_payload",
    });
  }
  const context = requireRpcContext(input.context);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  return {
    agentProfileId: parsedRouteParams.data.agentProfileId,
    context,
    owner: {
      id: ownerUserId,
      kind: "owner_account",
    },
  };
}
async function requireAgentProfileWorkspaceScope(
  env: CoreBindings,
  input: {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  }
): Promise<{
  db: PostgresDatabase;
  request: ReturnType<typeof requireAgentProfileBindingRequest>;
}> {
  const request = requireAgentProfileBindingRequest(input);
  const activeOrganizationId = normalizeOptionalText(
    request.context.activeOrganizationId
  );
  if (!activeOrganizationId) {
    throw createCoreRpcHttpError({
      code: "agent_profile.organization_context_missing",
      reason: "Select a workspace before managing this Agent Profile.",
      status: 403,
    });
  }
  const db = requireAgentProfileBindingDb(env);
  let profileOrganization: Awaited<
    ReturnType<typeof readAgentProfileOrganizationContext>
  >;
  try {
    profileOrganization = await readAgentProfileOrganizationContext({
      agentProfileId: request.agentProfileId,
      db,
    });
  } catch (error) {
    console.error("[core.agent_profile_binding.organization_lookup_failed]", {
      event: "core.agent_profile_binding.organization_lookup_failed",
      activeOrganizationId,
      agentProfileId: request.agentProfileId,
      error: toErrorMessage(error),
    });
    throw createCoreRpcHttpError({
      code: "agent_profile.organization_lookup_failed",
      reason: "Agent Profile workspace could not be verified.",
      status: 503,
    });
  }
  if (profileOrganization?.profileKind !== "agent") {
    throw createCoreRpcHttpError({
      code: "agent_profile.not_found",
      reason: "Agent Profile was not found.",
      status: 404,
    });
  }
  if (
    !isAgentProfileEligibleForOrganization({
      managedRole: profileOrganization.managedRole,
      profileOrganizationId: profileOrganization.organizationId,
      targetOrganizationId: activeOrganizationId,
    })
  ) {
    throw createCoreRpcHttpError({
      code: "agent_profile.organization_mismatch",
      reason:
        "Agent Profile can only be managed in the workspace where it was created.",
      status: 403,
    });
  }
  return { db, request };
}
async function requireAgentProfileWorkRecoveryScope(
  env: CoreBindings,
  input: {
    agentProfileId: string;
    context?: CoreRpcContextInput;
  },
  allowRequester = false
): Promise<ReturnType<typeof requireAgentProfileBindingRequest>> {
  const request = requireAgentProfileBindingRequest(input);
  const activeOrganizationId = normalizeOptionalText(
    request.context.activeOrganizationId
  );
  if (!activeOrganizationId) {
    throw createCoreRpcHttpError({
      code: "agent_profile.organization_context_missing",
      reason: "Select a workspace before managing this Agent Profile.",
      status: 403,
    });
  }
  const profileScope = await resolveAgentProfileWorkRecoveryAuthScope({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  if (profileScope.status === "unavailable") {
    throw createCoreRpcHttpError({
      code: "agent_profile.unavailable",
      reason: "agent profile unavailable",
      status: 503,
    });
  }
  if (profileScope.status !== "valid") {
    throw createCoreRpcHttpError({
      code: "agent_profile.not_found",
      reason: "agent profile not found",
      status: 404,
    });
  }
  if (profileScope.scope.organizationId !== activeOrganizationId) {
    throw createCoreRpcHttpError({
      code: "agent_profile.organization_mismatch",
      reason:
        "Agent Profile can only be managed in the workspace where it was created.",
      status: 403,
    });
  }
  if (
    !(
      allowRequester ||
      ownersEqual(
        {
          id: profileScope.scope.ownerUserId,
          kind: "owner_account",
        },
        request.owner
      )
    )
  ) {
    throw createCoreRpcHttpError({
      code: "agent_profile.not_found",
      reason: "agent profile not found",
      status: 404,
    });
  }
  return {
    ...request,
    owner: { id: profileScope.scope.ownerUserId, kind: "owner_account" },
  };
}
type ActiveOrganization = {
  memberId?: string;
  organizationId: string;
  role: string;
  userId: string;
};
function requireActiveOrganizationMemberId(
  activeOrganization: ActiveOrganization
): string {
  const memberId = normalizeOptionalText(activeOrganization.memberId);
  if (!memberId) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason: "Organization membership identity is unavailable.",
      status: 503,
    });
  }
  return memberId;
}
type ManagedCenterAgentProfileRecord = {
  organizationId: string;
  profileId: string;
  avatarOptions?: import("@openmeld/schemas/types").AuthProfileView["avatarOptions"];
};
async function requireOrganizationPermission(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
  permissions: OrganizationPermissionCheck;
}): Promise<ActiveOrganization> {
  const activeOrganization =
    await requireActiveOrganizationMembershipOrThrow(input);
  if (
    !memberRoleHasOrganizationPermission(
      activeOrganization.role,
      input.permissions
    )
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      reason:
        "Only an Organization owner or admin can manage the Center Agent.",
      code: "organization.role_required",
    });
  }
  return activeOrganization;
}
type MessageChannelIdentityLinkMembership = {
  organizationId: string;
  organizationName: string;
  role: "admin" | "member" | "owner" | null;
  userEmail: string;
  userId: string;
};
async function resolveMessageChannelIdentityLinkContext(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
  nowMs: number;
  token: string;
}): Promise<{
  membership: MessageChannelIdentityLinkMembership;
  stateDb: PostgresDatabase;
  token: RemoteAgentMessageChannelIdentityLinkTokenRecord;
}> {
  const stateDb = getPostgresDatabase(input.env);
  if (!stateDb) {
    throw createCoreRpcHttpError({
      code: "message_channel.store_unavailable",
      reason: "Message Channel connection state is unavailable.",
      status: 503,
    });
  }
  const openmeldUserId = normalizeOptionalText(
    input.context.actorContext.callerPrincipalId
  );
  if (!openmeldUserId) {
    throw createCoreRpcHttpError({
      code: "auth.unauthenticated",
      reason: "Sign in before connecting this Message Channel account.",
      status: 401,
    });
  }
  const tokenHash = await digestMessageChannelIdentityLinkToken(input.token);
  const token = await readRemoteAgentMessageChannelIdentityLinkTokenForUser({
    db: stateDb,
    nowMs: input.nowMs,
    tokenHash,
    openmeldUserId,
  });
  if (!token) {
    const activeToken =
      await readActiveRemoteAgentMessageChannelIdentityLinkToken({
        db: stateDb,
        nowMs: input.nowMs,
        tokenHash,
      });
    if (
      activeToken?.claimedByUserId &&
      activeToken.claimedByUserId !== openmeldUserId
    ) {
      throw createCoreRpcHttpError({
        code: "message_channel.identity_link_account_required",
        reason:
          "Sign in with the OpenMeld account this connection button is meant for.",
        status: 409,
      });
    }
    throw createMessageChannelIdentityLinkTokenInvalidError();
  }
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    connectionId: token.connectionId,
    db: stateDb,
  });
  if (
    connection?.status !== "connected" ||
    connection.provider !== token.provider ||
    connection.organizationId !== token.organizationId
  ) {
    throw createMessageChannelIdentityLinkTokenInvalidError();
  }
  const membership = await readMessageChannelIdentityLinkMembership({
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    context: input.context,
    organizationId: token.organizationId,
    provider: token.provider,
  });
  if (token.membershipRequirement === "current_member" && !membership.role) {
    throw createCoreRpcHttpError({
      code: "message_channel.identity_link_membership_required",
      reason:
        "This connection button was created for a current member of this OpenMeld Organization, but that membership is no longer active.",
      status: 409,
    });
  }
  return { membership, stateDb, token };
}
async function readMessageChannelIdentityLinkMembership(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  context: CoreRpcContextInput;
  organizationId: string;
  provider: LarkPlatformProvider;
}): Promise<MessageChannelIdentityLinkMembership> {
  const userId = normalizeOptionalText(
    input.context.actorContext.callerPrincipalId
  );
  if (!userId) {
    throw createCoreRpcHttpError({
      code: "auth.unauthenticated",
      reason: `Sign in before linking ${providerLabel(input.provider)} to OpenMeld.`,
      status: 401,
    });
  }
  const projection = await readOrganizationAccountIdentityProjection({
    account: { kind: "user_id", userId },
    authWorker: input.authWorker,
    organizationId: input.organizationId,
  });
  if (!projection?.ok) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason:
        "OpenMeld could not confirm your account because Organization identity is temporarily unavailable.",
      status: 503,
    });
  }
  const account = projection.account;
  if (!account) {
    throw createCoreRpcHttpError({
      code: "auth.unauthenticated",
      reason: "Sign in with an OpenMeld account before linking this channel.",
      status: 401,
    });
  }
  return {
    organizationId: input.organizationId,
    organizationName: projection.organization.name,
    role: account.membership?.role ?? null,
    userEmail: account.email,
    userId,
  };
}
async function ensureMessageChannelIdentityLinkMembership(input: {
  env: CoreBindings;
  membership: MessageChannelIdentityLinkMembership;
  provider: "feishu" | "lark";
}): Promise<{
  joinedOrganization: boolean;
  membership: MessageChannelIdentityLinkMembership & {
    role: "admin" | "member" | "owner";
  };
}> {
  if (input.membership.role) {
    return {
      joinedOrganization: false,
      membership: {
        ...input.membership,
        role: input.membership.role,
      },
    };
  }
  const authResult = await callRequiredAuthWorkerRpc({
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.ensureMessageChannelMemberOrganizationMembership({
        organizationId: input.membership.organizationId,
        provider: input.provider,
        userId: input.membership.userId,
      }),
    unavailable: {
      code: "message_channel.member_enrollment.unavailable",
      reason: "Joining this OpenMeld organization is temporarily unavailable.",
    },
  });
  const parsed =
    ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema.safeParse(
      authResult
    );
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "message_channel.member_enrollment.invalid_response",
      reason: "OpenMeld could not verify the organization membership update.",
      status: 502,
    });
  }
  if (!parsed.data.ok) {
    throw createCoreRpcHttpError({
      code: parsed.data.code,
      reason: parsed.data.message,
      status: parsed.data.code.endsWith("email_verification_required")
        ? 403
        : 409,
    });
  }
  if (
    parsed.data.organizationId !== input.membership.organizationId ||
    parsed.data.role.length === 0
  ) {
    throw createCoreRpcHttpError({
      code: "message_channel.member_enrollment.identity_mismatch",
      reason: "OpenMeld could not verify the organization membership update.",
      status: 409,
    });
  }
  return {
    joinedOrganization: !parsed.data.alreadyMember,
    membership: {
      ...input.membership,
      organizationName: parsed.data.organizationName,
      role: parsed.data.role,
    },
  };
}
function createMessageChannelIdentityLinkTokenInvalidError(): Error {
  return createCoreRpcHttpError({
    code: "message_channel.identity_link_token_invalid",
    reason:
      "This channel link has expired. Ask the Center Agent again in Lark or Feishu.",
    status: 409,
  });
}
async function requireLarkPlatformRegistrationRequest(
  env: CoreBindings,
  input: BeginLarkPlatformRegistrationInput,
  options: {
    allowPersonalWorkspace?: boolean;
  } = {}
): Promise<{
  actor: {
    organizationId: string;
    profileId: string;
    userId: string;
  };
  db: PostgresDatabase;
  provider: LarkPlatformProvider;
}> {
  const context = requireRpcContext(input.context);
  const provider = larkPlatformProviderSchema.safeParse(input.provider);
  if (!provider.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        provider.error.issues[0]?.message ??
        "The Message Channel provider is invalid.",
      status: 400,
    });
  }
  const activeOrganization = await requireOrganizationPermission({
    context,
    env,
    permissions: { channel: ["connect"] },
  });
  if (!options.allowPersonalWorkspace) {
    await requireOrganizationForMessageChannels({
      env,
      organizationId: activeOrganization.organizationId,
      requestId: context.actorContext.requestId,
    });
  }
  const profileId = normalizeOptionalText(
    context.actorContext.openMeldProfileId
  );
  if (!profileId || context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "message_channel.actor_required",
      reason: "Message Channel changes require an authenticated Human Profile.",
      status: 403,
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "message_channel.store_unavailable",
      reason: "Message Channel connection state is unavailable.",
      status: 503,
    });
  }
  return {
    actor: {
      organizationId: activeOrganization.organizationId,
      profileId,
      userId: activeOrganization.userId,
    },
    db,
    provider: provider.data,
  };
}
async function requireOrganizationForMessageChannels(input: {
  env: CoreBindings;
  organizationId: string;
  requestId?: string | null;
}): Promise<void> {
  const classification = await readOrganizationPersonalClassification(input);
  if (!classification.ok) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason: "OpenMeld could not verify this Organization.",
      status: 503,
    });
  }
  if (classification.personal) {
    throw createCoreRpcHttpError({
      code: "message_channel.organization_required",
      reason:
        "Create an organization before connecting a Message Channel. Personal Workspaces cannot connect Slack, Lark, or Feishu.",
      status: 409,
    });
  }
}
function throwLarkPlatformRegistrationRpcError(
  error: unknown,
  provider: LarkPlatformProvider
): never {
  if (!(error instanceof LarkPlatformRegistrationServiceError)) {
    throw error;
  }
  const reason = error.reasonCode.slice(`${provider}.`.length);
  const surface = (() => {
    switch (reason) {
      case "connection_already_exists":
        return {
          code: "message_channel.already_connected",
          message: `${providerLabel(provider)} is already connected.`,
        };
      case "connection_changed":
        return {
          code: "message_channel.connection_changed",
          message:
            "The Message Channel connection changed. Refresh Channels and try again.",
        };
      case "provider_gate_disabled":
        return {
          code: "message_channel.provider_disabled",
          message: `${providerLabel(provider)} connections are not enabled in this environment.`,
        };
      case "registration_actor_invalid":
        return {
          code: "message_channel.actor_required",
          message:
            "Message Channel changes require an authenticated Human Profile.",
        };
      case "registration_not_found":
        return {
          code: "message_channel.registration_not_found",
          message:
            "This registration attempt is no longer available. Start a new connection.",
        };
      case "repair_unavailable":
        return {
          code: "message_channel.repair_unavailable",
          message:
            "This saved app can no longer be repaired. Disconnect it, then connect again.",
        };
      default:
        return {
          code: "message_channel.provider_unavailable",
          message: `${providerLabel(provider)} registration is temporarily unavailable.`,
        };
    }
  })();
  throw createCoreRpcHttpError({
    code: surface.code,
    reason: surface.message,
    status: error.status,
  });
}
function providerLabel(provider: LarkPlatformProvider): "Feishu" | "Lark" {
  return provider === "feishu" ? "Feishu" : "Lark";
}
async function readOrInitializeCenterAgentDesignation(input: {
  activeOrganization: ActiveOrganization;
  context?: CoreRpcContextInput;
  db?: PostgresDatabase;
  env: CoreBindings;
  required?: boolean;
}): Promise<CenterAgentDesignationRecord | null> {
  const db = input.db ?? requireCenterAgentDb(input.env);
  const existing = await readCenterAgentDesignationRecord({
    db,
    organizationId: input.activeOrganization.organizationId,
  });
  if (existing) {
    return existing;
  }
  const managedProfile =
    (await readManagedCenterAgentProfileForOrganization({
      db,
      organizationId: input.activeOrganization.organizationId,
    })) ??
    (await ensureManagedCenterAgentProfileForOrganization({
      env: input.env,
      db,
      organizationId: input.activeOrganization.organizationId,
      createdByUserId: input.activeOrganization.userId,
      requestId:
        normalizeOptionalText(input.context?.actorContext.requestId) ?? null,
    }));
  const bindingDb = requireAgentProfileBindingDb(input.env);
  const actorProfileId =
    normalizeOptionalText(input.context?.actorContext.openMeldProfileId) ??
    managedProfile.profileId;
  await designateRemoteCenterAgentBinding({
    activeOrganization: input.activeOrganization,
    actorProfileId,
    agentProfileId: managedProfile.profileId,
    bindingDb,
    env: input.env,
  });
  const result = await upsertCenterAgentDesignationRecord({
    agentProfileId: managedProfile.profileId,
    db,
    designatedBy: input.activeOrganization.userId,
    nowMs: Date.now(),
    organizationId: input.activeOrganization.organizationId,
  });
  return result.designation;
}
async function ensureManagedCenterAgentProfileForOrganization(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  organizationId: string;
  createdByUserId: string;
  requestId: string | null;
}): Promise<ManagedCenterAgentProfileRecord> {
  const authWorker = input.env.OPENMELD_AUTH_WORKER;
  let ensured: Awaited<
    ReturnType<RequiredAuthWorkerRpc["ensureCenterAgentProfileInOrganization"]>
  >;
  try {
    ensured = await callRequiredAuthWorkerRpc({
      authWorker,
      call: (requiredAuthWorker) =>
        requiredAuthWorker.ensureCenterAgentProfileInOrganization({
          organizationId: input.organizationId,
          createdByUserId: input.createdByUserId,
        }),
      unavailable: {
        code: "center_agent.profile_bootstrap_unavailable",
        reason: "Center Agent profile bootstrap is unavailable.",
      },
    });
  } catch (error) {
    logCenterAgentProfileBootstrapFailure({
      code: "center_agent.profile_bootstrap_unavailable",
      error: authWorker ? error : undefined,
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      requestId: input.requestId,
      stage: authWorker ? "auth_rpc" : "binding_lookup",
    });
    throw error;
  }
  if (!ensured.ok) {
    logCenterAgentProfileBootstrapFailure({
      authCode: ensured.code,
      code: "center_agent.profile_bootstrap_failed",
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      requestId: input.requestId,
      stage: "auth_result",
    });
    throw createCoreRpcHttpError({
      status: 409,
      reason: ensured.message,
      code: `center_agent.${ensured.code}`,
    });
  }
  const profileId = normalizeOptionalText(ensured.profile.openMeldProfileId);
  if (!profileId) {
    logCenterAgentProfileBootstrapFailure({
      code: "center_agent.profile_bootstrap_failed",
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      requestId: input.requestId,
      stage: "auth_response",
    });
    throw createCoreRpcHttpError({
      status: 409,
      reason: "Center Agent profile bootstrap returned an invalid profile.",
      code: "center_agent.profile_bootstrap_failed",
    });
  }
  const managedProfile = await readManagedCenterAgentProfileByIdForOrganization(
    {
      db: input.db,
      organizationId: input.organizationId,
      profileId,
    }
  );
  if (!managedProfile) {
    logCenterAgentProfileBootstrapFailure({
      code: "center_agent.profile_bootstrap_failed",
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      requestId: input.requestId,
      stage: "profile_readback",
    });
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Center Agent profile bootstrap did not produce a managed profile.",
      code: "center_agent.profile_bootstrap_failed",
    });
  }
  return managedProfile;
}
function logCenterAgentProfileBootstrapFailure(input: {
  authCode?: string;
  code:
    | "center_agent.profile_bootstrap_failed"
    | "center_agent.profile_bootstrap_unavailable";
  error?: unknown;
  organizationId: string;
  createdByUserId: string;
  requestId: string | null;
  stage:
    | "auth_response"
    | "auth_result"
    | "auth_rpc"
    | "binding_lookup"
    | "profile_readback";
}): void {
  const event = `core.${input.code}`;
  console.error(`[${event}]`, {
    event,
    organizationId: input.organizationId,
    createdByUserId: input.createdByUserId,
    requestId: input.requestId,
    stage: input.stage,
    ...(input.authCode ? { authCode: input.authCode } : {}),
    ...(input.error === undefined
      ? {}
      : {
          error: toErrorMessage(input.error),
          errorName:
            input.error instanceof Error
              ? input.error.name
              : typeof input.error,
          errorStack:
            input.error instanceof Error ? input.error.stack : undefined,
        }),
  });
}
async function readManagedCenterAgentProfileByIdForOrganization(input: {
  db: PostgresDatabase;
  organizationId: string;
  profileId: string;
}): Promise<ManagedCenterAgentProfileRecord | null> {
  const row = await input.db
    .query<{
      avatar_options: import("@openmeld/schemas/types").AuthProfileView["avatarOptions"];
      owner_user_id: string;
      profile_id: string;
    }>({
      text: `
        SELECT
          profile_id,
          avatar_options,
          owner_user_id
        FROM "openmeld"."openmeld_profiles"
        WHERE organization_id = $1
          AND profile_id = $2
          AND profile_kind = 'agent'
          AND managed_role = $3
          AND status = 'active'
        LIMIT 1
      `,
      values: [
        input.organizationId,
        input.profileId,
        CENTER_AGENT_MANAGED_ROLE,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  const profileId = normalizeOptionalText(row?.profile_id);
  return profileId
    ? {
        organizationId: input.organizationId,
        profileId,
        avatarOptions: row?.avatar_options ?? null,
      }
    : null;
}
async function readManagedCenterAgentProfileForOrganization(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<ManagedCenterAgentProfileRecord | null> {
  const row = await input.db
    .query<{
      owner_user_id: string;
      profile_id: string;
    }>({
      text: `
        SELECT
          profile_id,
          owner_user_id
        FROM "openmeld"."openmeld_profiles"
        WHERE organization_id = $1
          AND profile_kind = 'agent'
          AND managed_role = $2
          AND status = 'active'
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      `,
      values: [input.organizationId, CENTER_AGENT_MANAGED_ROLE],
    })
    .then((result) => result.rows[0] ?? null);
  const profileId = normalizeOptionalText(row?.profile_id);
  return profileId ? { organizationId: input.organizationId, profileId } : null;
}
async function readCenterAgentHostedBindingOrThrow(input: {
  env: CoreBindings;
  organizationId: string;
}) {
  const designation = await readCenterAgentDesignationRecord({
    db: requireCenterAgentDb(input.env),
    organizationId: input.organizationId,
  });
  if (!designation) {
    throw createCoreRpcHttpError({
      code: "center_agent.designation_required",
      reason: "Designate the Center Agent before choosing its model.",
      status: 409,
    });
  }
  const managedProfile = await readManagedCenterAgentProfileByIdForOrganization(
    {
      db: requireCenterAgentDb(input.env),
      organizationId: input.organizationId,
      profileId: designation.agentProfileId,
    }
  );
  if (!managedProfile) {
    throw createCoreRpcHttpError({
      code: "center_agent.profile_not_found",
      reason: "The current Center Agent profile is unavailable.",
      status: 409,
    });
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: managedProfile.profileId,
    db: requireAgentProfileBindingDb(input.env),
    owner: {
      id: managedProfile.organizationId,
      kind: "organization",
    },
  });
  if (
    binding?.bindingState !== "enabled_primary" ||
    !isHostedCenterAgentExecutionTarget(binding)
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.binding_not_found",
      reason: "The Center Agent hosted runtime Binding is unavailable.",
      status: 409,
    });
  }
  return binding;
}
async function designateRemoteCenterAgentBinding(input: {
  activeOrganization: ActiveOrganization;
  actorProfileId?: string | null;
  agentProfileId: string;
  bindingDb: PostgresDatabase;
  context?: CoreRpcContextInput;
  env: CoreBindings;
}): Promise<void> {
  assertRemoteCenterAgentDesignationEnabled(input.env);
  const availability = resolveRemoteAgentRuntimeAvailability({
    env: input.env,
    organizationId: input.activeOrganization.organizationId,
  });
  if (!availability.ok) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: availability.message,
      code: availability.code,
    });
  }
  const profileOrganization = await readAgentProfileOrganizationContext({
    db: input.bindingDb,
    agentProfileId: input.agentProfileId,
  });
  if (!profileOrganization) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Agent Profile was not found.",
      code: "center_agent.profile_not_found",
    });
  }
  if (profileOrganization.profileKind !== "agent") {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Only an Agent Profile can be designated as Center Agent.",
      code: "center_agent.profile_invalid",
    });
  }
  assertManagedCenterAgentProfile(profileOrganization);
  if (
    profileOrganization.organizationId !==
    input.activeOrganization.organizationId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      reason:
        "Remote Agent Center Agent designation requires an Agent Profile in this Organization.",
      code: "center_agent.profile_org_mismatch",
    });
  }
  const owner = {
    id: input.activeOrganization.organizationId,
    kind: "organization" as const,
  };
  const nowMs = Date.now();
  const actorProfileId = normalizeOptionalText(
    input.actorProfileId ?? input.context?.actorContext.openMeldProfileId
  );
  if (!actorProfileId) {
    throw createCoreRpcHttpError({
      status: 401,
      reason: "Authentication is required.",
      code: "auth.unauthenticated",
    });
  }
  const admittedEnabledPrimaryBindings =
    await listCenterAgentEnabledPrimaryBindingsOrThrow({
      agentProfileId: input.agentProfileId,
      db: input.bindingDb,
    });
  if (
    admittedEnabledPrimaryBindings.some(
      (binding) =>
        binding.owner.kind !== "organization" ||
        binding.owner.id !== owner.id ||
        !isHostedCenterAgentExecutionTarget(binding)
    )
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.binding_owner_invalid",
      reason: "Center Agent runtime ownership requires migration.",
      status: 409,
    });
  }
  const writeResult = await ensurePrimaryAgentProfileBindingRecord({
    db: input.bindingDb,
    record: {
      agentProfileId: input.agentProfileId,
      agentControllerConversationId: null,
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      bindingId: `binding_${crypto.randomUUID()}`,
      createdAtMs: nowMs,
      createdByProfileId: actorProfileId,
      hostedRuntimeIdentityJson: JSON.stringify(
        HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
      ),
      owner,
      reasonCode: "center_agent.remote_agent_designation",
      runtimeKind: "hosted_center_agent",
      updatedAtMs: nowMs,
      openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
    },
  });
  if (writeResult.status !== "accepted") {
    throw createCoreRpcHttpError({
      code: "center_agent.binding_conflict",
      reason:
        "Center Agent runtime configuration conflicts with its Organization binding.",
      status: 409,
    });
  }
  await insertCenterAgentAuditJournalEntry({
    action: "designate_remote_center_agent",
    actorProfileId,
    attribution: { actorProfileId, onBehalfOf: null },
    db: input.bindingDb,
    id: crypto.randomUUID(),
    nowMs,
    organizationId: input.activeOrganization.organizationId,
    resource: {
      id: writeResult.binding.bindingId,
      type: "agent_profile_binding",
    },
  });
}
async function listCenterAgentEnabledPrimaryBindingsOrThrow(input: {
  agentProfileId: string;
  db: PostgresDatabase;
}): Promise<AgentProfileBindingRecord[]> {
  try {
    return await listEnabledPrimaryAgentProfileBindingRecordsForProfile(input);
  } catch (error) {
    if (error instanceof AgentProfileBindingOwnerInventoryLimitError) {
      throw createCoreRpcHttpError({
        code: "center_agent.binding_owner_inventory_exceeded",
        reason: "Center Agent runtime ownership requires operator review.",
        status: 503,
      });
    }
    throw error;
  }
}
export async function requireActiveOrganizationMembershipOrThrow(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
}): Promise<ActiveOrganization> {
  const membership = await resolveActiveOrganizationMembership(input);
  if (membership.ok) {
    return {
      memberId: membership.memberId,
      organizationId: membership.organizationId,
      role: membership.role,
      userId: membership.userId,
    };
  }
  throw createCoreRpcHttpError({
    status: membership.status,
    reason: membership.message,
    code: membership.code,
  });
}
function requireConnectorConnectionDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Connector connection state is unavailable.",
      code: "connector.connection_state_unavailable",
    });
  }
  return db;
}
function requireConnectorService(value: unknown): ConnectorService {
  const parsed = connectorServiceSchema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Unsupported connector service.",
      code: "connector.service_unsupported",
    });
  }
  return parsed.data;
}
function requireConnectorConnectionPreference(
  value: unknown
): ConnectorConnectionPreference {
  const parsed = connectorConnectionPreferenceSchema.safeParse(
    value ?? "automatic"
  );
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "connector.connection_preference_unsupported",
      reason: "Unsupported connector connection preference.",
      status: 400,
    });
  }
  return parsed.data;
}
function requireConnectorUserId(value: unknown): string {
  const userId = normalizeOptionalText(value);
  if (!userId) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Connector connection owner is required.",
      code: "invalid_payload",
    });
  }
  return userId;
}
function assertConnectorDisconnectPermission(input: {
  activeOrganization: ActiveOrganization;
  targetUserId: string;
}): void {
  if (
    input.activeOrganization.userId === input.targetUserId ||
    memberRoleHasOrganizationPermission(input.activeOrganization.role, {
      connector: ["manage"],
    })
  ) {
    return;
  }
  throw createCoreRpcHttpError({
    status: 403,
    reason:
      "Only the connection owner or an Organization owner or admin can disconnect this account.",
    code: "connector.disconnect_forbidden",
  });
}
function assertSharedConnectorManagementPermission(
  activeOrganization: ActiveOrganization
): void {
  if (
    memberRoleHasOrganizationPermission(activeOrganization.role, {
      connector: ["manage"],
    })
  ) {
    return;
  }
  throw createCoreRpcHttpError({
    status: 403,
    reason:
      "Only an Organization owner or admin can manage a shared app connection.",
    code: "connector.shared.manage_forbidden",
  });
}
function prepareSharedConnectorAuditStatement(input: {
  action: "disconnect_shared_app" | "start_shared_app_authorization";
  connectionName: ConnectorConnectionName;
  context: CoreRpcContextInput;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
}): QueryConfig {
  const actorProfileId = normalizeOptionalText(
    input.context.actorContext.openMeldProfileId
  );
  if (!actorProfileId) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Shared app changes require an authenticated human profile.",
      code: "connector.shared.actor_required",
    });
  }
  return {
    text: `
        INSERT INTO "openmeld"."center_agent_audit_journal" (
          id,
          organization_id,
          actor_profile_id,
          action,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          resource_type,
          resource_id,
          created_at
        )
        SELECT $1, $2, $3, $4, NULL, NULL, NULL, 'app_connection', $5, $6
      `,
    values: [
      crypto.randomUUID(),
      input.organizationId,
      actorProfileId,
      input.action,
      input.connectionName,
      input.nowMs,
    ],
  };
}
async function listVisibleConnectorConnections(input: {
  activeOrganization: ActiveOrganization;
  db: PostgresDatabase;
  env: CoreBindings;
  service?: ConnectorService;
}): Promise<ConnectorConnectionListResponse> {
  const canManageOrganization = memberRoleHasOrganizationPermission(
    input.activeOrganization.role,
    { connector: ["manage"] }
  );
  const connections = await listConnectorConnections({
    db: input.db,
    organizationId: input.activeOrganization.organizationId,
    service: input.service,
    userId: canManageOrganization ? undefined : input.activeOrganization.userId,
  });
  return {
    connections: await Promise.all(
      connections.map((connection) =>
        toConnectorConnectionDto({
          canDisconnect:
            connection.scope === "shared"
              ? canManageOrganization
              : canManageOrganization ||
                connection.userId === input.activeOrganization.userId,
          connection,
          env: input.env,
        })
      )
    ),
    currentUserId: input.activeOrganization.userId,
    organizationId: input.activeOrganization.organizationId,
  };
}
async function toConnectorConnectionDto(input: {
  canDisconnect: boolean;
  connection: ConnectorConnectionRecord;
  env: CoreBindings;
}): Promise<ConnectorConnection> {
  return {
    ...input.connection,
    canDisconnect: input.canDisconnect,
    ownerDisplayName: await resolveConnectorConnectionOwnerDisplayName({
      connectionName: input.connection.connectionName,
      env: input.env,
      ownerUserId: input.connection.userId,
    }),
  };
}
async function requireConnectorRequesterMembership(input: {
  env: CoreBindings;
  organizationId: string;
  requestId?: string | null;
  userId: string;
}): Promise<void> {
  const membership = await resolveOrganizationMembershipById({
    env: input.env,
    organizationId: input.organizationId,
    requestId: input.requestId,
    userId: input.userId,
  });
  if (membership.ok) {
    return;
  }
  throw createCoreRpcHttpError({
    code:
      membership.status === 503
        ? "connector.requester_membership_unavailable"
        : "connector.requester_org_mismatch",
    reason:
      membership.status === 503
        ? "Connector requester membership could not be verified."
        : "Connector requester must belong to the active Organization.",
    status: membership.status,
  });
}
function requireOrganizationId(value: unknown): string {
  const organizationId = normalizeOptionalText(value);
  if (!organizationId) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Organization id is required.",
      code: "invalid_payload",
    });
  }
  return organizationId;
}
async function requireOrganizationMembershipOrThrow(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
  organizationId: string;
}): Promise<ActiveOrganization> {
  const userId = normalizeOptionalText(
    input.context.actorContext.callerPrincipalId
  );
  if (!userId) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Organization membership requires an authenticated caller.",
      code: "organization.context_required",
    });
  }
  const db = getPostgresDatabase(input.env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Organization context could not be verified.",
      code: "organization.context_unavailable",
    });
  }
  const membership = await db
    .query<{
      role: string;
    }>({
      text: `
        SELECT role
        FROM "openmeld"."members"
        WHERE organization_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      values: [input.organizationId, userId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!membership?.role) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "You are not a member of this organization.",
      code: "organization.membership_required",
    });
  }
  return {
    organizationId: input.organizationId,
    role: membership.role,
    userId,
  };
}
export function requireHumanSpaceMemberFromContext(input: {
  context: CoreRpcContextInput;
  userId: string;
}): ResolvedSpaceMemberProfile {
  const actor = input.context.actorContext;
  const profile = {
    profileId: normalizeRequiredJoinContextText(
      actor.openMeldProfileId,
      "profileId"
    ),
    profileName: normalizeRequiredJoinContextText(
      actor.profileName,
      "profileName"
    ),
    profileKind: actor.profileKind,
    ownerUserId: input.userId,
    ownerName: normalizeNullableText(actor.ownerName),
    agentControllerRef: null,
  };
  const parsed = resolvedSpaceMemberProfileSchema.safeParse(profile);
  if (!parsed.success || parsed.data.profileKind !== "human") {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Joining an Organization Space requires a Human Profile caller.",
      code: "space.join.human_profile_required",
    });
  }
  return parsed.data;
}
function normalizeRequiredJoinContextText(
  value: unknown,
  field: string
): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw createCoreRpcHttpError({
      status: 403,
      reason: `Joining an Organization Space requires caller ${field}.`,
      code: "space.join.human_profile_required",
    });
  }
  return normalized;
}
function assertManagedCenterAgentProfile(input: {
  managedRole: string | null;
}): void {
  if (input.managedRole === "center_agent") {
    return;
  }
  throw createCoreRpcHttpError({
    status: 400,
    reason:
      "Center Agent designation requires the managed Center Agent profile.",
    code: "center_agent.profile_invalid",
  });
}
function requireAgentExecutionReadinessRequest(
  input: GetAgentExecutionReadinessInput
): AgentExecutionReadinessResponseOptions & {
  agentProfileId: string;
  context: CoreRpcContextInput;
  owner: AgentProfileBindingOwner;
} {
  const parsedRouteParams = agentExecutionReadinessRouteParamsSchema.safeParse({
    agentProfileId: input.agentProfileId,
  });
  if (!parsedRouteParams.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsedRouteParams.error.issues[0]?.message ?? "invalid agentProfileId",
      code: "invalid_payload",
    });
  }
  const context = requireRpcContext(input.context);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  return {
    ...requireAgentExecutionReadinessResponseOptions(input),
    agentProfileId: parsedRouteParams.data.agentProfileId,
    context,
    owner: {
      id: ownerUserId,
      kind: "owner_account",
    },
  };
}
function requireAgentExecutionReadinessBatchRequest(
  input: GetAgentExecutionReadinessBatchInput
): AgentExecutionReadinessResponseOptions & {
  agentProfileIds: string[];
  context: CoreRpcContextInput;
  owner: AgentProfileBindingOwner;
  targetRuntime: AgentExecutionReadinessTargetRuntime | null;
} {
  const parsedBody = getAgentExecutionReadinessBatchBodySchema.safeParse({
    agentProfileIds: input.agentProfileIds,
    ...(input.targetRuntime === undefined
      ? {}
      : { targetRuntime: input.targetRuntime }),
  });
  if (!parsedBody.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsedBody.error.issues[0]?.message ??
        "invalid Agent Execution Readiness batch payload",
      code: "invalid_payload",
    });
  }
  const context = requireRpcContext(input.context);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  return {
    ...requireAgentExecutionReadinessResponseOptions(input),
    agentProfileIds: parsedBody.data.agentProfileIds,
    context,
    owner: {
      id: ownerUserId,
      kind: "owner_account",
    },
    targetRuntime: parsedBody.data.targetRuntime ?? null,
  };
}
function requireAgentExecutionReadinessResponseOptions(
  input: AgentExecutionReadinessResponseOptions
): AgentExecutionReadinessResponseOptions {
  const parsed = agentExecutionReadinessResponseOptionsSchema.safeParse({
    responseVersion: input.responseVersion,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Unsupported Agent Execution Readiness response version.",
      code: "invalid_payload",
    });
  }
  return parsed.data;
}
async function resolveAgentExecutionTargetRuntimeContext(input: {
  env: CoreBindings;
  owner: AgentProfileBindingOwner;
  targetRuntime: AgentExecutionReadinessTargetRuntime | null;
}): Promise<AgentExecutionTargetRuntimeContext | null> {
  const db = getPostgresDatabase(input.env);
  if (
    input.targetRuntime === null ||
    !db ||
    input.owner.kind !== "owner_account"
  ) {
    return null;
  }
  if (input.targetRuntime.kind === "openmeld_service_runtime_id") {
    const runtime = await readRuntimeRegistryRecordByRuntimeId({
      db,
      openMeldServiceRuntimeId:
        input.targetRuntime.openMeldServiceRuntimeId.value,
    });
    if (
      runtime.status !== "found" ||
      runtime.record.runtimeLookupInput.owner.kind !== "owner_account" ||
      runtime.record.runtimeLookupInput.owner.id !== input.owner.id
    ) {
      return null;
    }
    const lane = parseDaemonServiceLane(runtime.record.runtimeLookupInput.lane);
    if (lane === null) {
      return null;
    }
    return {
      deviceId: runtime.record.runtimeLookupInput.deviceId,
      lane,
      ownerUserId: input.owner.id,
      openMeldServiceRuntimeId: runtime.record.openMeldServiceRuntimeId.value,
      source: "openmeld_service_runtime_id",
    };
  }
  const currentTarget = await getCurrentDeviceTargetUseCase({
    store: buildCurrentDeviceTargetStore(input.env),
    userId: input.owner.id,
  });
  if (currentTarget.availability !== "resolved") {
    return null;
  }
  const runtime = await readRuntimeRegistryRecord({
    db,
    runtimeLookupInput: createRuntimeLookupInput({
      deviceId: currentTarget.deviceId,
      lane: currentTarget.runtimeLane,
      owner: {
        id: input.owner.id,
        kind: "owner_account",
      },
    }),
  });
  return {
    deviceId: currentTarget.deviceId,
    lane: currentTarget.runtimeLane,
    ownerUserId: input.owner.id,
    openMeldServiceRuntimeId:
      runtime.status === "found"
        ? runtime.openMeldServiceRuntimeId.value
        : null,
    source: "current_local_runtime",
  };
}
function parseDaemonServiceLane(value: string): DaemonServiceLane | null {
  const parsed = daemonServiceLaneSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
async function assertAgentProfileOwnerMatchesRequest(input: {
  agentProfileId: string;
  env: CoreBindings;
  owner: AgentProfileBindingOwner;
  reads?: AgentExecutionReadinessReads;
}): Promise<void> {
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: input.agentProfileId,
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    reads: input.reads,
  });
  if (
    profileOwnerValidation.status === "unavailable" ||
    profileOwnerValidation.status === "unknown"
  ) {
    throw createCoreRpcHttpError({
      code: "agent_profile.unavailable",
      reason: "agent profile owner unavailable",
      status: 503,
    });
  }
  if (profileOwnerValidation.status !== "valid") {
    throw createCoreRpcHttpError({
      code: "agent_profile.not_found",
      reason: "agent profile not found",
      status: 404,
    });
  }
  if (!ownersEqual(profileOwnerValidation.owner, input.owner)) {
    throw createCoreRpcHttpError({
      code: "agent_profile.not_found",
      reason: "agent profile not found",
      status: 404,
    });
  }
}
export function requireRpcContext(
  context?: CoreRpcContextInput
): CoreRpcContextInput {
  if (!context) {
    throwUnauthenticated();
  }
  const parsed = openMeldRequestContextSchema.safeParse(context);
  if (!parsed.success) {
    throwUnauthenticated();
  }
  return parsed.data;
}
function requireRpcSpaceAccessContext(
  input: CoreRpcSpaceAccessInput
): CoreRpcContextInput {
  assertSpaceAccessMatchesSpace(input);
  return requireRpcContext(
    input.spaceAccess
      ? (getSpaceAccessRequestContext(input.spaceAccess) ?? undefined)
      : input.context
  );
}
function requireWritableRpcSpaceAccessContext(
  input: CoreRpcSpaceAccessInput
): CoreRpcContextInput {
  assertSpaceAccessMatchesSpace(input);
  if (input.spaceAccess) {
    return requireWritableSpaceActor(input.spaceAccess);
  }
  return requireRpcContext(input.context);
}
function resolveRpcSpaceAccess(
  input: CoreRpcSpaceAccessInput
): SpaceAccessContext {
  assertSpaceAccessMatchesSpace(input);
  if (input.spaceAccess) {
    return input.spaceAccess;
  }
  return createAuthenticatedSpaceAccessContext({
    spaceId: input.spaceId,
    requestContext: requireRpcContext(input.context),
    ...(input.password === undefined ? {} : { password: input.password }),
  });
}
function resolveRpcSpaceAccessPassword(
  input: CoreRpcSpaceAccessInput
): string | undefined {
  assertSpaceAccessMatchesSpace(input);
  return input.spaceAccess
    ? getSpaceAccessPassword(input.spaceAccess)
    : input.password;
}
function resolveRpcSpaceAccessForwarding(input: CoreRpcSpaceAccessInput): {
  context?: CoreRpcContextInput;
  password?: string;
  spaceAccess: SpaceAccessContext;
} {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const context = getSpaceAccessRequestContext(spaceAccess) ?? undefined;
  const password = getSpaceAccessPassword(spaceAccess);
  return {
    ...(context ? { context } : {}),
    ...(password === undefined ? {} : { password }),
    spaceAccess,
  };
}
function assertWritableRpcSpaceAccess(input: CoreRpcSpaceAccessInput): void {
  assertSpaceAccessMatchesSpace(input);
  if (input.spaceAccess) {
    requireWritableSpaceActor(input.spaceAccess);
  }
}
export function requireAuthenticatedOwnerUserId(
  context?: CoreRpcContextInput
): string {
  const requestContext = requireRpcContext(context);
  const userId = String(requestContext.actorContext.ownerUserId ?? "").trim();
  if (!userId) {
    throwUnauthenticated();
  }
  return userId;
}
function normalizeRuntimeRegistrationRejectedReason(
  reason: string
): NonNullable<SubmitRuntimeRegistrationResponse["reason"]> {
  switch (reason) {
    case "device_forgotten":
    case "owner_authorization_denied":
    case "owner_authorization_unknown":
    case "owner_authorization_unavailable":
    case "owner_kind_unsupported":
    case "openmeld_service_runtime_id_collision":
    case "openmeld_service_runtime_id_invalid":
    case "openmeld_service_runtime_id_not_opaque":
    case "runtime_record_missing_after_conflict":
      return reason;
    default:
      return "unknown";
  }
}
function buildRejectedRuntimeRegistrationResponse(
  reason: string
): Pick<SubmitRuntimeRegistrationResponse, "reason" | "status"> {
  return {
    reason: normalizeRuntimeRegistrationRejectedReason(reason),
    status: "rejected",
  };
}
function resolveSubmittedAuthorityOpenMeldServiceRuntimeId(input: {
  openMeldServiceRuntimeId: {
    source: string;
    value: string;
  };
  runtimeLookupInput: RuntimeLookupInput;
}):
  | {
      ok: true;
      value: AuthorityOpenMeldServiceRuntimeId;
    }
  | {
      ok: false;
    } {
  try {
    return {
      ok: true,
      value: createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: input.runtimeLookupInput,
        openMeldServiceRuntimeId: input.openMeldServiceRuntimeId.value,
        source: input.openMeldServiceRuntimeId.source,
      }),
    };
  } catch {
    return { ok: false };
  }
}
type RuntimeAgentControllerReportSubmissionRejectionReason = NonNullable<
  SubmitRuntimeAgentControllerReportResult["reason"]
>;
async function verifySubmittedRuntimeIdForLookup(input: {
  db: PostgresDatabase;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
}): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: Extract<
        RuntimeAgentControllerReportSubmissionRejectionReason,
        | "openmeld_service_runtime_id_mismatch"
        | "openmeld_service_runtime_identity_invalid"
        | "runtime_lookup_conflict"
        | "runtime_missing"
      >;
    }
> {
  const lookupResult = await lookupRuntime({
    runtimeLookupInput: input.runtimeLookupInput,
    store: {
      readRuntimeRecord: async (lookupInput) =>
        await readRuntimeRegistryRecord({
          db: input.db,
          runtimeLookupInput: lookupInput.runtimeLookupInput,
        }),
    },
  });
  if (lookupResult.status === "invalid_identity") {
    return {
      ok: false,
      reason: "openmeld_service_runtime_identity_invalid",
    };
  }
  if (lookupResult.status === "missing") {
    return {
      ok: false,
      reason: "runtime_missing",
    };
  }
  if (lookupResult.status === "conflict") {
    return {
      ok: false,
      reason: "runtime_lookup_conflict",
    };
  }
  if (
    lookupResult.openMeldServiceRuntimeId.value !==
    input.openMeldServiceRuntimeId.value
  ) {
    return {
      ok: false,
      reason: "openmeld_service_runtime_id_mismatch",
    };
  }
  return { ok: true };
}
function buildRuntimeAgentControllerReportsResponse(input: {
  reports: readonly SubmitRuntimeAgentControllerReportResult[];
  openMeldServiceRuntimeId?: {
    source: "runtime_registry_authority";
    value: string;
  };
}): SubmitRuntimeAgentControllerReportsResponse {
  const acceptedCount = input.reports.filter(
    (report) => report.status === "accepted"
  ).length;
  let status: "accepted" | "partial" | "rejected";
  if (acceptedCount === input.reports.length) {
    status = "accepted";
  } else if (acceptedCount === 0) {
    status = "rejected";
  } else {
    status = "partial";
  }
  const response = {
    reports: input.reports,
    ...(input.openMeldServiceRuntimeId
      ? { openMeldServiceRuntimeId: input.openMeldServiceRuntimeId }
      : {}),
    status,
  };
  const validated =
    submitRuntimeAgentControllerReportsResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Runtime Agent Controller Report response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function buildRuntimeProviderConversationProofsResponse(input: {
  proofs: readonly SubmitRuntimeProviderConversationProofResult[];
  openMeldServiceRuntimeId?: {
    source: "runtime_registry_authority";
    value: string;
  };
}): SubmitRuntimeProviderConversationProofsResponse {
  const acceptedCount = input.proofs.filter(
    (proof) => proof.status === "accepted"
  ).length;
  let status: "accepted" | "partial" | "rejected";
  if (acceptedCount === input.proofs.length) {
    status = "accepted";
  } else if (acceptedCount === 0) {
    status = "rejected";
  } else {
    status = "partial";
  }
  const response = {
    proofs: input.proofs,
    ...(input.openMeldServiceRuntimeId
      ? { openMeldServiceRuntimeId: input.openMeldServiceRuntimeId }
      : {}),
    status,
  };
  const validated =
    submitRuntimeProviderConversationProofsResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Provider Conversation Proof response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function buildGetAgentProfilePrimaryBindingResponse(
  binding: AgentProfileBindingProjection,
  status?: GetAgentProfilePrimaryBindingResponse["status"]
): GetAgentProfilePrimaryBindingResponse {
  const response = {
    binding,
    grantsClaimSuccess: false,
    status:
      status ?? (binding.bindingState === "missing" ? "missing" : "found"),
  };
  const validated =
    getAgentProfilePrimaryBindingResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Agent Profile Binding read response: ${validated.error.message}`
    );
  }
  return validated.data;
}
async function resolveAgentProfileControllerChangeEligibility(input: {
  agentProfileId: string;
  env: CoreBindings;
  ownerUserId: string;
  requestId?: string | null;
}): Promise<GetAgentProfileControllerChangeEligibilityResponse> {
  const executionState = await readRuntimeTransportAgentProfileExecutionState({
    env: input.env,
    ownerUserId: input.ownerUserId,
    requestId: input.requestId,
    targetProfileId: input.agentProfileId,
  });
  let response: GetAgentProfileControllerChangeEligibilityResponse;
  if (executionState.status === "inactive") {
    response = {
      agentProfileId: input.agentProfileId,
      reasonCode: "agent_profile_binding.controller_change_allowed",
      status: "allowed",
    };
  } else if (executionState.status === "active") {
    response = {
      agentProfileId: input.agentProfileId,
      reasonCode:
        "agent_profile_binding.controller_change_blocked_active_execution",
      status: "blocked",
    };
  } else {
    response = {
      agentProfileId: input.agentProfileId,
      reasonCode:
        "agent_profile_binding.controller_change_eligibility_unavailable",
      status: "unavailable",
    };
  }
  return getAgentProfileControllerChangeEligibilityResponseSchema.parse(
    response
  );
}
type AgentProfileExecutionTargetMutationAdmission =
  | {
      operationId: string;
      status: "acquired";
    }
  | {
      reasonCode: string;
      status: "blocked" | "unavailable";
    };
class AgentProfileExecutionTargetMutationAdmissionError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "AgentProfileExecutionTargetMutationAdmissionError";
    this.reasonCode = reasonCode;
  }
}
async function acquireAgentProfileExecutionTargetMutationAdmission(input: {
  agentProfileId: string;
  env: CoreBindings;
  ownerUserId: string;
}): Promise<AgentProfileExecutionTargetMutationAdmission> {
  return await acquireAgentProfileMutationAdmission({
    ...input,
    acquire: acquireRuntimeTransportAgentProfileExecutionTargetMutation,
    operationKind: "execution-target",
  });
}
async function acquireAgentProfileFutureWorkSettingsMutationAdmission(input: {
  agentProfileId: string;
  env: CoreBindings;
  ownerUserId: string;
}): Promise<AgentProfileExecutionTargetMutationAdmission> {
  return await acquireAgentProfileMutationAdmission({
    ...input,
    acquire: acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation,
    operationKind: "future-work-settings",
  });
}
async function acquireAgentProfileMutationAdmission(input: {
  acquire: typeof acquireRuntimeTransportAgentProfileExecutionTargetMutation;
  agentProfileId: string;
  env: CoreBindings;
  operationKind: "execution-target" | "future-work-settings";
  ownerUserId: string;
}): Promise<AgentProfileExecutionTargetMutationAdmission> {
  const operationId = `agent-profile-${input.operationKind}-mutation:${crypto.randomUUID()}`;
  const admission = await input.acquire({
    env: input.env,
    operationId,
    ownerUserId: input.ownerUserId,
    targetProfileId: input.agentProfileId,
  });
  if (admission.status === "acquired") {
    return { operationId, status: "acquired" };
  }
  if (admission.status === "blocked") {
    return {
      reasonCode: admission.reasonCode,
      status: "blocked",
    };
  }
  return {
    reasonCode: admission.reasonCode,
    status: "unavailable",
  };
}
function resolveControllerChangeAdmissionReasonCode(
  admission: Exclude<
    AgentProfileExecutionTargetMutationAdmission,
    {
      status: "acquired";
    }
  >
): GetAgentProfileControllerChangeEligibilityResponse["reasonCode"] {
  return admission.status === "blocked"
    ? "agent_profile_binding.controller_change_blocked_active_execution"
    : "agent_profile_binding.controller_change_eligibility_unavailable";
}
async function releaseAgentProfileExecutionTargetMutationAdmission(input: {
  agentProfileId: string;
  env: CoreBindings;
  operationId: string;
  ownerUserId: string;
}): Promise<void> {
  await releaseRuntimeTransportAgentProfileExecutionTargetMutation({
    env: input.env,
    operationId: input.operationId,
    ownerUserId: input.ownerUserId,
    targetProfileId: input.agentProfileId,
  }).catch((error) => {
    console.warn(
      "[core.agent_profile.execution_target_mutation_release_failed]",
      {
        agentProfileId: input.agentProfileId,
        error: toErrorMessage(error),
        operationId: input.operationId,
        ownerUserId: input.ownerUserId,
      }
    );
  });
}
async function withAgentProfileExecutionTargetMutationAdmission<T>(input: {
  agentProfileId: string;
  env: CoreBindings;
  mutate: () => Promise<T>;
  ownerUserId: string;
}): Promise<T> {
  const admission =
    await acquireAgentProfileFutureWorkSettingsMutationAdmission(input);
  if (admission.status !== "acquired") {
    throw new AgentProfileExecutionTargetMutationAdmissionError(
      resolveControllerChangeAdmissionReasonCode(admission)
    );
  }
  try {
    return await input.mutate();
  } finally {
    await releaseAgentProfileExecutionTargetMutationAdmission({
      agentProfileId: input.agentProfileId,
      env: input.env,
      operationId: admission.operationId,
      ownerUserId: input.ownerUserId,
    });
  }
}
function buildDisableAgentProfilePrimaryBindingResponse(input: {
  agentProfileId: string;
  disabled: boolean;
  reasonCodes?: readonly string[];
  status?: DisableAgentProfilePrimaryBindingResponse["status"];
}): DisableAgentProfilePrimaryBindingResponse {
  const response = {
    agentProfileId: input.agentProfileId,
    disabled: input.disabled,
    reasonCodes: [
      ...(input.reasonCodes ?? [
        input.disabled
          ? "agent_profile_binding.primary_binding_disabled"
          : "agent_profile_binding.missing",
      ]),
    ],
    status: input.status ?? (input.disabled ? "disabled" : "missing"),
  };
  const validated =
    disableAgentProfilePrimaryBindingResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Agent Profile Binding disable response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function requireCanonicalAgentControllerRef(value: string): string {
  const canonical = canonicalizeAgentControllerRef(value);
  if (!canonical) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "agentControllerRef is invalid",
      status: 400,
    });
  }
  return canonical;
}
function buildAgentProfileCreationDefaultsResponse(input: {
  agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
  agentControllerPermissionMode: AgentControllerPermissionMode | null;
  agentControllerRef: string;
  defaultProjectId: string | null;
  modelId: string | null;
  openCodePermission: AgentProfileBindingOpenCodePermission | null;
  organizationId: string;
  reasoningLevel: string | null;
  updatedAtMs: number | null;
  userId: string;
}): GetAgentProfileCreationDefaultsResponse {
  const response = {
    agentControllerCollaborationMode: input.agentControllerCollaborationMode,
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    agentControllerRef: input.agentControllerRef,
    defaultProjectId: input.defaultProjectId,
    modelId: input.modelId,
    openCodePermission: input.openCodePermission,
    organizationId: input.organizationId,
    reasoningLevel: input.reasoningLevel,
    updatedAt:
      input.updatedAtMs === null ? null : toIsoDateTime(input.updatedAtMs),
    userId: input.userId,
  };
  const validated =
    getAgentProfileCreationDefaultsResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Agent Profile creation defaults response: ${validated.error.message}`
    );
  }
  const setValidated = setAgentProfileCreationDefaultsResponseSchema.safeParse(
    validated.data
  );
  if (!setValidated.success) {
    throw new Error(
      `failed to build Agent Profile creation defaults set response: ${setValidated.error.message}`
    );
  }
  return validated.data;
}
function buildListAgentProfileCreationDefaultsResponse(input: {
  defaults: readonly AgentProfileCreationDefaultsRecord[];
  organizationId: string;
  userId: string;
}): ListAgentProfileCreationDefaultsResponse {
  return centerAgentListAgentProfileCreationDefaultsResponseSchema.parse({
    defaults: input.defaults.map((preference) =>
      buildAgentProfileCreationDefaultsResponse(preference)
    ),
    organizationId: input.organizationId,
    userId: input.userId,
  });
}
function buildGetAgentExecutionReadinessResponse(
  input: {
    generatedAt: string;
    readiness: CoreAgentExecutionReadiness;
  } & AgentExecutionReadinessResponseOptions
): GetAgentExecutionReadinessResponse {
  const readiness = input.readiness.agentExecutionReadiness;
  const response = {
    agentExecutionReadiness: {
      ...readiness,
      facts: {
        ...readiness.facts,
        providerConversation: {
          ...readiness.facts.providerConversation,
          method: projectProviderConversationProofMethod(
            readiness.facts.providerConversation.method,
            input.responseVersion
          ),
        },
      },
    },
    agentWakeAvailability: resolveHttpAgentWakeAvailability(input.readiness),
    agentWakeRouteRegistration: input.readiness.agentWakeRouteRegistration,
    agentProfileId: input.readiness.agentExecutionReadiness.agentProfileId,
    agentControllerRef: input.readiness.agentControllerRef,
    generatedAt: input.generatedAt,
    ownerUserId: input.readiness.ownerUserId,
    primaryBinding: input.readiness.primaryBinding
      ? toHttpAgentProfileBindingProjection(input.readiness.primaryBinding, {
          includeAgentControllerCollaborationMode: false,
        })
      : null,
    primaryActionPlan: buildAgentExecutionReadinessPrimaryActionPlan(
      input.readiness
    ),
    profileName: input.readiness.profileName,
    publicProfileConfiguration: {
      agentControllerCollaborationMode:
        input.readiness.primaryBinding?.agentControllerCollaborationMode ??
        null,
      agentControllerPermissionMode:
        input.readiness.agentControllerPermissionMode ?? null,
      agentControllerRef: input.readiness.agentControllerRef,
      modelSelection: input.readiness.modelSelection ?? null,
    },
    routeDeviceId: input.readiness.routeDeviceId,
    routeLane: input.readiness.routeLane,
    runtimeDeviceDisplayName: input.readiness.runtimeDeviceDisplayName,
    wakeRouteEvidence: input.readiness.daemonRouteObservation,
    wakeRouteStatus: input.readiness.wakeRouteStatus,
  } satisfies GetAgentExecutionReadinessResponseDraft;
  const validated =
    getAgentExecutionReadinessResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Agent Execution Readiness response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function buildOrganizationDirectoryAgentExecutionReadinessResponse(input: {
  generatedAt: string;
  isOwner: boolean;
  readiness: CoreAgentExecutionReadiness;
  usageResetAt?: string | null;
}): GetAgentExecutionReadinessResponse {
  const ownerResponse = buildGetAgentExecutionReadinessResponse(input);
  if (MEMBER_AGENTS_ENABLED) {
    ownerResponse.publicWakeabilityReason = resolvePublicWakeabilityReason({
      availability: ownerResponse.agentWakeAvailability,
      usageResetAt: input.usageResetAt ?? null,
    });
  }
  if (input.isOwner) {
    return ownerResponse;
  }
  return projectTeamSafeOrganizationDirectoryReadiness(ownerResponse);
}
// The reset time is read only for a current Usage Limit verdict, so the
// public reason never costs a second report read on the common path.
async function readPublicUsageExhaustedResetAt(input: {
  env: CoreBindings;
  generatedAt: string;
  profileId: string;
  readiness: CoreAgentExecutionReadiness;
  reads: AgentExecutionReadinessReads;
}): Promise<string | null> {
  if (
    !MEMBER_AGENTS_ENABLED ||
    resolveHttpAgentWakeAvailability(input.readiness).reasonCode !==
      AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE
  ) {
    return null;
  }
  const nowMs = Date.parse(input.generatedAt);
  try {
    return resolveUsageExhaustedResetAt({
      nowMs,
      usageLimits: await readAgentProfileUsage({
        binding: input.readiness.primaryBinding,
        db: getPostgresDatabase(input.env),
        nowMs,
        reads: input.reads,
      }),
    });
  } catch (error) {
    console.warn("[core.agent_profile.public_usage_reset_unavailable]", {
      error: toErrorMessage(error),
      profileId: input.profileId,
    });
    return null;
  }
}
export function projectTeamSafeOrganizationDirectoryReadiness(
  ownerResponse: GetAgentExecutionReadinessResponse
): GetAgentExecutionReadinessResponse {
  const agentWakeAvailability =
    projectTeamSafeOrganizationDirectoryWakeAvailability(
      ownerResponse.agentWakeAvailability
    );
  const response = {
    agentExecutionReadiness: {
      agentProfileId: ownerResponse.agentProfileId,
      displayState: resolveTeamSafeOrganizationDirectoryDisplayState(
        agentWakeAvailability.category
      ),
      facts: {
        profile: {
          active: false,
          reasonCodes: [],
          source: "not_checked",
        },
        binding: {
          reasonCodes: [],
          routable: false,
          source: "not_checked",
        },
        claim: {
          executionBlocked: false,
          grantsClaimSuccess: false,
          reasonCodes: [],
          source: "not_checked",
        },
        providerAccount: {
          blocked: false,
          expiresAtMs: null,
          observedAtMs: null,
          provider: null,
          reasonCodes: [],
          source: "not_checked",
        },
        providerConversation: {
          agentControllerConversationId: null,
          errorCode: null,
          errorMessage: null,
          errorType: null,
          expiresAtMs: null,
          method: null,
          observedAtMs: null,
          provider: null,
          ready: false,
          reasonCodes: [],
          required: false,
          source: "unavailable",
          status: "unavailable",
        },
        readinessImpact: {
          blocked: false,
          expiresAtMs: null,
          impactKind: null,
          observedAtMs: null,
          reasonCodes: [],
          source: "not_checked",
        },
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: [],
          source: "not_checked",
        },
        service: {
          executionCompatible: false,
          // The epoch is not owner-private; keep the owner's evaluated value.
          expectedEpoch:
            ownerResponse.agentExecutionReadiness.facts.service.expectedEpoch,
          observedEpoch: null,
          reasonCodes: [],
          source: "not_checked",
        },
        route: {
          deviceId: null,
          lane: null,
          observedAt: null,
          online: false,
          reasonCodes: [],
          source: "not_checked",
        },
        runtime: {
          ready: false,
          reasonCodes: [],
          source: "not_checked",
        },
      },
      primaryAction: "none",
      reasonCodes: [],
    },
    agentWakeAvailability,
    agentWakeRouteRegistration: {
      status: "unavailable",
      reasonCode: null,
      reportedAtMs: null,
      daemonSessionId: null,
      deviceId: null,
      lane: null,
      serviceVersion: null,
    },
    agentProfileId: ownerResponse.agentProfileId,
    agentControllerRef: null,
    generatedAt: ownerResponse.generatedAt,
    ownerUserId: null,
    primaryBinding: null,
    primaryActionPlan: {
      action: "none",
      target: null,
    },
    profileName: null,
    publicProfileConfiguration: ownerResponse.publicProfileConfiguration,
    ...(ownerResponse.publicWakeabilityReason === undefined
      ? {}
      : { publicWakeabilityReason: ownerResponse.publicWakeabilityReason }),
    routeDeviceId: null,
    routeLane: null,
    runtimeDeviceDisplayName: null,
    wakeRouteEvidence: {
      observedAt: ownerResponse.generatedAt,
      reasonCode: "not_requested",
      status: "unavailable",
    },
    wakeRouteStatus: {
      status: "unavailable",
    },
  } satisfies GetAgentExecutionReadinessResponse;
  const validated =
    getAgentExecutionReadinessResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build team-safe Organization Directory readiness response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function projectTeamSafeOrganizationDirectoryWakeAvailability(
  availability: GetAgentExecutionReadinessResponse["agentWakeAvailability"]
): GetAgentExecutionReadinessResponse["agentWakeAvailability"] {
  const sharesUsageExhausted =
    availability.category === "unavailable" &&
    availability.reasonCode === AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE &&
    availability.status === "unavailable_for_wake";
  const shared = {
    action: "none" as const,
    category: availability.category,
    reasonCode: sharesUsageExhausted
      ? AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE
      : null,
    status: availability.status,
  };
  switch (availability.category) {
    case "available":
      return {
        ...shared,
        badgeLabel: "Available",
        isRefreshing: false,
        label: "Available for Wake",
        phase: "available",
        summary: "This Agent is available for Wake.",
        tooltip: "Available for Wake",
      };
    case "checking":
      return {
        ...shared,
        badgeLabel: "Checking",
        isRefreshing: true,
        label: "Checking Wake availability",
        phase: "checking_status",
        summary: "Checking whether this Agent is available for Wake.",
        tooltip: "Checking Wake availability",
      };
    case "offline":
      return {
        ...shared,
        badgeLabel: "Offline",
        isRefreshing: false,
        label: "Offline for Wake",
        phase: "offline",
        summary: "This Agent is offline for Wake.",
        tooltip: "Offline for Wake",
      };
    case "unavailable":
      if (sharesUsageExhausted) {
        return {
          ...shared,
          badgeLabel: "Unavailable",
          isRefreshing: false,
          label: "Usage Limit reached",
          phase: "unavailable",
          summary:
            "This Agent reached a Usage Limit and cannot start new work.",
          tooltip: "Usage Limit reached",
        };
      }
      return {
        ...shared,
        badgeLabel: "Unavailable",
        isRefreshing: false,
        label: "Unavailable for Wake",
        phase: "unavailable",
        summary: "This Agent is unavailable for Wake.",
        tooltip: "Unavailable for Wake",
      };
    default: {
      const exhaustiveCategory: never = availability.category;
      throw new Error(
        `unsupported Organization Directory Wake availability category: ${exhaustiveCategory}`
      );
    }
  }
}
function resolveTeamSafeOrganizationDirectoryDisplayState(
  category: GetAgentExecutionReadinessResponse["agentWakeAvailability"]["category"]
): GetAgentExecutionReadinessResponse["agentExecutionReadiness"]["displayState"] {
  switch (category) {
    case "available":
      return "ready";
    case "checking":
      return "unknown";
    case "offline":
    case "unavailable":
      return "not_ready";
    default: {
      const exhaustiveCategory: never = category;
      throw new Error(
        `unsupported Organization Directory Wake availability category: ${exhaustiveCategory}`
      );
    }
  }
}
function resolveHttpAgentWakeAvailability(
  readiness: CoreAgentExecutionReadiness
): GetAgentExecutionReadinessResponse["agentWakeAvailability"] {
  if (isHostedAgentControllerRef(readiness.agentControllerRef)) {
    return resolveHostedAgentWakeAvailability({
      readiness: readiness.agentExecutionReadiness,
    });
  }
  return resolveAgentWakeAvailability({
    agentControllerRef: readiness.agentControllerRef,
    agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
    wakeRouteStatus: readiness.wakeRouteStatus,
    readiness: readiness.agentExecutionReadiness,
  });
}
function buildAgentExecutionReadinessPrimaryActionPlan(
  readiness: CoreAgentExecutionReadiness
): GetAgentExecutionReadinessResponse["primaryActionPlan"] {
  const action = readiness.agentExecutionReadiness.primaryAction;
  switch (action) {
    case "none":
      return { action, target: null };
    case "connect_service":
      return {
        action,
        target: {
          kind: "openmeld_service_connection",
        },
      };
    case "reconnect_binding":
      if (readiness.agentControllerRef) {
        return {
          action,
          target: {
            agentControllerRef: readiness.agentControllerRef,
            kind: "local_agent_connection",
          },
        };
      }
      return {
        action,
        target: {
          kind: "choose_local_agent",
        },
      };
    case "run_prepare":
      return {
        action,
        target: {
          kind: "current_computer",
        },
      };
    case "update_service":
      return {
        action,
        target: {
          kind: "openmeld_service",
        },
      };
    case "check_status":
      return {
        action,
        target: {
          kind: "status",
        },
      };
    case "fix_provider_account": {
      const provider =
        readiness.agentExecutionReadiness.facts.providerAccount.provider;
      if (!provider) {
        throw new Error(
          "provider account repair action requires provider account evidence"
        );
      }
      return {
        action,
        target: {
          kind: "provider_account",
          provider,
        },
      };
    }
    default: {
      const exhaustiveAction: never = action;
      throw new Error(
        `unsupported Agent Execution Readiness primary action: ${exhaustiveAction}`
      );
    }
  }
}
function buildGetAgentExecutionReadinessBatchResponse(
  input: {
    generatedAt: string;
    readinessItems: readonly CoreAgentExecutionReadiness[];
  } & AgentExecutionReadinessResponseOptions
): GetAgentExecutionReadinessBatchResponse {
  const response = {
    items: input.readinessItems.map((readiness) =>
      buildGetAgentExecutionReadinessResponse({
        generatedAt: input.generatedAt,
        readiness,
        responseVersion: input.responseVersion,
      })
    ),
  } satisfies GetAgentExecutionReadinessBatchResponse;
  const validated =
    getAgentExecutionReadinessBatchResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Agent Execution Readiness batch response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function buildAcceptedAgentProfileBindingResponse(input: {
  binding: AgentProfileBindingProjection;
  result: Extract<
    AgentProfileBindingCommandResult,
    {
      status: "accepted";
    }
  >;
}): EnsureAgentProfilePrimaryBindingResponse {
  const response = {
    binding: input.binding,
    grantsClaimSuccess: false,
    outcome: input.result.outcome,
    reasonCodes: input.result.reasonCodes,
    routable: input.result.routable,
    status: "accepted" as const,
  };
  const validated =
    ensureAgentProfilePrimaryBindingResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Agent Profile Binding command response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function buildRejectedAgentProfileBindingResponse(
  reasonCodes: readonly string[]
): EnsureAgentProfilePrimaryBindingResponse {
  const response = {
    grantsClaimSuccess: false,
    reasonCodes,
    routable: false,
    status: "rejected" as const,
  };
  const validated =
    ensureAgentProfilePrimaryBindingResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Agent Profile Binding rejection response: ${validated.error.message}`
    );
  }
  return validated.data;
}
function throwAgentProfileBindingCommandHttpError(error: unknown): never {
  if (error instanceof AgentProfileBindingModelSelectionValidationError) {
    throw createCoreRpcHttpError({
      status: 400,
      code: error.code,
      reason: error.message,
    });
  }
  throw error;
}
async function resolveProfileOwnerValidationEvidence(input: {
  agentProfileId: string;
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"] | undefined;
  reads?: AgentExecutionReadinessReads;
}): Promise<AgentProfileBindingProfileOwnerValidationEvidence> {
  if (!input.authWorker?.resolveProfileById) {
    return {
      reasonCode: "agent_profile_binding.profile_owner_unavailable",
      status: "unavailable",
    };
  }
  let result: Awaited<
    ReturnType<
      NonNullable<
        NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>["resolveProfileById"]
      >
    >
  >;
  try {
    result = input.reads
      ? await input.reads.resolveProfileById({
          authWorker: input.authWorker as Parameters<
            AgentExecutionReadinessReads["resolveProfileById"]
          >[0]["authWorker"],
          profileId: input.agentProfileId,
        })
      : await input.authWorker.resolveProfileById({
          openMeldProfileId: input.agentProfileId,
        });
  } catch {
    return {
      reasonCode: "agent_profile_binding.profile_owner_unavailable",
      status: "unavailable",
    };
  }
  if (!result.ok) {
    return {
      reasonCode:
        result.code === "profile.not_found"
          ? "agent_profile_binding.profile_owner_invalid"
          : "agent_profile_binding.profile_owner_unavailable",
      status: result.code === "profile.not_found" ? "invalid" : "unavailable",
    };
  }
  if (result.profile.profileKind !== "agent") {
    return {
      reasonCode: "agent_profile_binding.profile_owner_invalid",
      status: "invalid",
    };
  }
  if (result.profile.profileId !== input.agentProfileId) {
    return {
      reasonCode: "agent_profile_binding.profile_owner_invalid",
      status: "invalid",
    };
  }
  const ownerUserId = String(result.profile.ownerUserId ?? "").trim();
  if (!ownerUserId) {
    return {
      reasonCode: "agent_profile_binding.profile_owner_unavailable",
      status: "unavailable",
    };
  }
  return {
    owner: {
      id: ownerUserId,
      kind: "owner_account",
    },
    status: "valid",
  };
}
function mapAgentProfileBindingLookupResultToProjection(
  result: AgentProfileBindingLookupResult
): AgentProfileBindingProjection {
  return toHttpAgentProfileBindingProjection(result.displayProjection);
}
function mapMissingAgentProfileBindingProjection(input: {
  agentProfileId: string;
  reasonCodes: readonly string[];
}): AgentProfileBindingProjection {
  return {
    agentProfileId: input.agentProfileId,
    authoritySource: "none",
    bindingState: "missing",
    dispatchEligibility: {
      reasonCodes: [...input.reasonCodes],
      routable: false,
      status: "not_routable",
    },
    grantsClaimSuccess: false,
    reasonCodes: [...input.reasonCodes],
    resolutionSource: "missing_projection",
    routable: false,
    executionTarget: null,
  };
}
function ownersEqual(
  left: AgentProfileBindingOwner,
  right: AgentProfileBindingOwner
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
function throwUnauthenticated(): never {
  throw createCoreRpcHttpError({
    status: 401,
    reason: "authentication required",
    code: "auth.unauthenticated",
  });
}
function encodeBytesAsBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}
function decodeBase64Bytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Slack file content must be valid base64.",
      status: 400,
    });
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function toSpaceCreator(context: CoreRpcContextInput): SpaceCreator {
  const actorContext = context.actorContext;
  return {
    profileId: actorContext.openMeldProfileId,
    ...(actorContext.profileName
      ? { profileName: actorContext.profileName }
      : {}),
    kind: actorContext.profileKind,
    ...(actorContext.ownerUserId
      ? { ownerUserId: actorContext.ownerUserId }
      : {}),
    ...(actorContext.ownerName ? { ownerName: actorContext.ownerName } : {}),
  };
}
export type GetSpaceMessageReactionsInput = ReactionReadInput &
  CoreRpcSpaceAccessInput;
export type SetSpaceMessageReactionInput = ReactionWriteInput &
  CoreRpcSpaceAccessInput;
export async function rpcGetSpaceMessageReactions(
  env: CoreBindings,
  input: GetSpaceMessageReactionsInput
): Promise<GetSpaceMessageReactionsResponse> {
  const query = getSpaceMessageReactionsInputSchema.parse(input);
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcGetMessageReactions({ ...query, spaceAccess });
}
export async function rpcSetSpaceMessageReaction(
  env: CoreBindings,
  input: SetSpaceMessageReactionInput
): Promise<GetSpaceMessageReactionsResponse> {
  const body = setSpaceMessageReactionInputSchema.parse(input);
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcSetMessageReaction({ ...body, spaceAccess });
}
export function rpcGetSpaceHistoryNavigation(
  env: CoreBindings,
  input: GetSpaceMembersInput & SpaceHistoryNavigationQuery
): Promise<SpaceHistoryNavigation> {
  const spaceAccess = resolveRpcSpaceAccess(input);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return stub.rpcGetHistoryNavigation({ ...input, spaceId, spaceAccess });
}
export type SpaceMessagePinsInput = GetSpaceMetaInput & {
  mutation?: SpaceMessagePinMutation;
};
export type SpaceFilePinsInput = GetSpaceMetaInput & {
  mutation?: SpaceFilePinMutation;
};

export type SpaceInputQueueInput = GetSpaceMetaInput &
  import("@openmeld/schemas/types").SpaceInputQueueOptions & {
    mutation?: SpaceInputQueueMutation;
  };

export async function rpcSpaceInputQueue(
  env: CoreBindings,
  input: SpaceInputQueueInput
): Promise<SpaceInputQueueResponse> {
  const context = requireRpcContext(input.context);
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcInputQueue({ ...input, spaceId, context });
}

export type ListSpaceTasksInput = GetSpaceMetaInput & {
  phase?: SpaceTaskPhase;
  taskContractVersion?: 2 | typeof SPACE_TASK_WORKFLOW_CONTRACT_VERSION;
};
export type GetSpaceTaskInput = GetSpaceMetaInput &
  SpaceTaskDetailOptions & {
    taskId: string;
  };
export type CreateSpaceTaskInput = GetSpaceMetaInput & {
  body: CreateSpaceTaskBody;
  taskContractVersion?: 2 | typeof SPACE_TASK_WORKFLOW_CONTRACT_VERSION;
};
export type MutateSpaceTaskInput = GetSpaceMetaInput & {
  taskId: string;
  body: MutateSpaceTaskBody;
  // Internal Core-to-Space projection. The public RPC always recomputes it.
  representedRequester?: import("@openmeld/schemas/types").SpaceTaskActor;
  taskContractVersion?: 2 | typeof SPACE_TASK_WORKFLOW_CONTRACT_VERSION;
};
export async function rpcSpaceFilePins(
  env: CoreBindings,
  input: SpaceFilePinsInput
): Promise<SpaceFilePinsResponse> {
  const context = input.mutation
    ? requireRpcContext(input.context)
    : input.context;
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcFilePins({
    ...input,
    spaceId,
    context,
    spaceAccess: resolveRpcSpaceAccess(input),
  });
}
export async function rpcSpaceMessagePins(
  env: CoreBindings,
  input: SpaceMessagePinsInput
): Promise<SpaceMessagePinsResponse> {
  const context = input.mutation
    ? requireRpcContext(input.context)
    : input.context;
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcMessagePins({
    ...input,
    spaceId,
    context,
    spaceAccess: resolveRpcSpaceAccess(input),
  });
}
export async function rpcListSpaceTasks(
  env: CoreBindings,
  input: ListSpaceTasksInput
): Promise<ListSpaceTasksResponse> {
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const context = input.context
    ? await authorizeSpaceTaskRpcContext(env, spaceId, input.context)
    : undefined;
  const listed = await stub.rpcListTasks({
    ...input,
    spaceId,
    context,
    spaceAccess: resolveRpcSpaceAccess({ ...input, context }),
  });
  return projectSpaceTasksForClient(listed, input.taskContractVersion);
}
export async function rpcGetSpaceTask(
  env: CoreBindings,
  input: GetSpaceTaskInput
): Promise<SpaceTaskResponse> {
  const options = spaceTaskDetailOptionsSchema.parse({
    includeAffordances: input.includeAffordances,
    taskContractVersion: input.taskContractVersion,
  });
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const context = input.context
    ? await authorizeSpaceTaskRpcContext(env, spaceId, input.context)
    : undefined;
  const detail = await stub.rpcGetTask({
    ...input,
    ...options,
    spaceId,
    context,
    spaceAccess: resolveRpcSpaceAccess({ ...input, context }),
  });
  return projectSpaceTaskDetailForClient(detail, input.taskContractVersion);
}
export async function rpcCreateSpaceTask(
  env: CoreBindings,
  input: CreateSpaceTaskInput
): Promise<SpaceTaskMutationReceipt> {
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const context = await authorizeSpaceTaskRpcContext(
    env,
    spaceId,
    requireRpcContext(input.context)
  );
  const parsedBody = createSpaceTaskBodySchema.parse(input.body);
  if (
    parsedBody.projectIds?.length &&
    input.taskContractVersion === undefined
  ) {
    throw spaceTaskContractUpdateRequiredError();
  }
  if (
    parsedBody.externalWorkItems?.some((item) => item.provider === "linear") &&
    input.taskContractVersion === undefined
  ) {
    throw spaceTaskContractUpdateRequiredError();
  }
  if (parsedBody.projectIds?.length) {
    await assertSpaceTaskProjectsAvailable(env, {
      context,
      input,
      projectIds: parsedBody.projectIds,
      spaceId,
    });
  }
  let body = input.body;
  const submissionId = context.agentControllerConversationId?.trim();
  const db = getPostgresDatabase(env);
  if (!body.sourceSignalId && submissionId && db) {
    const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
      db,
      submissionId,
    });
    if (
      delivery?.conversationKind === "space" &&
      delivery.spaceId === spaceId &&
      delivery.profileId === context.actorContext.openMeldProfileId
    ) {
      body = {
        ...body,
        sourceSignalId: delivery.triggerMessageId,
        threadId: body.threadId ?? delivery.threadContext?.threadId ?? null,
      };
    }
  }
  const receipt = await stub.rpcCreateTask({
    ...input,
    body,
    spaceId,
    context,
  });
  return projectSpaceTaskReceiptForClient(receipt, input.taskContractVersion);
}
export async function rpcMutateSpaceTask(
  env: CoreBindings,
  input: MutateSpaceTaskInput
): Promise<SpaceTaskMutationReceipt> {
  const { spaceId, stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const context = await authorizeSpaceTaskRpcContext(
    env,
    spaceId,
    requireRpcContext(input.context)
  );
  if (
    input.taskContractVersion !== SPACE_TASK_WORKFLOW_CONTRACT_VERSION &&
    input.taskContractVersion === undefined &&
    (input.body.action === "set_projects" ||
      input.body.action === "detach_linear_external_work_item" ||
      (input.body.action === "attach_external_work_item" &&
        input.body.item.provider === "linear"))
  ) {
    throw spaceTaskContractUpdateRequiredError();
  }
  if (input.body.action === "set_projects") {
    const command = mutateSpaceTaskBodySchema.parse(input.body);
    if (command.action === "set_projects" && command.projectIds.length) {
      await assertSpaceTaskProjectsAvailable(env, {
        context,
        input,
        projectIds: command.projectIds,
        spaceId,
      });
    }
  }
  const { resolveSpaceTaskRepresentedRequester } = await import(
    "../space/application/space-task-delegation"
  );
  const submissionId = context.agentControllerConversationId;
  let representedRequester: MutateSpaceTaskInput["representedRequester"];
  if (
    context.actorContext.agentControllerRef ===
      HOSTED_CENTER_AGENT_CONTROLLER_REF &&
    submissionId &&
    ["assign", "set_reviewer", "update_brief"].includes(input.body.action)
  ) {
    const { authorizeRemoteAgentExecutionAccess } = await import(
      "../remote-agent/application/remote-agent-execution-access"
    );
    await authorizeRemoteAgentExecutionAccess(env, { context, submissionId });
    const parent = await requireCenterAgentContinuationParent({
      actorProfileId: context.actorContext.openMeldProfileId ?? "",
      db: requireCenterAgentDb(env),
      organizationId: context.activeOrganizationId ?? "",
      parentSubmissionId: submissionId,
      destinationNeutralContinuations: true,
      resumesParent: false,
    });
    representedRequester = resolveSpaceTaskRepresentedRequester(
      parent,
      spaceId
    );
  }
  const receipt = await stub.rpcMutateTask({
    ...input,
    spaceId,
    context,
    representedRequester,
  });
  return projectSpaceTaskReceiptForClient(receipt, input.taskContractVersion);
}

async function assertSpaceTaskProjectsAvailable(
  env: CoreBindings,
  input: {
    context: CoreRpcContextInput;
    input: GetSpaceMetaInput;
    projectIds: string[];
    spaceId: string;
  }
): Promise<void> {
  const meta = await rpcGetSpaceMeta(env, {
    ...input.input,
    context: input.context,
    spaceId: input.spaceId,
  });
  if (
    !input.context.activeOrganizationId ||
    meta.organizationId !== input.context.activeOrganizationId
  ) {
    throw createCoreRpcHttpError({
      code: "project.organization_context_changed",
      reason: "The selected Organization changed. Refresh and try again.",
      status: 409,
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "project.store_unavailable",
      reason: "Project storage is unavailable.",
      status: 503,
    });
  }
  const active = await readActiveProjectIds({
    db,
    organizationId: meta.organizationId,
    projectIds: input.projectIds,
  });
  if (active.length !== input.projectIds.length) {
    throw createCoreRpcHttpError({
      code: "project.association_unavailable",
      reason:
        "One or more selected Projects are unavailable in this Organization. Refresh the Task and choose active Projects.",
      status: 409,
    });
  }
}
async function authorizeSpaceTaskRpcContext(
  env: CoreBindings,
  spaceId: string,
  context: CoreRpcContextInput
): Promise<CoreRpcContextInput> {
  if (!isHostedAgentControllerRef(context.actorContext.agentControllerRef)) {
    return context;
  }
  const authorization = await requireRemoteAgentToolCaller({ context, env });
  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId,
  });
  return authorization.context;
}

import { centerAgentSetReplyPlacementInputSchema } from "@openmeld/schemas";
import type {
  CenterAgentSetReplyPlacementInput,
  NativeReplyPlacement,
} from "@openmeld/schemas/types";
import { resolveNativeDeliveryReplyPlacement } from "../remote-agent/application/reply-placement";
export async function rpcCenterAgentSetReplyPlacement(
  env: CoreBindings,
  input: CenterAgentSetReplyPlacementInput
): Promise<NativeReplyPlacement> {
  const parsed = centerAgentSetReplyPlacementInputSchema.parse(input);
  const authorization = await prepareHostedCenterAgentRequest(
    env,
    requireRpcContext(parsed.context)
  );
  const submissionId =
    authorization.context.agentControllerConversationId?.trim();
  const db = getPostgresDatabase(env);
  if (!(submissionId && db)) {
    throw centerAgentTurnDiagnosticsUnavailableError();
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  if (
    !delivery ||
    (delivery.status !== "accepted" && delivery.status !== "retry_observed") ||
    delivery.routineRunId ||
    delivery.conversationKind !== "space" ||
    delivery.organizationId !==
      authorization.activeOrganization.organizationId ||
    delivery.profileId !== authorization.actorProfileId
  ) {
    throw centerAgentTurnDiagnosticsUnavailableError();
  }
  const placement = await resolveNativeDeliveryReplyPlacement({
    env,
    delivery,
    lock: false,
    placement: parsed.placement,
  });
  if (!placement) {
    throw centerAgentTurnDiagnosticsUnavailableError();
  }
  return placement;
}

import {
  sessionHistoryAgentRpcInputSchema,
  sessionHistoryRpcInputSchema,
} from "@openmeld/schemas";
import type {
  SessionHistoryAgentRpcInput,
  SessionHistoryRpcInput,
} from "@openmeld/schemas/types";
import { prepareDelegatedPluginActions } from "../center-agent/application/delegated-plugin-authorization";
import { requireSessionHistoryHostedRequester } from "../computers/session-history-hosted-requester";
import { requireSessionHistoryLocalRequester } from "../computers/session-history-local-requester";
import { requestComputerSessionHistory } from "../computers/session-history-transport";

export async function rpcAgentSessionHistory(
  env: CoreBindings,
  input: SessionHistoryAgentRpcInput
) {
  const parsed = sessionHistoryAgentRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid history read.",
    });
  }
  const { context, computerId, request } = parsed.data;
  const { organizationId, requester } =
    await requireSessionHistoryHostedRequester(env, context);
  const { ownerUserId } = requester;
  const target = await resolveSessionHistoryAgentTarget(
    env,
    ownerUserId,
    computerId
  );
  return requestComputerSessionHistory({
    env,
    ownerUserId,
    deviceId: target.deviceId,
    runtimeLane: target.lane,
    request: {
      organizationId,
      expectedDeviceId: target.deviceId,
      request,
      requester,
    },
  });
}

async function resolveSessionHistoryAgentTarget(
  env: CoreBindings,
  ownerUserId: string,
  computerId: string
) {
  const { localRuntimes, ownerService } =
    await resolveCurrentLocalServiceContext({ env, userId: ownerUserId });
  const computer = localRuntimes.localRuntimes.find(
    (entry) => entry.connectedComputerId === computerId
  );
  if (!(computer && ownerService.online)) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "session_history.denied",
      reason: "The source Computer is unavailable to this requester.",
    });
  }
  const sessions = ownerService.sessions.filter((session) =>
    peopleComputerContainsDevice(computer, session.deviceId)
  );
  const targets = [
    ...new Map(
      sessions.map((session) => [
        `${session.deviceId}/${session.lane}`,
        session,
      ])
    ).values(),
  ];
  const target = targets.length === 1 ? targets[0] : undefined;
  if (!target) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "session_history.target_unavailable",
      reason:
        "The source Computer must have one connected environment for agent history reads.",
    });
  }

  return target;
}

export async function rpcComputerPowerSettings(
  env: CoreBindings,
  raw: ComputerPowerRpcInput
) {
  const input = computerPowerRpcInputSchema.parse(raw);
  const ownerUserId = requireAuthenticatedOwnerUserId(input.context);
  if (
    input.context.actorContext.profileKind !== "human" ||
    input.context.actorContext.callerPrincipalId !== ownerUserId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "computer.power.denied",
      reason: "Only the computer owner can manage sleep prevention.",
    });
  }
  const target = { deviceId: input.deviceId, runtimeLane: input.runtimeLane };
  const { localRuntimes, ownerService } =
    await resolveCurrentLocalServiceContext({
      env,
      userId: ownerUserId,
      target,
    });
  requirePeopleComputerControlSession({
    target,
    inventory: localRuntimes,
    ownerService,
  });
  const result = computerPowerResultSchema.parse(
    await callPowerTransport({
      env,
      ownerUserId,
      path: "/computer-power",
      body: {
        ownerUserId,
        deviceId: target.deviceId,
        lane: target.runtimeLane,
        requestId: crypto.randomUUID(),
        request: input.request,
      },
    })
  );
  if ("status" in result) {
    throw createCoreRpcHttpError({
      status: 409,
      code: result.code,
      reason: result.message,
    });
  }
  return result;
}

import {
  localAgentSetupRequestSchema,
  localAgentSetupStateSchema,
} from "@openmeld/schemas";
import { requireAcceptedInstallationControlPayload } from "./local-agent-control-policy";
