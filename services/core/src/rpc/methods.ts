import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  parseAgentControllerRef,
  type RuntimeLookupInput,
  resolveAgentWakeAvailability,
  resolveHostedAgentWakeAvailability,
} from "@openmeld/agent-runtime";
import {
  memberRoleHasOrganizationPermission,
  type OrganizationPermissionCheck,
} from "@openmeld/auth";
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
import { buildProfileDisplay, MAX_TEXT_LENGTH } from "@openmeld/protocol";
import {
  accountSpaceActiveWakeSummaryRpcInputSchema,
  addCenterAgentToSpaceBodySchema,
  addOrganizationDirectoryProfilesToSpaceBodySchema,
  agentExecutionReadinessRouteParamsSchema,
  agentProfileBindingRouteParamsSchema,
  authorizeAgentProfileBindingForOrganizationResponseSchema,
  authRpcResolveUserDisplayNameResultSchema,
  buildAgentTaskKey,
  bulkAuthorizeAgentProfileBindingsForOrganizationBodySchema,
  bulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema,
  centerAgentAddAgentProfilesToSpaceBodySchema,
  centerAgentAddAgentProfilesToSpaceResponseSchema,
  centerAgentAddMembersToSpaceBodySchema,
  centerAgentAddMembersToSpaceResponseSchema,
  centerAgentCheckAgentProfileReadinessBodySchema,
  centerAgentCheckAgentProfileReadinessResponseSchema,
  centerAgentConnectAgentProfileToLocalAgentBodySchema,
  centerAgentConnectAgentProfileToLocalAgentResponseSchema,
  centerAgentCreateAgentProfileBodySchema,
  centerAgentCreateAgentProfileResponseSchema,
  centerAgentCreateConfiguredAgentProfileBodySchema,
  centerAgentCreateConfiguredAgentProfileResponseSchema,
  centerAgentCreateSpaceBodySchema,
  centerAgentCreateSpaceResponseSchema,
  centerAgentEnableAgentProfileBodySchema,
  centerAgentEnableAgentProfileResponseSchema,
  centerAgentListAgentTasksBodySchema,
  centerAgentListAgentTasksResponseSchema,
  centerAgentListComputersBodySchema,
  centerAgentListComputersResponseSchema,
  centerAgentListLocalAgentConnectionCandidatesBodySchema,
  centerAgentListLocalAgentConnectionCandidatesResponseSchema,
  centerAgentListSlackChannelsBodySchema,
  centerAgentOrganizationMemoryPolicyResponseSchema,
  centerAgentPostSlackChannelMessageBodySchema,
  centerAgentPostSpaceMessageBodySchema,
  centerAgentPostSpaceMessageResponseSchema,
  centerAgentReadConnectorActionOperationBodySchema,
  centerAgentReadConnectorActionOperationResponseSchema,
  centerAgentReadDispatchHistoryBodySchema,
  centerAgentReadDispatchHistoryResponseSchema,
  centerAgentReadMemberOpenMeldServiceStatusBodySchema,
  centerAgentReadMemberOpenMeldServiceStatusResponseSchema,
  centerAgentReadSlackChannelHistoryBodySchema,
  centerAgentReadSlackChannelMembersBodySchema,
  centerAgentReadSlackWorkspaceDirectoryBodySchema,
  centerAgentReadSpaceContextBodySchema,
  centerAgentReadSpaceContextResponseSchema,
  centerAgentRecordConnectorActionAuditBodySchema,
  centerAgentRecordConnectorActionAuditResponseSchema,
  centerAgentRecordConnectorActionOperationBodySchema,
  centerAgentRecordConnectorActionOperationResponseSchema,
  centerAgentRememberForOrganizationBodySchema,
  centerAgentRememberForOrganizationResponseSchema,
  centerAgentRemoveAgentProfilesFromSpaceBodySchema,
  centerAgentRemoveAgentProfilesFromSpaceResponseSchema,
  centerAgentSearchSlackMessagesBodySchema,
  centerAgentSearchSlackMessagesResponseSchema,
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
  centerAgentWatchAgentTaskBodySchema,
  centerAgentWatchAgentTaskResponseSchema,
  centerAgentWipeMemberMemoryResponseSchema,
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
  createConnectorAppRequestBodySchema,
  createSpaceDiagnosticReportBodySchema,
  currentDeviceTargetDeviceIdSchema,
  currentDeviceTargetResponseSchema,
  currentLocalRuntimeReplyReadinessResponseSchema,
  daemonServiceLaneSchema,
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
  forgetComputerResponseSchema,
  forgetComputerRouteParamsSchema,
  forgetCurrentComputerResponseSchema,
  getActiveSpaceWakeProgressInputSchema,
  getAgentExecutionReadinessBatchBodySchema,
  getAgentExecutionReadinessBatchResponseSchema,
  getAgentExecutionReadinessResponseSchema,
  getAgentProfilePrimaryBindingResponseSchema,
  getCenterAgentDesignationResponseSchema,
  getCenterAgentDirectMessageSpaceProjectionResponseSchema,
  getCenterAgentOperatingStateResponseSchema,
  getLocalRuntimeExpectedRoutesQuerySchema,
  getOrganizationBindingAuthorizationPreferenceResponseSchema,
  getPrepareReadinessQuerySchema,
  getPrepareReadinessResponseSchema,
  getSpaceBoardInputSchema,
  getSpaceConversationStateInputSchema,
  getSpaceDispatchLookupInputSchema,
  getSpaceDispatchResultInputSchema,
  getSpaceMessageDetailsInputSchema,
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
  larkPlatformActiveRegistrationListResponseSchema,
  larkPlatformProviderSchema,
  larkPlatformRegistrationAttemptIdSchema,
  listCenterAgentAuditJournalQuerySchema,
  listCenterAgentAuditJournalResponseSchema,
  listCurrentUserAgentProfileOrganizationWakeAccessResponseSchema,
  listOrganizationBindingAuthorizationProfilesResponseSchema,
  listOrganizationBindingAuthorizationsResponseSchema,
  listSpaceThreadSignalsQuerySchema,
  localRuntimeEnrollmentBodySchema,
  localRuntimeEnrollmentResponseSchema,
  localRuntimesResponseSchema,
  MAX_SPACE_NAME_LENGTH,
  messageChannelConnectionListResponseSchema,
  messageChannelIdentityLinkConsumeBodySchema,
  messageChannelIdentityLinkConsumeResponseSchema,
  messageChannelIdentityLinkPreviewBodySchema,
  messageChannelIdentityLinkPreviewResponseSchema,
  normalizeSpaceCursorPatch,
  normalizeSpacePasswordText,
  notifyAgentProfileRouteCatalogChangedBodySchema,
  notifyAgentProfileRouteCatalogChangedResponseSchema,
  notifyAgentProfilesRouteCatalogChangedBodySchema,
  openCenterAgentDirectMessageSpaceResponseSchema,
  openDirectMessageSpaceResponseSchema,
  openMeldRequestContextSchema,
  organizationDirectoryResponseSchema,
  organizationInformationProtectionPolicyResponseSchema,
  organizationMemberOpenMeldServiceStatusesResponseSchema,
  organizationSpaceDirectoryResponseSchema,
  organizationSpaceDirectoryWithMemberCountsResponseSchema,
  patchSpaceContractBodySchema,
  patchSpaceMetaBodySchema,
  pendingGitHubAppInstallationSchema,
  postSpaceWakeStopInputSchema,
  prepareReadinessRouteParamsSchema,
  profileSpaceHistoryGatewayHostSchema,
  recordSpaceAttachmentPayloadSchema,
  refreshCurrentLocalAgentCatalogResponseSchema,
  remoteAgentTransientSlackSearchRequestSchema,
  remoteAgentTransientSlackSearchResponseSchema,
  resolvedSpaceMemberProfileSchema,
  resolveSpaceAttachmentForDownloadPayloadSchema,
  respondToSpaceAgentInteractionInputSchema,
  revokeAgentProfileBindingForOrganizationResponseSchema,
  runtimeReportingRouteParamsSchema,
  saveOrganizationWakeAccessChoiceBodySchema,
  saveOrganizationWakeAccessChoiceResponseSchema,
  setCurrentAgentProfileWorkspaceBodySchema,
  setCurrentAgentProfileWorkspaceResponseSchema,
  setCurrentAgentProfileWorkspaceRouteParamsSchema,
  setCurrentLocalAgentEnabledBodySchema,
  setCurrentLocalAgentEnabledResponseSchema,
  setCurrentLocalAgentEnabledRouteParamsSchema,
  setLocalRuntimeDisplayNameBodySchema,
  setOrganizationBindingAuthorizationPreferenceBodySchema,
  setOrganizationBindingAuthorizationPreferenceResponseSchema,
  slackChannelHistoryResponseSchema,
  slackChannelListResponseSchema,
  slackChannelMembersResponseSchema,
  slackIdentityLinkConsumeBodySchema,
  slackIdentityLinkConsumeResponseSchema,
  slackIdentityLinkPreviewBodySchema,
  slackIdentityLinkPreviewResponseSchema,
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
  submitRuntimeAgentControllerReportsBodySchema,
  submitRuntimeAgentControllerReportsResponseSchema,
  submitRuntimeProviderConversationProofsBodySchema,
  submitRuntimeProviderConversationProofsResponseSchema,
  submitRuntimeRegistrationBodySchema,
  submitRuntimeRegistrationResponseSchema,
  updateAgentProfileDefaultProjectRpcInputSchema,
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
  AgentActivitySnapshotRpcInput,
  AgentActivityStatsRpcInput,
  AgentExecutionReadinessTargetRuntime,
  AgentProfileBindingProjection,
  AgentStreamToolPart,
  AgentTaskCompletionCondition,
  ArchiveProjectRpcInput,
  AuthorizeAgentProfileBindingForOrganizationResponse,
  BulkAuthorizeAgentProfileBindingsForOrganizationBody,
  BulkAuthorizeAgentProfileBindingsForOrganizationResponse,
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
  CenterAgentCreateConfiguredAgentProfileResponse,
  CenterAgentCreateSpaceBody,
  CenterAgentCreateSpaceResponse,
  CenterAgentDelegationCompletionMode,
  CenterAgentDirectMessageSpaceProjection,
  CenterAgentDispatchHistoryEntry,
  CenterAgentEnableAgentProfileBody,
  CenterAgentEnableAgentProfileResponse,
  CenterAgentListAgentTasksBody,
  CenterAgentListAgentTasksResponse,
  CenterAgentListComputersBody,
  CenterAgentListComputersResponse,
  CenterAgentListLocalAgentConnectionCandidatesBody,
  CenterAgentListLocalAgentConnectionCandidatesResponse,
  CenterAgentListSlackChannelsBody,
  CenterAgentListSlackChannelsResponse,
  CenterAgentModelConfigurationResponse,
  CenterAgentOrganizationMemoryPolicyResponse,
  CenterAgentPostSlackChannelMessageBody,
  CenterAgentPostSlackChannelMessageResponse,
  CenterAgentPostSpaceMessageBody,
  CenterAgentPostSpaceMessageResponse,
  CenterAgentReadAgentActivityToolRpcInput,
  CenterAgentReadChangelogToolRpcInput,
  CenterAgentReadConnectorActionOperationBody,
  CenterAgentReadConnectorActionOperationResponse,
  CenterAgentReadDispatchHistoryBody,
  CenterAgentReadDispatchHistoryResponse,
  CenterAgentReadMemberOpenMeldServiceStatusBody,
  CenterAgentReadMemberOpenMeldServiceStatusResponse,
  CenterAgentReadSlackChannelHistoryBody,
  CenterAgentReadSlackChannelHistoryResponse,
  CenterAgentReadSlackChannelMembersBody,
  CenterAgentReadSlackChannelMembersResponse,
  CenterAgentReadSlackWorkspaceDirectoryBody,
  CenterAgentReadSlackWorkspaceDirectoryResponse,
  CenterAgentReadSpaceContextBody,
  CenterAgentReadSpaceContextResponse,
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
  CenterAgentSearchSlackMessagesBody,
  CenterAgentSearchSlackMessagesResponse,
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
  CenterAgentWatchAgentTaskBody,
  CenterAgentWatchAgentTaskResponse,
  CenterAgentWipeMemberMemoryResponse,
  ChangelogQuery,
  ChangelogQueryResponse,
  ComputerFileAccessPolicyResponse,
  ComputerFileAccessReadRpcInput,
  ComputerFileAccessUpdateRpcInput,
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
  CurrentDeviceTargetResponse,
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
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  FeedbackReportingPolicyResponse,
  ForgetComputerResponse,
  ForgetCurrentComputerResponse,
  GetActiveSpaceWakeProgressResponse,
  GetAgentExecutionReadinessBatchBody,
  GetAgentExecutionReadinessBatchResponse,
  GetAgentExecutionReadinessResponse,
  GetAgentProfilePrimaryBindingResponse,
  GetCenterAgentDesignationResponse,
  GetCenterAgentDirectMessageSpaceProjectionResponse,
  GetCenterAgentOperatingStateResponse,
  GetLocalRuntimeExpectedRoutesResponse,
  GetOrganizationBindingAuthorizationPreferenceResponse,
  GetPrepareReadinessQuery,
  GetPrepareReadinessResponse,
  GetSpaceConversationStateResponse,
  GetSpaceDispatchLookupResponse,
  GetSpaceDispatchResultResponse,
  GetSpaceMessageDetailsResponse,
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
  ListCenterAgentAuditJournalQuery,
  ListCenterAgentAuditJournalResponse,
  ListCurrentUserAgentProfileOrganizationWakeAccessResponse,
  ListOrganizationBindingAuthorizationProfilesResponse,
  ListOrganizationBindingAuthorizationsResponse,
  ListProjectsRpcInput,
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
  MessageChannelIdentityLinkConsumeBody,
  MessageChannelIdentityLinkConsumeResponse,
  MessageChannelIdentityLinkPreviewBody,
  MessageChannelIdentityLinkPreviewResponse,
  NotifyAgentProfileRouteCatalogChangedBody,
  NotifyAgentProfileRouteCatalogChangedResponse,
  NotifyAgentProfilesRouteCatalogChangedBody,
  ObservedDeviceMetadata,
  OpenCenterAgentDirectMessageSpaceResponse,
  OpenDirectMessageSpaceBody,
  OpenDirectMessageSpaceResponse,
  OpenMeldRequestContext,
  OrganizationDirectoryResponse,
  OrganizationInformationProtectionPolicyResponse,
  OrganizationMemberOpenMeldServiceStatusesResponse,
  OrganizationSpaceDirectoryResponse,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  OrganizationUsageOverviewRpcInput,
  PatchSpaceContractBody,
  PendingGitHubAppInstallation,
  PostSpaceMembersResponse,
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  PutSpaceContractBody,
  RecordSpaceAttachmentPayload,
  RefreshCurrentLocalAgentCatalogResponse,
  RemoteAgentTransientSlackSearchRequest,
  RemoteAgentTransientSlackSearchResponse,
  RemoveSpaceMembersResponse,
  ResolvedSpaceMemberProfile,
  ResolveSpaceAttachmentForDownloadPayload,
  RespondToSpaceAgentInteractionBody,
  RespondToSpaceAgentInteractionResponse,
  RevokeAgentProfileBindingForOrganizationResponse,
  SaveOrganizationWakeAccessChoiceBody,
  SaveOrganizationWakeAccessChoiceResponse,
  SetCurrentAgentProfileWorkspaceBody,
  SetCurrentAgentProfileWorkspaceResponse,
  SetCurrentLocalAgentEnabledBody,
  SetCurrentLocalAgentEnabledResponse,
  SetLocalRuntimeDisplayNameBody,
  SetOrganizationBindingAuthorizationPreferenceBody,
  SetOrganizationBindingAuthorizationPreferenceResponse,
  SlackIdentityLinkConsumeBody,
  SlackIdentityLinkConsumeResponse,
  SlackIdentityLinkPreviewBody,
  SlackIdentityLinkPreviewResponse,
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
  SpaceAttachmentDescriptor,
  SpaceBoardResponse,
  SpaceBoardRoomProjection,
  SpaceBootstrapResponse,
  SpaceContract,
  SpaceDispatchTraceResponse,
  SpaceIdentityDirectory,
  SpaceMemberDirectory,
  SpaceMembersSnapshot,
  SpaceMessageAttachment,
  SpaceSignalAuthoringPolicy,
  SpaceThreadContext,
  SpaceViewerMembershipResponse,
  StartCenterAgentMemberResearchResponse,
  SubmitAgentActivityEventsRpcInput,
  SubmitAgentControllerTaskLifecycleEventItem,
  SubmitAgentControllerTaskLifecycleEventsResponse,
  SubmitAgentControllerTaskLifecycleEventsRpcInput,
  SubmitRuntimeAgentControllerReportResult,
  SubmitRuntimeAgentControllerReportsResponse,
  SubmitRuntimeProviderConversationProofResult,
  SubmitRuntimeProviderConversationProofsResponse,
  SubmitRuntimeRegistrationResponse,
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
  WriteCurrentDeviceObservedMetadataResponse,
} from "@openmeld/schemas/types";
import {
  buildDirectMessagePairKey,
  createAuthenticatedSpaceAccessContext,
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
  type SpaceAccessContext,
} from "@openmeld/space";
import { rpcCenterAgentReadAgentActivity as centerAgentReadAgentActivity } from "../agent-activity/activity-center-agent-rpc";
import { rpcSubmitAgentActivityEvents as submitAgentActivityEvents } from "../agent-activity/activity-event-rpc";
import { rpcReadAgentActivitySnapshot as readAgentActivitySnapshot } from "../agent-activity/activity-snapshot-rpc";
import { rpcReadAgentActivityStats as readAgentActivityStats } from "../agent-activity/activity-stats-rpc";
import {
  type AgentExecutionTargetRuntimeContext,
  type CoreAgentExecutionReadiness,
  resolveCoreAgentExecutionReadinessForProfile,
} from "../agent-execution/application/agent-execution-readiness-service";
import { acceptProviderConversationProofRecord } from "../agent-execution/infrastructure/d1/provider-conversation-proof-repo";
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
import { readLocalRuntimeExpectedRoutes } from "../agent-profile-binding/application/local-runtime-expected-routes-service";
import { applyAcceptedBindingAuthorizationPolicies } from "../agent-profile-binding/application/organization-binding-authorization-policy-service";
import {
  compareAndSetPrimaryAgentProfileBindingModelSelectionRecord,
  createD1AgentProfileBindingCommandStore,
  createD1AgentProfileBindingLookupStore,
  disablePrimaryAgentProfileBindingRecord,
  listEnabledPrimaryAgentProfileBindingRecords,
  readPrimaryAgentProfileBindingRecord,
  reconnectPrimaryAgentProfileBindingRecord,
} from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import {
  deleteOrganizationBindingAuthorizationRecord,
  ensureOrganizationBindingAuthorizationRecord,
  listOrganizationBindingAuthorizationCandidates,
  listOrganizationBindingAuthorizationProfiles,
  listOrganizationBindingAuthorizationRecords,
  listOrganizationBindingAuthorizationRecordsForBinding,
  listOrganizationBindingAuthorizedAgentProfileIds,
  type OrganizationBindingAuthorizationCandidate,
  readOrganizationBindingAuthorizationPreferenceRecord,
  readPersonalOrganizationIdForUser,
  saveOrganizationWakeAccessChoiceRecord,
  upsertOrganizationBindingAuthorizationPreferenceRecord,
} from "../agent-profile-binding/infrastructure/d1/organization-binding-authorization-repo";
import { rpcSubmitAgentControllerTaskLifecycleEvents as submitAgentControllerTaskLifecycleEvents } from "../agent-task-coordination/application/agent-controller-task-lifecycle-rpc";
import {
  listRegisteredAgentControllerTasks,
  readRegisteredAgentControllerTask,
} from "../agent-task-coordination/infrastructure/d1/agent-controller-task-lifecycle-repo";
import { readAgentDelegationByChildTask } from "../agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import {
  type CenterAgentOrganizationMember,
  prepareCenterAgentOrganizationMemberRequest,
} from "../center-agent/application/anonymous-member-request";
import {
  areCenterAgentContextLoadSelectionsEqual,
  CenterAgentContextLoadReceiptError,
  resolveCenterAgentContextLoadSelection,
} from "../center-agent/application/center-agent-context-load-receipt-service";
import {
  buildCenterAgentContextMessageProjection,
  type CenterAgentContextMessageProjection,
  CenterAgentContextTokenBudgetTooSmallError,
  decodeCenterAgentContextCursor,
  validateCenterAgentContextManifestResponse,
} from "../center-agent/application/center-agent-context-manifest-service";
import {
  CenterAgentDelegationPreparationError,
  planCenterAgentWakeDelegation,
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
import { executeCenterAgentSlackPublication } from "../center-agent/application/center-agent-slack-publication-service";
import { prepareCenterAgentTaskWatch } from "../center-agent/application/center-agent-task-watch-service";
import {
  executeCenterAgentWakePublication,
  prepareCenterAgentWakePublication,
} from "../center-agent/application/center-agent-wake-publication-service";
import {
  buildCenterAgentReadinessResponse,
  type CenterAgentProductOperationDeps,
  checkAgentProfileReadinessOperation,
  connectAgentProfileToLocalAgentOperation,
  createConfiguredAgentProfileOperation,
  listLocalAgentConnectionCandidatesOperation,
  projectCenterAgentComputerSetupOptions,
  projectCenterAgentLocalAgentConnectionCandidates,
  updateAgentProfileRuntimeSettingsOperation,
} from "../center-agent/application/product-operations";
import {
  prepareCenterAgentRepresentedMemberRequest,
  type VerifiedCenterAgentRepresentedMember,
} from "../center-agent/application/represented-member-request";
import { shouldWriteDestinationNeutralTaskContinuations } from "../center-agent/application/task-continuation-rollout";
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
  isAgentProfileEligibleForOrganization,
  readAgentProfileOrganizationContext,
} from "../center-agent/center-agent-organization-scope";
import {
  type CenterAgentDesignationRecord,
  insertCenterAgentAuditJournalEntry,
  listCenterAgentAuditJournalEntries,
  readCenterAgentDesignationRecord,
  readResolvedOrganizationDirectorySpaceMember,
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
  recordCenterAgentConnectorActionOperation,
} from "../center-agent/connector-action-operation-repository";
import {
  type CurrentDesignatedCenterAgentAuthorization,
  requireCurrentDesignatedCenterAgentCaller,
} from "../center-agent/current-designated-center-agent";
import type { CenterAgentWakePublicationCommand } from "../center-agent/infrastructure/d1/center-agent-wake-publication-repo";
import { startCenterAgentMemberResearch } from "../center-agent-member-research/member-research-service";
import type { CenterAgentMemoryEpisodeOrigin } from "../center-agent-memory/contract";
import { createCoreCenterAgentMemoryService } from "../center-agent-memory/core-memory-service";
import { createD1CenterAgentMemoryRepository } from "../center-agent-memory/d1-memory-repository";
import {
  resolveExplicitMemoryEpisodeOrigin,
  resolveExplicitMemorySourceDeliveryDb,
  resolveExplicitMemorySourceTurnRequest,
} from "../center-agent-memory/explicit-memory-origin";
import { rpcCenterAgentReadChangelog as centerAgentReadChangelog } from "../changelog/changelog-center-agent-rpc";
import { rpcReadChangelog as readChangelog } from "../changelog/changelog-read-rpc";
import { createComputerFileAccessRpc } from "../computers/computer-file-access-rpc";
import { createLocalFolderPickerRpc } from "../computers/local-folder-picker-rpc";
import { readModelCatalog } from "../config/model-catalog";
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
  requireConnectorConnectionForExecution,
  selectActiveConnectorConnection,
  upsertPendingConnectorConnection,
  upsertPendingSharedConnectorConnection,
} from "../connectors/connector-connection-repository";
import {
  beginGitHubAppInstallationVerification,
  completeGitHubAppInstallation,
  createGitHubAppInstallationState,
  readPendingGitHubAppInstallation,
} from "../connectors/github-app-installation-state";
import {
  type DispatchHistoryEntry,
  listRecentDispatchLedgerEntriesForSpace,
} from "../dispatch/infrastructure/d1/dispatch-ledger-d1";
import {
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoutesBatch,
  notifyRuntimeTransportRouteCatalogChanged,
  readRuntimeTransportComputerFileAccessPolicy,
  refreshRuntimeTransportLocalAgentCatalog,
  selectRuntimeTransportLocalFolders,
  setRuntimeTransportLocalAgentEnabled,
  setRuntimeTransportProfileWorkspace,
  updateRuntimeTransportComputerFileAccessPolicy,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import { resolveRuntimeTransportExecutionRecoveryShard } from "../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import {
  rpcReadFeedbackReportingPolicy,
  rpcSetFeedbackReportingPolicy,
} from "../feedback/transport/rpc/feedback-management-rpc";
import {
  agentTaskCoordinationDb,
  type CoreBindings,
  identityDb,
  localStateDb,
  wakeEvidenceDb,
} from "../lib/bindings";
import { resolveLocalComponentUpdateProjection } from "../local-components/update-projection";
import {
  readOrganizationAccountIdentityProjection,
  readOrganizationCreatorUserId,
  readOrganizationPersonalClassification,
  readOrganizationRouteSlug,
  resolveActiveOrganizationMembership,
  resolveOrganizationMembershipById,
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
import { listOrganizationMemberOpenMeldServiceStatuses } from "../organizations/organization-member-openmeld-service-status-service";
import { updateAgentProfileDefaultProjectForAuthority } from "../projects/agent-profile-default-project-service";
import {
  buildCanonicalLocalProjectConnectRequest,
  buildCanonicalLocalProjectDiscoveryRequest,
  createLocalProjectControlRpc,
} from "../projects/local-project-control-rpc";
import { prepareHumanProjectRequest } from "../projects/project-request-preparation";
import {
  rpcArchiveProject as archiveProject,
  rpcCreateProject as createProject,
  rpcListProjects as listProjects,
  rpcUpdateProject as updateProject,
} from "../projects/project-rpc";
import { listLarkPlatformProvidersEnabledForOrganization } from "../remote-agent/application/lark-platform-provider-policy";
import {
  beginRemoteAgentLarkPlatformRegistration,
  disconnectRemoteAgentLarkPlatformRegistration,
  LarkPlatformRegistrationServiceError,
  listRemoteAgentActiveLarkPlatformRegistrations,
  pollRemoteAgentLarkPlatformRegistration,
} from "../remote-agent/application/lark-platform-registration-service";
import { listRemoteAgentMessageChannelConnectionProjections } from "../remote-agent/application/message-channel-connection-projection";
import { digestMessageChannelIdentityLinkToken } from "../remote-agent/application/message-channel-identity-link-token";
import { continueMessageChannelIdentityOnboardingRequest } from "../remote-agent/application/message-channel-native-delivery-service";
import { createConfiguredMessageChannelProviderRegistry } from "../remote-agent/application/message-channel-provider-runtime";
import { REMOTE_AGENT_ACTIVE_EXECUTION_EVIDENCE_FRESHNESS_MS } from "../remote-agent/application/native-delivery-execution-evidence";
import { continueSlackIdentityOnboardingRequest } from "../remote-agent/application/native-delivery-service";
import {
  type RemoteAgentRuntimeAvailability,
  resolveRemoteAgentRuntimeAvailability,
} from "../remote-agent/application/remote-agent-runtime-policy";
import { resolveSlackBotToken } from "../remote-agent/application/slack-bot-token";
import {
  isSlackFullWorkspaceMember,
  listSlackChannelMemberIds,
  listSlackChannels,
  listSlackWorkspaceMembers,
  postSlackEphemeralMessage,
  readSlackChannelHistory,
  readSlackUserIdentity,
  resolveSlackChannelMessageTarget,
  SlackApiError,
  type SlackWorkspaceMember,
  searchSlackPublicMessages,
} from "../remote-agent/application/slack-client";
import { digestSlackIdentityLinkToken } from "../remote-agent/application/slack-identity-link-token";
import { runSlackInstallationWelcomePreparationTick as advanceSlackInstallationWelcomePreparations } from "../remote-agent/application/slack-installation-welcome-preparation-service";
import { runSlackInvitedMemberOnboardingTick } from "../remote-agent/application/slack-invited-member-onboarding-service";
import { installSlackWorkspaceFromOAuth } from "../remote-agent/application/slack-oauth-installation";
import {
  buildSlackOAuthChannelsReturnPath,
  consumeSlackOAuthState,
  createSlackOAuthState,
} from "../remote-agent/application/slack-oauth-state";
import { decryptSlackSearchAuthorization } from "../remote-agent/application/slack-search-authorization";
import { buildSlackSearchPresentation } from "../remote-agent/application/slack-search-presentation";
import { readRemoteAgentLarkPlatformChannelConnection } from "../remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";
import { readRemoteAgentLarkPlatformIdentityLink } from "../remote-agent/infrastructure/d1/lark-platform-identity-link-repo";
import {
  claimRemoteAgentMessageChannelIdentityLinkToken,
  consumeRemoteAgentMessageChannelIdentityLinkToken,
  type RemoteAgentMessageChannelIdentityLinkTokenRecord,
  readActiveRemoteAgentMessageChannelIdentityLinkToken,
  readRemoteAgentMessageChannelIdentityLinkTokenForUser,
} from "../remote-agent/infrastructure/d1/message-channel-identity-link-token-repo";
import {
  countActiveRemoteAgentNativeDeliveriesBySpaceIds,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByDispatchAndConversation,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  authorizeFailedSlackInstallationWelcomeRetry,
  enqueueSlackInstallationWelcomePreparation,
  type SlackInstallationWelcomePreparation,
} from "../remote-agent/infrastructure/d1/slack-installation-welcome-preparation-repo";
import { SLACK_INSTALLATION_WELCOME_VERSION } from "../remote-agent/infrastructure/d1/slack-installation-welcome-repo";
import type { SlackInvitedMemberOnboarding } from "../remote-agent/infrastructure/d1/slack-teammate-invitation-delivery-repo";
import {
  claimSlackIdentityLinkTokenForUser,
  consumeSlackIdentityLinkTokenAndUpsertUserLink,
  readActiveSlackIdentityLinkToken,
  readSlackIdentityLinkTokenForUser,
  readSlackUserIdentityLinksForUsers,
  type SlackUserIdentityLinkRecord,
} from "../remote-agent/infrastructure/d1/slack-user-identity-link-repo";
import {
  createRemoteAgentSlackWorkspaceBinding,
  deleteRemoteAgentSlackWorkspaceBindingByOrganization,
  type RemoteAgentSlackWorkspaceBindingRecord,
  readRemoteAgentSlackWorkspaceBinding,
  readRemoteAgentSlackWorkspaceBindingByOrganization,
} from "../remote-agent/infrastructure/d1/slack-workspace-binding-repo";
import {
  hasSlackDirectMessageScopes,
  prepareDeleteSlackWorkspaceTokenByOrganizationStatement,
  readSlackWorkspaceToken,
} from "../remote-agent/infrastructure/d1/slack-workspace-token-repo";
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
} from "../runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { resolveRuntimePrepareReadinessFromD1 } from "../runtime-registry/infrastructure/d1/runtime-prepare-readiness-d1";
import {
  listOwnedDeviceExecutionTargetRecords,
  readRuntimeRegistryRecord,
  readRuntimeRegistryRecordByRuntimeId,
  registerRuntimeRegistryRecord,
} from "../runtime-registry/infrastructure/d1/runtime-registry-repo";
import { countActiveRuntimeCoordinatorExecutionsBySpaceIds } from "../runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";
import { parseRpcErrorPayload } from "../shared/rpc/rpc-json";
import {
  assertSpaceAccessMatchesSpace,
  requireWritableSpaceActor,
} from "../space/application/space-access-policy";
import type { SpaceBootstrapWithTiming } from "../space/application/space-bootstrap-timing";
import type {
  SpaceClaimTimeLivenessInput,
  SpaceClaimTimeLivenessResult,
} from "../space/application/space-claim-liveness-service";
import type { FinalOutcomeWriteAuthority } from "../space/application/types";
import { readSpaceBoardExecutionProjection } from "../space/infrastructure/d1/space-board-execution-read-repo";
import { readSpaceDispatchLookupByClientMessageId } from "../space/infrastructure/d1/space-dispatch-read-repo";
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
} from "../space-attachment/infrastructure/d1/space-attachment-repo";
import {
  countDirectMessageSpacesForPair,
  listAccountSpaceIdsFromSpaceIndex,
  listAccountSpacesFromSpaceIndex,
  listOrganizationSpacesFromSpaceIndex,
  readCenterAgentDirectMessageProjectionCandidateByPairKey,
  readCenterAgentDirectMessageProjectionCandidateBySpaceId,
  readDirectMessageSpaceIndexCandidateBySpaceId,
  readReusableDirectMessageSpaceIndexCandidate,
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
} from "../start/infrastructure/d1/connected-computer-repo";
import { resolveCurrentDeviceFromBindings } from "../start/infrastructure/d1/current-device-derivation-repo";
import {
  forgetComputerRecordAtomically,
  forgetCurrentComputerRecordAtomically,
} from "../start/infrastructure/d1/current-device-forget-repo";
import {
  deleteForgottenDeviceRecord,
  readForgottenDeviceRecord,
} from "../start/infrastructure/d1/forgotten-device-repo";
import {
  listOwnedDeviceRegistryRecords,
  readOwnedDeviceRegistryRecord,
  upsertOwnedDeviceRegistryRecord,
} from "../start/infrastructure/d1/owned-device-registry-repo";
import { rpcReadOrganizationUsageOverview as readOrganizationUsageOverview } from "../usage/organization-usage-overview-rpc";
import {
  requireCurrentLocalRuntimeExecutionTarget,
  requireCurrentLocalRuntimeServiceTarget,
} from "./current-local-control-target";
import { createCoreRpcHttpError } from "./errors";
import { requireAcceptedLocalAgentControlPayload } from "./local-agent-control-policy";
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
export type SubmitAgentControllerTaskLifecycleEventsInput =
  SubmitAgentControllerTaskLifecycleEventsRpcInput;
export type ReadAgentActivitySnapshotInput = AgentActivitySnapshotRpcInput;
export type ReadAgentActivityStatsInput = AgentActivityStatsRpcInput;
export type ReadOrganizationUsageOverviewInput =
  OrganizationUsageOverviewRpcInput;
export type CenterAgentReadAgentActivityInput =
  CenterAgentReadAgentActivityToolRpcInput;
export type CenterAgentReadChangelogInput =
  CenterAgentReadChangelogToolRpcInput;
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
  input: UpdateAgentProfileDefaultProjectInput
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
  const { authority, service } = await prepareHumanProjectRequest(
    env,
    request.context
  );
  if (authority.organizationId !== request.expectedOrganizationId) {
    throw createCoreRpcHttpError({
      code: "project.organization_context_changed",
      reason:
        "The active Organization changed before this Agent Profile request was applied.",
      status: 409,
    });
  }
  return await updateAgentProfileDefaultProjectForAuthority({
    agentProfileId: request.agentProfileId,
    authority,
    defaultProjectId: request.defaultProjectId,
    env,
    service,
  });
}

const localProjectControlRpc = createLocalProjectControlRpc({
  resolveCurrentTarget: resolveCurrentLocalProjectControlTarget,
});

const computerFileAccessRpc = createComputerFileAccessRpc({
  readPolicy: readRuntimeTransportComputerFileAccessPolicy,
  requireOwnerUserId: requireAuthenticatedOwnerUserId,
  resolveCurrentTarget: async ({ env, userId }) => {
    const { bindingTarget, ownerService } =
      await resolveCurrentLocalServiceContext({ env, userId });
    return requireCurrentLocalRuntimeServiceTarget({
      bindingTarget,
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

const localFolderPickerRpc = createLocalFolderPickerRpc({
  requireOwnerUserId: requireAuthenticatedOwnerUserId,
  resolveCurrentTarget: async ({ env, userId }) => {
    const { bindingTarget, ownerService } =
      await resolveCurrentLocalServiceContext({ env, userId });
    return requireCurrentLocalRuntimeServiceTarget({
      bindingTarget,
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

export function rpcCenterAgentReadChangelog(
  env: CoreBindings,
  input: CenterAgentReadChangelogInput
) {
  return centerAgentReadChangelog(env, input);
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
  rpcPostSignalOnceByClientMessageId(
    input: PostSignalOnceByClientMessageIdInput
  ): Promise<SignalEnvelope>;
  rpcResolveOrRejectTextSignalByClientMessageId(input: {
    clientMessageId: string;
    spaceId: string;
  }): Promise<
    | {
        signal: Extract<SignalEnvelope, { type: "signal.text" }>;
        status: "accepted";
      }
    | { status: "rejected" }
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
  rpcPostTransientSignal(input: PostTransientSignalInput): Promise<void>;
  rpcGetMeta(input: GetSpaceMetaInput): Promise<SpaceMeta>;
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
    guide: string;
    organizationId: string;
    visibility: "public" | "private";
  }): Promise<{ created: boolean; meta: SpaceMeta }>;
  rpcConvertDirectMessageToSpace(input: {
    context?: CoreRpcContextInput;
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
  rpcGetMessageDetails(
    input: GetSpaceMessageDetailsInput
  ): Promise<GetSpaceMessageDetailsResponse>;
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
const CENTER_AGENT_DIRECT_MESSAGE_WELCOME_PURPOSE =
  "center_agent_dm_welcome" as const;
const CENTER_AGENT_MANAGED_ROLE = "center_agent" as const;
const friendlyNameTextPattern = /[\p{L}\p{N}]/u;
const friendlyNameWhitespacePattern = /\s+/u;

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
  signals: SignalEnvelope[];
  nextCursor: string | null;
};

export type PostSignalInput = {
  agentStreamId?: string;
  spaceId: string;
  profile: Profile;
  text: string;
  authoringPolicy: SpaceSignalAuthoringPolicy;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  attachments?: SignalText["data"]["attachments"];
  messageEnvelope?: SignalText["data"]["messageEnvelope"];
  meta?: SignalText["data"]["meta"];
  replyTo?: SignalText["data"]["replyTo"];
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  threadContext?: SpaceThreadContext;
};

export type PostSignalOnceByClientMessageIdInput = PostSignalInput & {
  clientMessageId: string;
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

export type GetSpaceMetaInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};

export type UpdateSpaceMetaInput = {
  spaceId: string;
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

export type GetSpaceConversationStateRpcInput = {
  spaceId: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};

type ApplySpaceAgentStreamDeltaIdentity = {
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
  part: AgentStreamToolPart;
};

export type CloseSpaceAgentStreamInput = {
  spaceId: string;
  streamId: string;
  terminal: SpaceAgentStreamTerminal;
};

export type GetSpaceBootstrapInput = ListSignalsInput & {
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
  gatewayHost: string;
  ownerUserId: string;
  scope: AccountSpaceIndexQuery["scope"];
  selectedProfileId: string;
  limit?: number;
  includeRecentlyDeletedItems?: boolean;
  includePurposes?: boolean;
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
  spaceId: string;
  dispatchId: string;
  includeRemoteAgentRuntimeDiagnostics?: boolean;
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
  spaceId: string;
  clientMessageId: string;
  includeTiming?: boolean;
  includeWakeStopEligibility?: boolean;
  targetProfileId?: string;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
};

export type GetActiveSpaceWakeProgressInput = {
  spaceId: string;
  includeTiming?: boolean;
  includeWakeStopEligibility?: boolean;
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
  spaceId: string;
  signalId: string;
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
  password?: string;
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
};

export type GetCurrentLocalRuntimeReplyReadinessInput = {
  context?: CoreRpcContextInput;
};

export type SetLocalRuntimeDisplayNameInput = SetLocalRuntimeDisplayNameBody & {
  deviceId: string;
  context?: CoreRpcContextInput;
};

export type SetCurrentLocalAgentEnabledInput =
  SetCurrentLocalAgentEnabledBody & {
    agentId: string;
    context?: CoreRpcContextInput;
  };

export type SetCurrentAgentProfileWorkspaceInput =
  SetCurrentAgentProfileWorkspaceBody & {
    agentProfileId: string;
    context?: CoreRpcContextInput;
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
  contractVersion?: "v2" | "v3";
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

export type DisableAgentProfilePrimaryBindingInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};

export type AuthorizeAgentProfileBindingForOrganizationInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};

export type BulkAuthorizeAgentProfileBindingsForOrganizationInput =
  BulkAuthorizeAgentProfileBindingsForOrganizationBody & {
    context?: CoreRpcContextInput;
    organizationId: string;
  };

export type ListOrganizationBindingAuthorizationsInput = {
  context?: CoreRpcContextInput;
};

export type ListOrganizationBindingAuthorizationProfilesInput = {
  context?: CoreRpcContextInput;
  organizationId: string;
};

export type ListCurrentUserAgentProfileOrganizationWakeAccessInput = {
  context?: CoreRpcContextInput;
};

export type RevokeAgentProfileBindingForOrganizationInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};

export type GetOrganizationBindingAuthorizationPreferenceInput = {
  context?: CoreRpcContextInput;
  organizationId: string;
};

export type SetOrganizationBindingAuthorizationPreferenceInput =
  SetOrganizationBindingAuthorizationPreferenceBody & {
    context?: CoreRpcContextInput;
    organizationId: string;
  };

export type SaveOrganizationWakeAccessChoiceInput =
  SaveOrganizationWakeAccessChoiceBody & {
    context?: CoreRpcContextInput;
    organizationId: string;
  };

export type GetCurrentOrganizationDirectoryInput = {
  context?: CoreRpcContextInput;
};

export type GetCurrentOrganizationMemberOpenMeldServiceStatusesInput = {
  context?: CoreRpcContextInput;
};

export type GetCurrentOrganizationSpaceDirectoryInput = {
  context?: CoreRpcContextInput;
};

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

export type CompleteGitHubAppInstallationInput =
  ReadPendingGitHubAppInstallationInput & {
    installationId: string;
    targetConnectionName: ConnectorConnectionName;
    verificationConnectionName: ConnectorConnectionName;
  };

export type ListCurrentOrganizationConnectorConnectionsInput = {
  context?: CoreRpcContextInput;
  expectedOrganizationId: string;
  service: ConnectorService;
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

export type CenterAgentResolveConnectorConnectionInput = {
  connectionPreference?: ConnectorConnectionPreference;
  context?: CoreRpcContextInput;
  requesterUserId: string | null;
  service: ConnectorService;
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

export type GetCenterAgentDirectMessageSpaceProjectionInput = {
  context?: CoreRpcContextInput;
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
};

export type ConsumeSlackOAuthStateInput = {
  state: string;
};

export type InstallSlackWorkspaceFromOAuthInput = SlackOAuthInstallationInput;

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
  onBehalfOf?: { profileId: string } | null;
  resource?: { id: string; type: string } | null;
};

export type ListCenterAgentAuditJournalInput =
  ListCenterAgentAuditJournalQuery & {
    context?: CoreRpcContextInput;
  };

export type ReadCenterAgentOrganizationMemoryPolicyInput = {
  context?: CoreRpcContextInput;
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
    speakerMember?: { memberId: string; userId: string };
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
};

export type CenterAgentPostSlackChannelMessageInput =
  CenterAgentPostSlackChannelMessageBody & {
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
  speakerMember?: CenterAgentToolSpeaker;
};

export type CenterAgentReadMemberOpenMeldServiceStatusInput =
  CenterAgentReadMemberOpenMeldServiceStatusBody & {
    context?: CoreRpcContextInput;
    speakerMember?: CenterAgentToolSpeaker;
  };

export type CenterAgentReadOrganizationSpaceDirectoryInput = {
  context?: CoreRpcContextInput;
  speakerMember?: CenterAgentToolSpeaker;
};

export type OpenCenterAgentDirectMessageSpaceInput = {
  context?: CoreRpcContextInput;
  suppressWelcome?: boolean;
};

export type OpenDirectMessageSpaceInput = OpenDirectMessageSpaceBody & {
  context?: CoreRpcContextInput;
};

export type ConvertDirectMessageToSpaceInput =
  ConvertDirectMessageToSpaceBody & {
    context?: CoreRpcContextInput;
    spaceId: string;
  };

export type GetAgentExecutionReadinessInput = {
  agentProfileId: string;
  context?: CoreRpcContextInput;
};

export type GetAgentExecutionReadinessBatchInput =
  GetAgentExecutionReadinessBatchBody & {
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
  return await listLocalRuntimesForOwnerUser({
    ...(input.connectionIdentityAdoption === undefined
      ? {}
      : { connectionIdentityAdoption: input.connectionIdentityAdoption }),
    env,
    userId: requireAuthenticatedOwnerUserId(input.context),
  });
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
  const response = await getCurrentLocalRuntimeReplyReadinessUseCase({
    lookupOwnerService: async ({ ownerUserId }) =>
      await lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env,
        ownerUserId,
      }),
    store: buildCurrentDeviceTargetStore(env),
    userId,
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
  return { currentTarget, lookupOwnerServiceForUser };
}

async function resolveCurrentLocalServiceContext(input: {
  env: CoreBindings;
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
    connectionIdentityAdoption: "safe_legacy_current",
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
  unsupportedCode: string;
  unsupportedReason: string;
  userId: string;
}): Promise<{
  currentTarget: CurrentLocalAgentControlTarget;
  lookupOwnerServiceForUser: LookupOwnerServiceForUser;
}> {
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

type CurrentLocalProjectControlTarget =
  LocalRuntimesResponse["localRuntimes"][number]["executionTargets"][number];

async function resolveCurrentLocalProjectControlTarget(input: {
  capability: keyof NonNullable<
    CurrentLocalProjectControlTarget["localProjectControl"]
  >;
  env: CoreBindings;
  userId: string;
}): Promise<CurrentLocalProjectControlTarget> {
  const { currentTarget } = await resolveCurrentLocalControlTarget({
    env: input.env,
    offlineError: {
      code: "service_offline",
      reason: "This computer isn't reachable for OpenMeld right now.",
      status: 503,
    },
    userId: input.userId,
  });
  if (currentTarget.localProjectControl?.[input.capability] !== true) {
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
  input: SetCurrentLocalAgentEnabledInput
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
    localRuntimes: refreshedLocalRuntimes,
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

export async function rpcSetCurrentAgentProfileWorkspace(
  env: CoreBindings,
  input: SetCurrentAgentProfileWorkspaceInput
): Promise<SetCurrentAgentProfileWorkspaceResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const routeParams =
    setCurrentAgentProfileWorkspaceRouteParamsSchema.safeParse({
      agentProfileId: input.agentProfileId,
    });
  const parsed = setCurrentAgentProfileWorkspaceBodySchema.safeParse({
    workspaceMode: input.workspaceMode,
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

  const { currentTarget } = await resolveCurrentLocalAgentControlTarget({
    capability: "setProfileWorkspace",
    env,
    unsupportedCode: "local_agent_control.profile_workspace_unsupported",
    unsupportedReason:
      "The current local OpenMeld Service does not support Project folder changes from OpenMeld Web.",
    userId,
  });
  const transportResult = await setRuntimeTransportProfileWorkspace({
    deviceId: currentTarget.deviceId,
    env,
    ownerUserId: userId,
    runtimeLane: currentTarget.runtimeLane,
    targetProfileId: routeParams.data.agentProfileId,
    workspaceMode: parsed.data.workspaceMode,
    ...(parsed.data.workspacePath === undefined
      ? {}
      : { workspacePath: parsed.data.workspacePath }),
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
        transportResult.payload.message ??
        "The current local OpenMeld Service could not save the Project folder.",
      code:
        transportResult.payload.reasonCode ??
        "local_agent_control.profile_workspace_rejected",
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
  input: RefreshCurrentLocalAgentCatalogInput
): Promise<RefreshCurrentLocalAgentCatalogResponse> {
  const userId = requireAuthenticatedOwnerUserId(input.context);
  const { currentTarget, lookupOwnerServiceForUser } =
    await resolveCurrentLocalAgentControlTarget({
      capability: "refreshCatalog",
      env,
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
    localRuntimes: refreshedLocalRuntimes,
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

  return validated.data;
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

  const result = await resolveRuntimePrepareReadinessFromD1({
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
  const request = requireRuntimeReportingRequest(input.context, input.deviceId);
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
  for (const report of body.data.reports) {
    const result = await acceptRuntimeAgentControllerReport({
      nowMs: Date.now(),
      report,
      reportStore: {
        acceptRuntimeAgentControllerReport: async (storeInput) =>
          await acceptRuntimeAgentControllerReportRecord({
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
      proof.method !== "codex_app_server_thread_resume" ||
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
  const request = requireAgentProfileBindingRequest(input);
  const db = requireAgentProfileBindingDb(env);
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
    store: createD1AgentProfileBindingLookupStore({ db }),
  });

  return buildGetAgentProfilePrimaryBindingResponse(
    mapAgentProfileBindingLookupResultToProjection(lookupResult)
  );
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
  const request = requireAgentProfileBindingRequest(input);
  const db = requireAgentProfileBindingDb(env);
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
      console.warn("[core.agent_profile_binding.route_catalog_notify_failed]", {
        event: "core.agent_profile_binding.route_catalog_notify_failed",
        agentProfileId: request.agentProfileId,
        ownerUserId: request.owner.id,
        error: toErrorMessage(error),
      });
    });
  }

  return buildDisableAgentProfilePrimaryBindingResponse({
    agentProfileId: request.agentProfileId,
    disabled: Boolean(disabledBinding),
  });
}

export async function rpcAuthorizeAgentProfileBindingForOrganization(
  env: CoreBindings,
  input: AuthorizeAgentProfileBindingForOrganizationInput
): Promise<AuthorizeAgentProfileBindingForOrganizationResponse> {
  const request = requireAgentProfileBindingRequest(input);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context: request.context,
    env,
  });
  const db = requireAgentProfileBindingDb(env);
  await requireAuthorizableAgentProfileOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    agentProfileId: request.agentProfileId,
    db,
    operation: "authorize",
    userId: activeOrganization.userId,
  });

  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: request.agentProfileId,
    db,
    owner: request.owner,
  });
  if (binding?.bindingState !== "enabled_primary") {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Create an enabled primary Binding before authorizing it for an Organization.",
      code: "organization_binding_authorization.binding_required",
    });
  }

  const authorization = await ensureOrganizationBindingAuthorizationRecord({
    authorizedBy: activeOrganization.userId,
    bindingId: binding.bindingId,
    db,
    nowMs: Date.now(),
    organizationId: activeOrganization.organizationId,
  });

  return buildAuthorizeAgentProfileBindingForOrganizationResponse({
    agentProfileId: request.agentProfileId,
    authorization,
  });
}

async function requireAuthorizableAgentProfileOrganization(input: {
  activeOrganizationId: string;
  agentProfileId: string;
  db: D1Database;
  operation: "authorize" | "revoke";
  userId: string;
}) {
  const profileOrganization = await readAgentProfileOrganizationContext({
    db: input.db,
    agentProfileId: input.agentProfileId,
  });
  if (!profileOrganization) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Agent Profile was not found.",
      code: "agent_profile.not_found",
    });
  }
  if (profileOrganization.profileKind !== "agent") {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        input.operation === "authorize"
          ? "Only Agent Profiles can authorize a Binding for an Organization."
          : "Only Agent Profiles can revoke a Binding authorization for an Organization.",
      code: "agent_profile.invalid_input",
    });
  }
  if (
    input.operation === "authorize" &&
    !isAgentProfileEligibleForOrganization({
      managedRole: profileOrganization.managedRole,
      profileOrganizationId: profileOrganization.organizationId,
      targetOrganizationId: input.activeOrganizationId,
    })
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      reason:
        "A Center Agent Binding can be authorized only for its own Organization.",
      code: "organization_binding_authorization.managed_profile_org_mismatch",
    });
  }

  const personalOrganizationId = await readPersonalOrganizationIdForUser({
    db: input.db,
    userId: input.userId,
  });
  if (
    profileOrganization.organizationId === input.activeOrganizationId ||
    (personalOrganizationId &&
      profileOrganization.organizationId === personalOrganizationId)
  ) {
    return;
  }

  throw createCoreRpcHttpError({
    status: 403,
    reason:
      "Agent Profile must belong to the active Organization or your personal Organization.",
    code: "organization_binding_authorization.profile_org_mismatch",
  });
}

export async function rpcBulkAuthorizeAgentProfileBindingsForOrganization(
  env: CoreBindings,
  input: BulkAuthorizeAgentProfileBindingsForOrganizationInput
): Promise<BulkAuthorizeAgentProfileBindingsForOrganizationResponse> {
  const context = requireRpcContext(input.context);
  const organizationId = requireOrganizationId(input.organizationId);
  const body =
    bulkAuthorizeAgentProfileBindingsForOrganizationBodySchema.safeParse({
      agentProfileIds: input.agentProfileIds,
    });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Organization Binding authorization payload",
      code: "invalid_payload",
    });
  }

  const membership = await requireOrganizationMembershipOrThrow({
    context,
    env,
    organizationId,
  });
  const db = requireAgentProfileBindingDb(env);
  const requestedAgentProfileIds = body.data.agentProfileIds
    ? [...new Set(body.data.agentProfileIds)]
    : undefined;
  const candidates = await listBulkOrganizationBindingAuthorizationCandidates({
    agentProfileIds: requestedAgentProfileIds,
    db,
    organizationId,
    userId: membership.userId,
  });
  if (requestedAgentProfileIds) {
    const candidateProfileIds = new Set(
      candidates.map((candidate) => candidate.agentProfileId)
    );
    const missingAgentProfileIds = requestedAgentProfileIds.filter(
      (agentProfileId) => !candidateProfileIds.has(agentProfileId)
    );
    if (missingAgentProfileIds.length > 0) {
      throw createCoreRpcHttpError({
        status: 403,
        reason:
          "Every requested Agent Profile must belong to the Organization or your personal Organization, be owned by the caller, and have an enabled primary Binding.",
        code: "organization_binding_authorization.profile_owner_mismatch",
      });
    }
  }

  const nowMs = Date.now();
  const authorizations = await Promise.all(
    candidates.map(async (candidate) => {
      const authorization = await ensureOrganizationBindingAuthorizationRecord({
        authorizedBy: membership.userId,
        bindingId: candidate.bindingId,
        db,
        nowMs,
        organizationId,
      });
      return {
        agentProfileId: candidate.agentProfileId,
        authorizedBy: authorization.record.authorizedBy,
        bindingId: authorization.record.bindingId,
        createdAt: toIsoDateTime(authorization.record.createdAtMs),
        organizationId,
        status: authorization.status,
      };
    })
  );

  return buildBulkAuthorizeAgentProfileBindingsForOrganizationResponse({
    authorizations,
    organizationId,
  });
}

export async function rpcSaveOrganizationWakeAccessChoice(
  env: CoreBindings,
  input: SaveOrganizationWakeAccessChoiceInput
): Promise<SaveOrganizationWakeAccessChoiceResponse> {
  const context = requireRpcContext(input.context);
  const organizationId = requireOrganizationId(input.organizationId);
  const body = saveOrganizationWakeAccessChoiceBodySchema.safeParse({
    enableWakeAccess: input.enableWakeAccess,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Organization Wake access choice payload",
      code: "invalid_payload",
    });
  }

  const membership = await requireOrganizationMembershipOrThrow({
    context,
    env,
    organizationId,
  });
  const db = requireAgentProfileBindingDb(env);
  const candidates = body.data.enableWakeAccess
    ? await listBulkOrganizationBindingAuthorizationCandidates({
        db,
        organizationId,
        userId: membership.userId,
      })
    : [];
  const result = await saveOrganizationWakeAccessChoiceRecord({
    authorizeExistingBindings: candidates,
    autoAuthorizeAgentProfileBindings: body.data.enableWakeAccess,
    db,
    nowMs: Date.now(),
    organizationId,
    userId: membership.userId,
  });

  const response = {
    alreadyAuthorizedCount: result.alreadyAuthorizedCount,
    authorizedCount: result.authorizedCount,
    organizationId,
    preference: buildOrganizationBindingAuthorizationPreferenceResponse({
      autoAuthorizeAgentProfileBindings:
        result.preference.autoAuthorizeAgentProfileBindings,
      organizationId,
      updatedAtMs: result.preference.updatedAtMs,
      userId: membership.userId,
    }),
  };
  const validated =
    saveOrganizationWakeAccessChoiceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Wake access choice response: ${validated.error.message}`
    );
  }
  return validated.data;
}

async function listBulkOrganizationBindingAuthorizationCandidates(input: {
  agentProfileIds?: readonly string[];
  db: D1Database;
  organizationId: string;
  userId: string;
}): Promise<OrganizationBindingAuthorizationCandidate[]> {
  const targetOrganizationCandidates =
    await listOrganizationBindingAuthorizationCandidates({
      agentProfileIds: input.agentProfileIds,
      db: input.db,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  const personalOrganizationId = await readPersonalOrganizationIdForUser({
    db: input.db,
    userId: input.userId,
  });
  if (
    !personalOrganizationId ||
    personalOrganizationId === input.organizationId
  ) {
    return targetOrganizationCandidates;
  }

  const personalOrganizationCandidates =
    await listOrganizationBindingAuthorizationCandidates({
      agentProfileIds: input.agentProfileIds,
      db: input.db,
      organizationId: personalOrganizationId,
      userId: input.userId,
    });

  return dedupeBindingAuthorizationCandidates([
    ...targetOrganizationCandidates,
    ...personalOrganizationCandidates,
  ]).filter((candidate) =>
    isAgentProfileEligibleForOrganization({
      managedRole: candidate.managedRole,
      profileOrganizationId: candidate.organizationId,
      targetOrganizationId: input.organizationId,
    })
  );
}

function dedupeBindingAuthorizationCandidates(
  candidates: readonly OrganizationBindingAuthorizationCandidate[]
): OrganizationBindingAuthorizationCandidate[] {
  const seenBindingIds = new Set<string>();
  const dedupedCandidates: OrganizationBindingAuthorizationCandidate[] = [];
  for (const candidate of candidates) {
    if (seenBindingIds.has(candidate.bindingId)) {
      continue;
    }
    seenBindingIds.add(candidate.bindingId);
    dedupedCandidates.push(candidate);
  }
  return dedupedCandidates;
}

export async function rpcListOrganizationBindingAuthorizations(
  env: CoreBindings,
  input: ListOrganizationBindingAuthorizationsInput
): Promise<ListOrganizationBindingAuthorizationsResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const db = requireAgentProfileBindingDb(env);
  const authorizations = await listOrganizationBindingAuthorizationRecords({
    db,
    organizationId: activeOrganization.organizationId,
  });

  const response = {
    organizationId: activeOrganization.organizationId,
    authorizations: authorizations.map((authorization) => ({
      agentProfileId: authorization.agentProfileId,
      authorizedBy: authorization.authorizedBy,
      bindingId: authorization.bindingId,
      createdAt: toIsoDateTime(authorization.createdAtMs),
    })),
  };
  const validated =
    listOrganizationBindingAuthorizationsResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Binding authorization list response: ${validated.error.message}`
    );
  }
  return validated.data;
}

export async function rpcListOrganizationBindingAuthorizationProfiles(
  env: CoreBindings,
  input: ListOrganizationBindingAuthorizationProfilesInput
): Promise<ListOrganizationBindingAuthorizationProfilesResponse> {
  const context = requireRpcContext(input.context);
  const organizationId = requireOrganizationId(input.organizationId);
  const membership = await requireOrganizationMembershipOrThrow({
    context,
    env,
    organizationId,
  });
  const db = requireAgentProfileBindingDb(env);
  const personalOrganizationId = await readPersonalOrganizationIdForUser({
    db,
    userId: membership.userId,
  });
  const profileOrganizationIds = [
    organizationId,
    ...(personalOrganizationId && personalOrganizationId !== organizationId
      ? [personalOrganizationId]
      : []),
  ];
  const profiles = await listOrganizationBindingAuthorizationProfiles({
    authorizationOrganizationId: organizationId,
    db,
    preferredProfileOrganizationId: organizationId,
    profileOrganizationIds,
    userId: membership.userId,
  });

  const response = {
    organizationId,
    profiles: profiles.map((profile) => {
      const authorized =
        profile.bindingId !== null &&
        profile.authorizedBy !== null &&
        profile.authorizedAtMs !== null;
      let status: "authorized" | "not_authorized" | "binding_required";
      if (authorized) {
        status = "authorized";
      } else if (profile.bindingId) {
        status = "not_authorized";
      } else {
        status = "binding_required";
      }
      return {
        agentProfileId: profile.agentProfileId,
        profileName: profile.profileName,
        profileHandle: profile.profileHandle,
        profileOrganizationId: profile.profileOrganizationId,
        ownerUserId: profile.ownerUserId,
        bindingId: profile.bindingId,
        authorized,
        authorizedBy: authorized ? profile.authorizedBy : null,
        authorizedAt: authorized ? toIsoDateTime(profile.authorizedAtMs) : null,
        status,
      };
    }),
  };
  const validated =
    listOrganizationBindingAuthorizationProfilesResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Binding authorization profile list response: ${validated.error.message}`
    );
  }
  return validated.data;
}

export async function rpcListCurrentUserAgentProfileOrganizationWakeAccess(
  env: CoreBindings,
  input: ListCurrentUserAgentProfileOrganizationWakeAccessInput
): Promise<ListCurrentUserAgentProfileOrganizationWakeAccessResponse> {
  const ownerUserId = requireAuthenticatedOwnerUserId(input.context);
  const db = requireAgentProfileBindingDb(env);

  const bindings = await listEnabledPrimaryAgentProfileBindingRecords({
    db,
    owner: { id: ownerUserId, kind: "owner_account" },
  });
  if (bindings.length === 0) {
    return { profiles: [] };
  }

  const personalOrganizationId = await readPersonalOrganizationIdForUser({
    db,
    userId: ownerUserId,
  });

  const bindingAuthorizations = await Promise.all(
    bindings.map(async (binding) => ({
      agentProfileId: binding.agentProfileId,
      authorizations:
        await listOrganizationBindingAuthorizationRecordsForBinding({
          bindingId: binding.bindingId,
          db,
        }),
    }))
  );

  const organizationIdsByAgentProfileId = new Map<string, string[]>();
  const allOrganizationIds = new Set<string>();
  for (const { agentProfileId, authorizations } of bindingAuthorizations) {
    const organizationIds = authorizations
      .map((authorization) => authorization.organizationId)
      .filter((organizationId) => organizationId !== personalOrganizationId);
    if (organizationIds.length === 0) {
      continue;
    }
    organizationIdsByAgentProfileId.set(agentProfileId, organizationIds);
    for (const organizationId of organizationIds) {
      allOrganizationIds.add(organizationId);
    }
  }
  if (organizationIdsByAgentProfileId.size === 0) {
    return { profiles: [] };
  }

  const organizationSummaryById = await readOrganizationSummariesByIds({
    db,
    organizationIds: [...allOrganizationIds],
  });

  const response: ListCurrentUserAgentProfileOrganizationWakeAccessResponse = {
    profiles: [...organizationIdsByAgentProfileId.entries()].map(
      ([agentProfileId, organizationIds]) => ({
        agentProfileId,
        organizations: organizationIds.flatMap((organizationId) => {
          const summary = organizationSummaryById.get(organizationId);
          return summary
            ? [
                {
                  organizationId,
                  organizationName: summary.name,
                  organizationSlug: summary.slug,
                },
              ]
            : [];
        }),
      })
    ),
  };
  const validated =
    listCurrentUserAgentProfileOrganizationWakeAccessResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build current-user Agent Profile organization Wake access response: ${validated.error.message}`
    );
  }
  return validated.data;
}

async function readOrganizationSummariesByIds(input: {
  db: D1Database;
  organizationIds: readonly string[];
}): Promise<Map<string, { name: string; slug: string }>> {
  if (input.organizationIds.length === 0) {
    return new Map();
  }
  const placeholders = input.organizationIds.map(() => "?").join(", ");
  const result = await input.db
    .prepare(
      `SELECT id, name, slug FROM organizations WHERE id IN (${placeholders})`
    )
    .bind(...input.organizationIds)
    .all<{ id: string; name: string; slug: string }>();
  return new Map(
    (result.results ?? []).map((row) => [
      row.id,
      { name: row.name, slug: row.slug },
    ])
  );
}

export async function rpcRevokeAgentProfileBindingForOrganization(
  env: CoreBindings,
  input: RevokeAgentProfileBindingForOrganizationInput
): Promise<RevokeAgentProfileBindingForOrganizationResponse> {
  const request = requireAgentProfileBindingRequest(input);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context: request.context,
    env,
  });
  const db = requireAgentProfileBindingDb(env);
  await requireAuthorizableAgentProfileOrganization({
    activeOrganizationId: activeOrganization.organizationId,
    agentProfileId: request.agentProfileId,
    db,
    operation: "revoke",
    userId: activeOrganization.userId,
  });

  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: request.agentProfileId,
    db,
    owner: request.owner,
  });
  const revoked = binding
    ? await deleteOrganizationBindingAuthorizationRecord({
        bindingId: binding.bindingId,
        db,
        organizationId: activeOrganization.organizationId,
      })
    : false;

  return buildRevokeAgentProfileBindingForOrganizationResponse({
    agentProfileId: request.agentProfileId,
    bindingId: binding?.bindingId ?? null,
    organizationId: activeOrganization.organizationId,
    revoked,
  });
}

export async function rpcGetOrganizationBindingAuthorizationPreference(
  env: CoreBindings,
  input: GetOrganizationBindingAuthorizationPreferenceInput
): Promise<GetOrganizationBindingAuthorizationPreferenceResponse> {
  const context = requireRpcContext(input.context);
  const organizationId = requireOrganizationId(input.organizationId);
  const membership = await requireOrganizationMembershipOrThrow({
    context,
    env,
    organizationId,
  });
  const db = requireAgentProfileBindingDb(env);
  const preference = await readOrganizationBindingAuthorizationPreferenceRecord(
    {
      db,
      organizationId,
      userId: membership.userId,
    }
  );

  return buildOrganizationBindingAuthorizationPreferenceResponse({
    autoAuthorizeAgentProfileBindings:
      preference?.autoAuthorizeAgentProfileBindings ?? false,
    organizationId,
    updatedAtMs: preference?.updatedAtMs ?? null,
    userId: membership.userId,
  });
}

export async function rpcSetOrganizationBindingAuthorizationPreference(
  env: CoreBindings,
  input: SetOrganizationBindingAuthorizationPreferenceInput
): Promise<SetOrganizationBindingAuthorizationPreferenceResponse> {
  const context = requireRpcContext(input.context);
  const organizationId = requireOrganizationId(input.organizationId);
  const body =
    setOrganizationBindingAuthorizationPreferenceBodySchema.safeParse({
      autoAuthorizeAgentProfileBindings:
        input.autoAuthorizeAgentProfileBindings,
    });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        body.error.issues[0]?.message ??
        "invalid Organization Binding authorization preference payload",
      code: "invalid_payload",
    });
  }

  const membership = await requireOrganizationMembershipOrThrow({
    context,
    env,
    organizationId,
  });
  const db = requireAgentProfileBindingDb(env);
  const preference =
    await upsertOrganizationBindingAuthorizationPreferenceRecord({
      autoAuthorizeAgentProfileBindings:
        body.data.autoAuthorizeAgentProfileBindings,
      db,
      nowMs: Date.now(),
      organizationId,
      userId: membership.userId,
    });

  return buildOrganizationBindingAuthorizationPreferenceResponse({
    autoAuthorizeAgentProfileBindings:
      preference.autoAuthorizeAgentProfileBindings,
    organizationId,
    updatedAtMs: preference.updatedAtMs,
    userId: membership.userId,
  });
}

export async function rpcGetCurrentOrganizationDirectory(
  env: CoreBindings,
  input: GetCurrentOrganizationDirectoryInput
): Promise<OrganizationDirectoryResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const db = requireAgentProfileBindingDb(env);
  const generatedAt = new Date().toISOString();
  const organizationId = activeOrganization.organizationId;
  const requestId = context.actorContext.requestId;
  const membersPromise = resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId,
    requestId,
  });
  const centerAgentDesignationPromise = readCenterAgentDesignationRecord({
    db,
    organizationId,
  });
  const agentProfileProjectionPromise =
    listOrganizationBindingAuthorizedAgentProfileIds({
      db,
      organizationId,
    }).then((additionalAgentProfileIds) =>
      resolveOrganizationDirectoryAgentProfiles({
        additionalAgentProfileIds,
        authWorker: env.OPENMELD_AUTH_WORKER,
        organizationId,
        requestId,
      })
    );
  const [members, centerAgentDesignation, agentProfileProjection] =
    await Promise.all([
      membersPromise,
      centerAgentDesignationPromise,
      agentProfileProjectionPromise,
    ]);
  const agentProfilesById = new Map(
    agentProfileProjection.organizationAgentProfiles.map((profile) => [
      profile.profileId,
      profile,
    ])
  );
  for (const profile of agentProfileProjection.additionalAgentProfiles) {
    if (profile.status === "active") {
      agentProfilesById.set(profile.profileId, profile);
    }
  }
  const eligibleAgentProfiles = [...agentProfilesById.values()]
    .filter((agent) =>
      isAgentProfileEligibleForOrganization({
        managedRole: agent.managedRole,
        profileOrganizationId: agent.organizationId,
        targetOrganizationId: organizationId,
      })
    )
    .sort(
      (left, right) =>
        left.profileName.localeCompare(right.profileName, undefined, {
          sensitivity: "base",
        }) || left.profileId.localeCompare(right.profileId)
    );
  const agentProfiles = await Promise.all(
    eligibleAgentProfiles.map(async (agent) => {
      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        activeOrganizationId: organizationId,
        env,
        generatedAt,
        profileId: agent.profileId,
      });
      return {
        ...agent,
        isCenterAgent:
          centerAgentDesignation?.agentProfileId === agent.profileId,
        readiness: buildGetAgentExecutionReadinessResponse({
          generatedAt,
          readiness,
        }),
      };
    })
  );

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
  return validated.data;
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

async function buildOrganizationMemberOpenMeldServiceStatusesResponse(input: {
  env: CoreBindings;
  generatedAt: string;
  memberUserIds: readonly string[];
  organizationId: string;
}): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
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
      return ownerService.sessions.map((session) => ({
        executionCompatibility: session.executionCompatibility,
        serviceUpdateWakeBlocked: resolveLocalComponentUpdateProjection({
          generatedAt: input.generatedAt,
          localComponentsStatus: session.capabilities.localComponents ?? null,
          serviceConnected: true,
          serviceVersion: session.serviceVersion ?? null,
        }).service.wakeBlocked,
      }));
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
      ({ activeMemberCount: _activeMemberCount, ...space }) => space
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
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  const response = await listOrganizationSpacesFromSpaceIndex({
    db: requireSpaceIndexDb(env),
    generatedAt: new Date().toISOString(),
    limit: ORGANIZATION_SPACE_DIRECTORY_LIMIT,
    organizationId: activeOrganization.organizationId,
    ownerUserId: activeOrganization.userId,
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
    service: requireConnectorService(input.service),
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

export async function rpcCenterAgentResolveConnectorConnection(
  env: CoreBindings,
  input: CenterAgentResolveConnectorConnectionInput
): Promise<CenterAgentConnectorConnectionSelection> {
  const context = requireRpcContext(input.context);
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context,
    env,
  });
  const service = requireConnectorService(input.service);
  const connectionPreference = requireConnectorConnectionPreference(
    input.connectionPreference
  );
  if (service === "github" && connectionPreference === "automatic") {
    throw createCoreRpcHttpError({
      code: "connector.github_identity_required",
      reason:
        "GitHub actions must explicitly choose Organization access or the requester's GitHub.",
      status: 400,
    });
  }
  const requesterUserId = normalizeOptionalText(input.requesterUserId);
  if (requesterUserId) {
    await requireConnectorRequesterMembership({
      env,
      organizationId: authorization.activeOrganization.organizationId,
      requestId: context.actorContext.requestId,
      userId: requesterUserId,
    });
  }
  const selected = await selectActiveConnectorConnection({
    db: requireConnectorConnectionDb(env),
    organizationId: authorization.activeOrganization.organizationId,
    preference: connectionPreference,
    requesterUserId,
    service,
  });
  const response: CenterAgentConnectorConnectionSelection = selected
    ? {
        connection: await toConnectorConnectionDto({
          canDisconnect: false,
          connection: selected.connection,
          env,
        }),
        selection: selected.selection,
      }
    : { connection: null, selection: null };
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
  if (expectedOrganizationId !== input.activeOrganizationId) {
    throw createCoreRpcHttpError({
      code: "connector.organization_context_changed",
      reason:
        "The active Organization changed before this GitHub request was applied.",
      status: 409,
    });
  }
}

async function resolveConnectorConnectionUnavailableReason(input: {
  db: D1Database;
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
  const requestedModelId =
    parsed.data.preference.kind === "system_default"
      ? null
      : parsed.data.preference.modelId;
  try {
    resolveCenterAgentModelRouteForBinding({
      binding: {
        configurationRevision: current.configurationRevision,
        modelId: requestedModelId,
      },
      catalog: readModelCatalog(),
    });
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
        reasoningLevel: null,
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
  const [designation, creatorUserId] = await Promise.all([
    readCenterAgentDesignationRecord({
      db,
      organizationId: activeOrganization.organizationId,
    }),
    readOrganizationCreatorUserId({
      env,
      organizationId: activeOrganization.organizationId,
    }),
  ]);
  if (!designation) {
    throw createCoreRpcHttpError({
      code: "center_agent.designation_required",
      reason: "This Organization has no designated Center Agent.",
      status: 409,
    });
  }
  return getCenterAgentOperatingStateResponseSchema.parse({
    canChangeOperatingState: creatorUserId === activeOrganization.userId,
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
  const stateDatabase = localStateDb(env);
  if (!stateDatabase) {
    throw createCoreRpcHttpError({
      code: "message_channel.store_unavailable",
      reason: "Message Channel connection state is unavailable.",
      status: 503,
    });
  }
  return messageChannelConnectionListResponseSchema.parse({
    availableLarkPlatformProviders:
      listLarkPlatformProvidersEnabledForOrganization({
        env,
        organizationId: activeOrganization.organizationId,
      }),
    connections: await listRemoteAgentMessageChannelConnectionProjections({
      identityDb: identityDatabase,
      organizationId: activeOrganization.organizationId,
      stateDb: stateDatabase,
    }),
    organizationId: activeOrganization.organizationId,
  });
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
  const stateDatabase = localStateDb(env);
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
  const existingLink = await readRemoteAgentLarkPlatformIdentityLink({
    connectionId: linkContext.token.connectionId,
    db: linkContext.stateDb,
    provider: linkContext.token.provider,
    providerUserId: linkContext.token.providerUserId,
  });
  if (
    existingLink &&
    existingLink.openmeldUserId !== linkContext.membership.userId
  ) {
    throw createCoreRpcHttpError({
      code: "message_channel.identity_already_linked",
      reason: `This ${providerLabel(
        linkContext.token.provider
      )} account is already linked to another OpenMeld member.`,
      status: 409,
    });
  }
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
  const consumed = await consumeRemoteAgentMessageChannelIdentityLinkToken({
    db: linkContext.stateDb,
    nowMs,
    token: claimedToken,
    openmeldUserId: ensuredMembership.membership.userId,
  });
  if (!consumed) {
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
    openMeldUserId: ensuredMembership.membership.userId,
  });
}

export async function rpcBeginLarkPlatformRegistration(
  env: CoreBindings,
  input: BeginLarkPlatformRegistrationInput
): Promise<LarkPlatformRegistrationResponse> {
  const request = await requireLarkPlatformRegistrationRequest(env, input);
  try {
    return await beginRemoteAgentLarkPlatformRegistration({
      ...request,
      repairExisting: input.mode === "repair",
      env,
      restartPending: input.mode === "restart",
    });
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
    return await pollRemoteAgentLarkPlatformRegistration({
      ...request,
      attemptId: attemptId.data,
      env,
    });
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
    await disconnectRemoteAgentLarkPlatformRegistration(request);
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
    });
  if (!conversation) {
    throw createCoreRpcHttpError({
      code: "center_agent.context_conversation_required",
      reason:
        "Start a conversation with Center Agent before reading its context.",
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
  { ok: false }
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
  const db = identityDb(input.env);
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
  db: D1Database;
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
  membership: SlackIdentityLinkMembershipContext & { role: string };
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
  db: D1Database;
  env: CoreBindings;
  slackTeamId: string;
  slackUserId: string;
}): Promise<void> {
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
  db: D1Database;
  organizationId: string;
  resource: { id: string; type: string } | null;
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
  const db = identityDb(input.env);
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

function isLocalAgentBackedCenterAgentRuntimeEnabled(
  _env: CoreBindings
): boolean {
  return false;
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
  const owner = {
    id: activeOrganization.userId,
    kind: "owner_account" as const,
  };
  if (body.data.runtime === "remote_agent") {
    await designateRemoteCenterAgentBinding({
      activeOrganization,
      agentProfileId,
      bindingDb,
      context,
      env,
      owner,
    });
  } else {
    // Local-agent-backed Center Agent is intentionally hidden pending the hosted-runtime feature bar (always-on, Slack, watchdog, cross-space context); to be redesigned together with bring-your-own-agent support.
    if (!isLocalAgentBackedCenterAgentRuntimeEnabled(env)) {
      throw createCoreRpcHttpError({
        status: 403,
        reason:
          "Local-agent-backed Center Agent runtime is not available. Connect the hosted Remote Agent runtime instead.",
        code: "center_agent.local_runtime_hidden",
      });
    }
    await assertSelfHostedDesignatableCenterAgentProfile({
      activeOrganization,
      agentProfileId,
      bindingDb,
      owner,
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

export async function rpcUpdateCenterAgentProfile(
  env: CoreBindings,
  input: UpdateCenterAgentProfileInput
): Promise<CenterAgentUpdateProfileResponse> {
  const context = requireRpcContext(input.context);
  const body = centerAgentUpdateProfileBodySchema.safeParse({
    profileName: input.profileName,
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
  const updated = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.updateCenterAgentProfileInOrganization({
        organizationId: activeOrganization.organizationId,
        profileId: managedProfile.profileId,
        profileName: body.data.profileName,
      }),
    unavailable: {
      code: "center_agent.profile_update_unavailable",
      reason: "Center Agent profile update is unavailable.",
    },
  });
  if (!updated.ok) {
    throw createCoreRpcHttpError({
      status: updated.code === "profile.not_found" ? 404 : 409,
      reason: updated.message,
      code: `center_agent.${updated.code}`,
    });
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
  const creatorUserId = await readOrganizationCreatorUserId({
    env,
    organizationId: activeOrganization.organizationId,
  });
  if (!creatorUserId || creatorUserId !== activeOrganization.userId) {
    throw createCoreRpcHttpError({
      code: "center_agent.creator_required",
      reason:
        "Only the Organization creator can pause or resume the Center Agent.",
      status: 403,
    });
  }
  const actorProfileId = normalizeOptionalText(
    context.actorContext.openMeldProfileId
  );
  if (!(actorProfileId && context.actorContext.profileKind === "human")) {
    throw createCoreRpcHttpError({
      code: "center_agent.human_actor_required",
      reason:
        "Pause and Resume require the Organization creator's Human Profile.",
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
    returnPath: buildSlackOAuthChannelsReturnPath(organizationSlug),
    userId: activeOrganization.userId,
  });
  return slackOAuthStateCreateResponseSchema.parse(result);
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
  });
  if ("record" in result && parsed.data.slackInstallerUserId) {
    try {
      const key = {
        connectionCreatedAtMs: result.record.createdAtMs,
        organizationId: parsed.data.organizationId,
        recipientSlackUserId: parsed.data.slackInstallerUserId,
        slackTeamId: parsed.data.slackTeamId,
        welcomeVersion: SLACK_INSTALLATION_WELCOME_VERSION,
      };
      if (result.status === "unchanged") {
        await authorizeFailedSlackInstallationWelcomeRetry({ db, key, nowMs });
      } else {
        await enqueueSlackInstallationWelcomePreparation({
          allowCreate: result.status === "created" || result.status === "moved",
          connectionCreatedAtMs: result.record.createdAtMs,
          db,
          installedByProfileId: parsed.data.actorProfileId,
          installedByUserId: parsed.data.installedByUserId,
          messageKind: result.status === "moved" ? "moved" : "connected",
          nowMs,
          organizationId: parsed.data.organizationId,
          recipientSlackUserId: parsed.data.slackInstallerUserId,
          slackTeamId: parsed.data.slackTeamId,
        });
      }
    } catch (error) {
      console.warn("[core.slack_oauth.installation_welcome_queue_failed]", {
        error: error instanceof Error ? error.message : String(error),
        organizationId: parsed.data.organizationId,
        slackTeamId: parsed.data.slackTeamId,
      });
    }
  }
  const response: SlackOAuthInstallationResult =
    "existing" in result
      ? { existing: result.existing, status: result.status }
      : { status: result.status };
  return slackOAuthInstallationResultSchema.parse(response);
}

export async function runSlackInstallationWelcomePreparationTick(input: {
  db: D1Database;
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
    openDirectMessage?: (
      context: CoreRpcContextInput
    ) => Promise<{ spaceId: string }>;
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
        suppressWelcome: true,
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
}): Promise<{ taskId: string }> {
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
}): Promise<{ taskId: string }> {
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
}): Promise<{ taskId: string }> {
  const db = requireCenterAgentDb(input.env);
  const humanProfile = await db
    .prepare(
      `
        SELECT profiles.profile_name, users.name AS owner_name
        FROM openmeld_profiles AS profiles
        INNER JOIN users ON users.id = profiles.owner_user_id
        WHERE profiles.profile_id = ?
          AND profiles.owner_user_id = ?
          AND profiles.profile_kind = 'human'
          AND profiles.status = 'active'
        LIMIT 1
      `
    )
    .bind(input.actorProfileId, input.actorUserId)
    .first<{ owner_name: string; profile_name: string }>();
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
    suppressWelcome: true,
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
  const repository = createD1CenterAgentMemoryRepository(
    requireCenterAgentDb(env)
  );
  const policy = await repository.readPolicy(activeOrganization.organizationId);
  return centerAgentOrganizationMemoryPolicyResponseSchema.parse({
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
  const repository = createD1CenterAgentMemoryRepository(
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
  try {
    const origin = await requireExplicitMemoryEpisodeOrigin({
      authorization,
      env,
    });
    await memoryService.rememberFactForOrganization({
      fact: parsed.data.fact,
      organizationId: authorization.activeOrganization.organizationId,
      origin,
      speakerMember,
    });
  } catch (error) {
    if (
      toErrorMessage(error).includes(
        "center_agent_memory.organization_memory_opt_in_required"
      )
    ) {
      throw createCoreRpcHttpError({
        status: 403,
        reason:
          "Organization memory is off. Ask an Organization owner or admin to turn on organization memory from the Center Agent page (Manage → Memory).",
        code: "center_agent_memory.organization_memory_opt_in_required",
      });
    }
    throw error;
  }
  return centerAgentRememberForOrganizationResponseSchema.parse({
    fact: parsed.data.fact,
    organizationId: authorization.activeOrganization.organizationId,
    saved: true,
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
  const response: SlackIdentityLinkPreviewResponse = {
    alreadyMember: Boolean(linkContext.membership.role),
    continuesRequest: Boolean(linkContext.token.sourceDeliveryId),
    expiresAt: toIsoDateTime(linkContext.token.expiresAtMs),
    organizationId: linkContext.membership.organizationId,
    organizationName: linkContext.membership.organizationName,
    slackDisplayName: linkContext.token.slackUserDisplayName,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
    slackWorkspaceLabel: resolveSlackWorkspaceLabel({
      slackTeamId: linkContext.token.slackTeamId,
      workspaceName: linkContext.workspace.workspaceName,
    }),
    openMeldAccountEmail: linkContext.membership.userEmail,
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
  if (claimResult.status === "already_linked") {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "This Slack account is already linked to another OpenMeld member.",
      code: "slack.identity_already_linked",
    });
  }
  if (claimResult.status === "invalid") {
    throw createSlackIdentityLinkTokenInvalidError();
  }
  await requireCurrentSlackIdentityLinkMember({
    db,
    env,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
  });
  const ensuredMembership = await ensureSlackIdentityLinkMembership({
    env,
    membership: linkContext.membership,
  });
  const consumeResult = await consumeSlackIdentityLinkTokenAndUpsertUserLink({
    consumeNonce: crypto.randomUUID(),
    db,
    consumedAtMs: nowMs,
    organizationId: ensuredMembership.membership.organizationId,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
    tokenHash: linkContext.token.tokenHash,
    openmeldUserId: ensuredMembership.membership.userId,
  });
  if (consumeResult.status === "already_linked") {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "This Slack account is already linked to another OpenMeld member.",
      code: "slack.identity_already_linked",
    });
  }
  if (consumeResult.status === "invalid") {
    throw createSlackIdentityLinkTokenInvalidError();
  }
  let continuationStatus: "legacy" | "retryable_failure" | "submitted";
  try {
    continuationStatus = await continueSlackIdentityOnboardingRequest({
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
    continuationStatus = "retryable_failure";
  }
  const response: SlackIdentityLinkConsumeResponse = {
    continuationRetryable: continuationStatus === "retryable_failure",
    continued: continuationStatus === "submitted",
    joinedOrganization: ensuredMembership.joinedOrganization,
    linked: true,
    organizationId: ensuredMembership.membership.organizationId,
    organizationName: ensuredMembership.membership.organizationName,
    slackDisplayName: linkContext.token.slackUserDisplayName,
    slackTeamId: linkContext.token.slackTeamId,
    slackUserId: linkContext.token.slackUserId,
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

export async function rpcListCenterAgentAuditJournal(
  env: CoreBindings,
  input: ListCenterAgentAuditJournalInput
): Promise<ListCenterAgentAuditJournalResponse> {
  const context = requireRpcContext(input.context);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
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
  let excludedActions: readonly CenterAgentAction[] | undefined;
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
    ];
  } else if (parsed.data.actionSet === "v5") {
    excludedActions = [
      ...slackWorkspaceDirectoryActions,
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
    ];
  } else if (parsed.data.actionSet === "v6") {
    excludedActions = [
      ...slackChannelReadActions,
      ...slackSearchActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
    ];
  } else if (parsed.data.actionSet === "v7") {
    excludedActions = [
      ...slackChannelReadActions,
      ...projectActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
    ];
  } else if (parsed.data.actionSet === "v8") {
    excludedActions = [
      ...slackChannelReadActions,
      ...taskCoordinationActions,
      ...memberServiceStatusActions,
    ];
  } else if (parsed.data.actionSet === "v9") {
    excludedActions = [
      ...slackChannelReadActions,
      ...taskReadActions,
      ...memberServiceStatusActions,
    ];
  } else if (parsed.data.actionSet === "v10") {
    excludedActions = [
      ...slackChannelReadActions,
      ...memberServiceStatusActions,
    ];
  } else if (parsed.data.actionSet === "v11") {
    excludedActions = memberServiceStatusActions;
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
  const response: ListCenterAgentAuditJournalResponse = {
    organizationId: activeOrganization.organizationId,
    entries: entries.map((entry) =>
      toCenterAgentAuditJournalEntryDto(entry, {
        includeContextDetails:
          parsed.data.actionSet === "v16" ||
          parsed.data.actionSet === "v17" ||
          parsed.data.actionSet === "v18",
        includeInteractionSource:
          parsed.data.actionSet === "v14" ||
          parsed.data.actionSet === "v15" ||
          parsed.data.actionSet === "v16" ||
          parsed.data.actionSet === "v17" ||
          parsed.data.actionSet === "v18",
      })
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
    actionSet === "v18"
  );
}

function applyCenterAgentAuditOperatingStateCompatibility(input: {
  actionSet: string | undefined;
  excludedActions: readonly CenterAgentAction[] | undefined;
  routineActions: readonly CenterAgentAction[];
}): readonly CenterAgentAction[] {
  const localAgentCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v14" ||
    input.actionSet === "v15" ||
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18"
      ? []
      : ["receive_local_agent_request"];
  const contextCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v15" ||
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18"
      ? []
      : ["read_center_agent_context"];
  const contextLoadCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18"
      ? []
      : ["load_center_agent_context"];
  const routineCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v17" || input.actionSet === "v18"
      ? []
      : input.routineActions;
  const workingLanguageCompatibilityActions: readonly CenterAgentAction[] =
    input.actionSet === "v18"
      ? []
      : ["set_working_language", "observe_working_language"];
  if (
    input.actionSet === "v13" ||
    input.actionSet === "v14" ||
    input.actionSet === "v15" ||
    input.actionSet === "v16" ||
    input.actionSet === "v17" ||
    input.actionSet === "v18"
  ) {
    return [
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
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed =
    centerAgentListLocalAgentConnectionCandidatesBodySchema.safeParse({});
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent local agent candidate payload",
      code: "invalid_payload",
    });
  }
  const response = await listLocalAgentConnectionCandidatesOperation({
    deps: buildCenterAgentProductOperationDeps(env, authorization),
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

export async function rpcCenterAgentListComputers(
  env: CoreBindings,
  input: CenterAgentListComputersInput
): Promise<CenterAgentListComputersResponse> {
  const parsed = centerAgentListComputersBodySchema.safeParse({
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
  const validated = centerAgentListComputersResponseSchema.safeParse({
    computers: projectCenterAgentComputerSetupOptions(localRuntimes),
    organizationId: authorization.activeOrganization.organizationId,
  });
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent computer list response: ${validated.error.message}`
    );
  }
  return validated.data;
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
  const response = await connectAgentProfileToLocalAgentOperation({
    deps: buildCenterAgentProductOperationDeps(env, authorization),
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

export async function rpcCenterAgentUpdateAgentProfileRuntimeSettings(
  env: CoreBindings,
  input: CenterAgentUpdateAgentProfileRuntimeSettingsInput
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
      modelId: input.modelId,
      ...(input.onBehalfOf === undefined
        ? {}
        : { onBehalfOf: input.onBehalfOf }),
      openCodePermission: input.openCodePermission,
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
  const response = await updateAgentProfileRuntimeSettingsOperation({
    deps: buildCenterAgentProductOperationDeps(env, authorization),
    organizationId: authorization.activeOrganization.organizationId,
    request: parsed.data,
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
    deps: buildCenterAgentProductOperationDeps(env, authorization),
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

export async function rpcCenterAgentCreateConfiguredAgentProfile(
  env: CoreBindings,
  input: CenterAgentCreateConfiguredAgentProfileInput
): Promise<CenterAgentCreateConfiguredAgentProfileResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentCreateConfiguredAgentProfileBodySchema.safeParse({
    agentControllerCollaborationMode: input.agentControllerCollaborationMode,
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    candidateId: input.candidateId,
    modelId: input.modelId,
    ...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
    openCodePermission: input.openCodePermission,
    profileName: input.profileName,
    reasoningLevel: input.reasoningLevel,
    spaceId: input.spaceId,
    workspaceMode: input.workspaceMode,
    workspacePath: input.workspacePath,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid Center Agent configured Agent Profile payload",
      code: "invalid_payload",
    });
  }
  const response = await createConfiguredAgentProfileOperation({
    deps: buildCenterAgentProductOperationDeps(env, authorization),
    request: parsed.data,
  });
  const validated =
    centerAgentCreateConfiguredAgentProfileResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent configured Agent Profile response: ${validated.error.message}`
    );
  }
  return validated.data;
}

function buildCenterAgentProductOperationDeps(
  env: CoreBindings,
  authorization: Awaited<
    ReturnType<typeof requireCurrentDesignatedCenterAgentCaller>
  >
): CenterAgentProductOperationDeps {
  const context = authorization.context;
  const organizationId = authorization.activeOrganization.organizationId;
  return {
    addAgentProfileToSpace: async ({ agentProfileId, onBehalfOf, spaceId }) => {
      await rpcCenterAgentAddAgentProfilesToSpace(env, {
        agentProfileIds: [agentProfileId],
        context,
        ...(onBehalfOf === undefined ? {} : { onBehalfOf }),
        spaceId,
      });
    },
    authorizeAgentProfileForOrganization: async ({ agentProfileId }) => {
      await rpcAuthorizeAgentProfileBindingForOrganization(env, {
        agentProfileId,
        context,
      });
    },
    checkAgentProfileReadiness: async ({ agentProfileId }) => {
      const readiness = await rpcGetAgentExecutionReadiness(env, {
        agentProfileId,
        context,
      });
      return buildCenterAgentReadinessResponse({
        organizationId,
        readiness,
      });
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
        context,
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
      const localRuntimes = await rpcListLocalRuntimes(env, {
        connectionIdentityAdoption: "safe_legacy_current",
        context,
      });
      return projectCenterAgentLocalAgentConnectionCandidates({
        localRuntimes,
        organizationId,
      });
    },
    setAgentProfileWorkspace: async ({
      agentProfileId,
      workspaceMode,
      workspacePath,
    }) =>
      await rpcSetCurrentAgentProfileWorkspace(env, {
        agentProfileId,
        context,
        workspaceMode,
        ...(workspacePath === undefined ? {} : { workspacePath }),
      }),
    updateAgentControllerPermissionMode: async ({
      agentControllerPermissionMode,
      agentProfileId,
    }) =>
      await rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
        env,
        {
          agentControllerPermissionMode,
          agentProfileId,
          context,
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
          context,
        }
      ),
    updateModelSelection: async ({ agentProfileId, modelId, reasoningLevel }) =>
      await rpcUpdateAgentProfilePrimaryBindingModelSelection(env, {
        agentProfileId,
        context,
        modelId,
        ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
      }),
    updateOpenCodePermission: async ({ agentProfileId, openCodePermission }) =>
      await rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(env, {
        agentProfileId,
        context,
        openCodePermission,
      }),
  };
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
  const created = await createSpaceWithResolvedId(env, {
    spaceId: resolveNewSpaceId(env.OPENMELD_SPACES).toString(),
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

  const created = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.createAgentProfileInOrganization({
        organizationId: authorization.activeOrganization.organizationId,
        ownerUserId: authorization.activeOrganization.userId,
        createdByUserId: authorization.activeOrganization.userId,
        creatorProfileId: authorization.actorProfileId,
        profileName: parsed.data.profileName,
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
  await requireCenterAgentDb(env)
    .prepare(
      `
        UPDATE openmeld_profiles
        SET status = 'active',
            updated_at = ?
        WHERE profile_id = ?
          AND organization_id = ?
          AND profile_kind = 'agent'
      `
    )
    .bind(
      Date.now(),
      agentProfileId,
      authorization.activeOrganization.organizationId
    )
    .run();
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
  const slackDb = localStateDb(env);
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
  const slackDb = localStateDb(env);
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
  const slackDb = localStateDb(env);
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
  const slackDb = localStateDb(env);
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
  const slackDb = localStateDb(env);
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
      limit: 5,
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
  const presentation = buildSlackSearchPresentation({
    messages: search.messages,
    moreResultsAvailable: search.moreResultsAvailable,
    query: parsed.data.query,
  });
  try {
    const presentationDeadline = AbortSignal.timeout(10_000);
    await postSlackEphemeralMessage({
      ...presentation,
      botToken,
      channelId: decryptedAuthorization.sourceChannelId,
      signal: presentationDeadline,
      threadTs: decryptedAuthorization.sourceThreadTs,
      userId: decryptedAuthorization.slackUserId,
    });
  } catch (error) {
    console.warn("[core.center_agent.slack_search.presentation_unavailable]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      slackTeamId: binding.slackTeamId,
    });
    return buildCenterAgentSlackSearchPresentationFailure({
      error,
      organizationId,
    });
  }
  const response: CenterAgentSearchSlackMessagesResponse = {
    organizationId,
    status: "presented",
  };
  return centerAgentSearchSlackMessagesResponseSchema.parse(response);
}

export async function rpcCenterAgentReadTransientSlackSearch(
  env: CoreBindings,
  input: RemoteAgentTransientSlackSearchRequest
): Promise<RemoteAgentTransientSlackSearchResponse> {
  const parsed = remoteAgentTransientSlackSearchRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "invalid transient Slack search payload",
      status: 400,
    });
  }
  const preparation = await prepareTransientSlackSearchRequest(
    env,
    parsed.data
  );
  if (preparation.status === "failed") {
    return preparation.response;
  }
  try {
    const search = await searchSlackPublicMessages({
      actionToken: preparation.slackAuthorization.actionToken,
      botToken: preparation.botToken,
      includeBots: parsed.data.includeBots,
      includeContextMessages: true,
      limit: 8,
      query: parsed.data.query,
      signal: AbortSignal.timeout(10_000),
    });
    await writeCenterAgentAuditEntry({
      action: "search_slack_messages",
      authorization: preparation.centerAgentAuthorization,
      onBehalfOfProfileId: preparation.representedHuman.profileId,
      resource: {
        id: preparation.binding.slackTeamId,
        type: "slack_workspace",
      },
      sourceNativeDeliveryId: null,
    });
    console.info("[core.center_agent.slack_search.transient_completed]", {
      contextMessageCount: search.messages.reduce(
        (count, message) => count + message.contextMessages.length,
        0
      ),
      messageCount: search.messages.length,
      organizationId: parsed.data.organizationId,
    });
    return remoteAgentTransientSlackSearchResponseSchema.parse({
      messages: search.messages,
      moreResultsAvailable: search.moreResultsAvailable,
      status: "found",
      v: 1,
    });
  } catch (error) {
    return buildTransientSlackSearchProviderFailure({
      error,
      organizationId: parsed.data.organizationId,
    });
  }
}

type PreparedTransientSlackSearchRequest =
  | {
      response: RemoteAgentTransientSlackSearchResponse;
      status: "failed";
    }
  | {
      binding: RemoteAgentSlackWorkspaceBindingRecord;
      botToken: string;
      centerAgentAuthorization: CurrentDesignatedCenterAgentAuthorization;
      representedHuman: VerifiedCenterAgentRepresentedMember;
      slackAuthorization: Awaited<
        ReturnType<typeof decryptSlackSearchAuthorization>
      >;
      status: "ready";
    };

async function prepareTransientSlackSearchRequest(
  env: CoreBindings,
  input: RemoteAgentTransientSlackSearchRequest
): Promise<PreparedTransientSlackSearchRequest> {
  const slackDb = localStateDb(env);
  const memberDb = identityDb(env);
  if (!(slackDb && memberDb)) {
    return transientSlackSearchPreparationFailure(
      "Slack connection state is unavailable. Try again later."
    );
  }
  const { authorization: centerAgentAuthorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      input.requestContext,
      input.requester,
      {
        code: "center_agent.slack_search_speaker_required",
        reason:
          "Slack search requires a verified active human Organization member.",
      }
    );
  if (
    centerAgentAuthorization.activeOrganization.organizationId !==
    input.organizationId
  ) {
    return transientSlackSearchPreparationFailure(
      "This Slack search request does not belong to the active Organization.",
      "forbidden"
    );
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: slackDb,
    organizationId: input.organizationId,
  });
  if (!binding) {
    return transientSlackSearchPreparationFailure(
      "Connect this Organization to Slack, then send a new message and try again."
    );
  }
  const cryptoKey = String(env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY ?? "").trim();
  if (!cryptoKey) {
    return transientSlackSearchPreparationFailure(
      "Slack search authorization is unavailable. Try again later."
    );
  }
  let slackAuthorization: Awaited<
    ReturnType<typeof decryptSlackSearchAuthorization>
  >;
  try {
    slackAuthorization = await decryptSlackSearchAuthorization({
      cryptoKey,
      encryptedAuthorization: input.searchAuthorization.encryptedAuthorization,
    });
  } catch {
    return transientSlackSearchPreparationFailure(
      "Slack search authorization expired. Send a new Slack message and try again.",
      "authorization_expired"
    );
  }
  if (
    !transientSlackSearchAuthorizationMatchesRequest({
      authorization: slackAuthorization,
      memberId: representedHuman.memberId,
      openMeldUserId: representedHuman.userId,
      organizationId: input.organizationId,
      slackTeamId: binding.slackTeamId,
      slackUserId: input.requester.slackUserId,
    })
  ) {
    return transientSlackSearchPreparationFailure(
      "This Slack search authorization does not belong to the current requester or workspace.",
      "forbidden"
    );
  }
  let botToken: string;
  try {
    botToken = await resolveSlackBotToken({
      cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
      db: slackDb,
      fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
      slackTeamId: binding.slackTeamId,
    });
  } catch {
    return transientSlackSearchPreparationFailure(
      "Slack search is unavailable right now. Try again later."
    );
  }
  return {
    binding,
    botToken,
    centerAgentAuthorization,
    representedHuman,
    slackAuthorization,
    status: "ready",
  };
}

function transientSlackSearchPreparationFailure(
  reason: string,
  status: Exclude<
    RemoteAgentTransientSlackSearchResponse["status"],
    "found"
  > = "unavailable"
): PreparedTransientSlackSearchRequest {
  return {
    response: buildTransientSlackSearchFailure(reason, status),
    status: "failed",
  };
}

function buildTransientSlackSearchProviderFailure(input: {
  error: unknown;
  organizationId: string;
}): RemoteAgentTransientSlackSearchResponse {
  if (input.error instanceof SlackApiError) {
    if (
      input.error.errorCode === "invalid_action_token" ||
      input.error.errorCode === "token_expired"
    ) {
      return buildTransientSlackSearchFailure(
        "Slack search authorization expired. Send a new Slack message and try again.",
        "authorization_expired"
      );
    }
    if (isSlackRateLimitError(input.error)) {
      return buildTransientSlackSearchFailure(
        "Slack search is temporarily rate limited. Try again in a moment.",
        "rate_limited"
      );
    }
    if (isSlackPermissionError(input.error)) {
      return buildTransientSlackSearchFailure(
        "The connected Slack app does not have permission to search these messages.",
        "forbidden"
      );
    }
  }
  console.warn("[core.center_agent.slack_search.transient_failed]", {
    error:
      input.error instanceof Error ? input.error.message : String(input.error),
    organizationId: input.organizationId,
  });
  return buildTransientSlackSearchFailure(
    "Slack search is unavailable right now. Try again later.",
    "unavailable"
  );
}

function buildTransientSlackSearchFailure(
  reason: string,
  status: Exclude<RemoteAgentTransientSlackSearchResponse["status"], "found">
): RemoteAgentTransientSlackSearchResponse {
  return remoteAgentTransientSlackSearchResponseSchema.parse({
    reason,
    status,
    v: 1,
  });
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

function transientSlackSearchAuthorizationMatchesRequest(input: {
  authorization: Awaited<ReturnType<typeof decryptSlackSearchAuthorization>>;
  memberId: string;
  openMeldUserId: string;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
}): boolean {
  return (
    slackSearchAuthorizationMatchesRequest(input) &&
    input.authorization.slackUserId === input.slackUserId
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

function buildCenterAgentSlackSearchPresentationFailure(input: {
  error: unknown;
  organizationId: string;
}): CenterAgentSearchSlackMessagesResponse {
  if (input.error instanceof SlackApiError) {
    if (isSlackRateLimitError(input.error)) {
      return buildCenterAgentSlackSearchFailure({
        organizationId: input.organizationId,
        reason:
          "Slack temporarily rate limited the private search results. Wait before trying again.",
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
          "The connected Slack app cannot privately present search results to this requester.",
        status: "forbidden",
      });
    }
  }
  return buildCenterAgentSlackSearchFailure({
    organizationId: input.organizationId,
    reason:
      "Slack search results could not be presented privately. Try again later.",
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
        "presented"
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

async function prepareCenterAgentOrganizationMemberRead(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    speakerMember?: CenterAgentToolSpeaker;
  }
): Promise<{
  authorization: CurrentDesignatedCenterAgentAuthorization;
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
      sourceNativeDeliveryId: prepared.member.sourceNativeDeliveryId,
    };
  }
  return {
    authorization: await requireCurrentDesignatedCenterAgentCaller({
      context,
      env,
    }),
    sourceNativeDeliveryId: null,
  };
}

function normalizeEmailForIdentityMatch(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export async function rpcCenterAgentReadSpaceContext(
  env: CoreBindings,
  input: CenterAgentReadSpaceContextInput
): Promise<CenterAgentReadSpaceContextResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentReadSpaceContextBodySchema.safeParse({
    ...(input.afterSignalId === undefined
      ? {}
      : { afterSignalId: input.afterSignalId }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
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
  await writeCenterAgentAuditEntry({
    action: "read_space_context",
    authorization,
    onBehalfOfProfileId: null,
    resource: { type: "space", id: parsed.data.spaceId },
  });
  const validated =
    centerAgentReadSpaceContextResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Center Agent Space context response: ${validated.error.message}`
    );
  }
  return validated.data;
}

type ProgressiveSpaceContext = Extract<
  CenterAgentReadSpaceContextResponse,
  { context: unknown }
>["context"];

async function readCenterAgentProgressiveSpaceContext(input: {
  context: CoreRpcContextInput;
  env: CoreBindings;
  input: CenterAgentReadSpaceContextBody & {
    scope: NonNullable<CenterAgentReadSpaceContextBody["scope"]>;
  };
}): Promise<ProgressiveSpaceContext> {
  const limit = input.input.limit ?? 20;

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

  const dispatchHistoryDb = wakeEvidenceDb(env);
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
    spaceId: parsed.data.spaceId,
    text: parsed.data.text,
  });
  if (signal.type !== "signal.text") {
    throw new Error(
      `Center Agent Space message expected signal.text but received ${signal.type}`
    );
  }
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
    signal,
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
  return centerAgentSpaceAuthoringContractResponseSchema.parse({
    addressingModel: "wake_reference",
    structuredReferenceTargets: true,
  });
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
  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.slack_channel_speaker_required",
        reason:
          "Slack channel publication requires a verified active human Organization member.",
      }
    );

  const slackDb = localStateDb(env);
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
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: slackDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: binding.slackTeamId,
  });
  const target = await resolveSlackChannelMessageTarget({
    botToken,
    channelName: parsed.data.channelName,
  });
  return await executeCenterAgentSlackPublication({
    authorization,
    botToken,
    publicationSource: parsed.data.publicationSource,
    representedHuman,
    sourceNativeDeliveryId,
    target,
    text: parsed.data.text,
  });
}

export async function rpcCenterAgentRecordConnectorActionAudit(
  env: CoreBindings,
  input: CenterAgentRecordConnectorActionAuditInput
): Promise<CenterAgentRecordConnectorActionAuditResponse> {
  const parsed = centerAgentRecordConnectorActionAuditBodySchema.safeParse({
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

  const { authorization, representedHuman, sourceNativeDeliveryId } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      requireRpcContext(input.context),
      parsed.data.speakerMember,
      {
        code: "center_agent.connector_action_speaker_required",
        reason:
          "Connector actions require a verified active human Organization member.",
      }
    );
  const action = resolveCenterAgentConnectorAuditAction(parsed.data.outcome);
  const attribution = await writeCenterAgentAuditEntry({
    action,
    authorization,
    onBehalfOfProfileId: representedHuman.profileId,
    resource: {
      type: "connector_action",
      id: `${parsed.data.service}:${parsed.data.actionId}:${parsed.data.operationId}`,
    },
    sourceNativeDeliveryId,
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

  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    env,
    requireRpcContext(input.context),
    parsed.data.speakerMember
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
    operation: existing
      ? {
          actionId: existing.actionId,
          connectionName: existing.connectionName,
          executionConnection: existing.executionConnection,
          operationId: existing.operationId,
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
    actionId: input.actionId,
    connectionName: input.connectionName,
    operationId: input.operationId,
    outcome: input.outcome,
    providerExecutionId: input.providerExecutionId,
    requestSignature: input.requestSignature,
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

  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    env,
    requireRpcContext(input.context),
    parsed.data.speakerMember
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
  if (!existing && parsed.data.outcome === "attempted") {
    const connection = await requireConnectorConnectionForExecution({
      connectionName: parsed.data.connectionName,
      db: authorization.db,
      organizationId: authorization.activeOrganization.organizationId,
    });
    if (
      connection.status !== "active" ||
      connection.service !== parsed.data.service ||
      (connection.scope === "member" && connection.userId !== member.userId)
    ) {
      throw createCoreRpcHttpError({
        code: "center_agent.connector_action_connection_invalid",
        reason:
          "This connector connection is not available to the current Organization member.",
        status: 409,
      });
    }
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
  }
  const result = await recordCenterAgentConnectorActionOperation({
    actionId: parsed.data.actionId,
    actorProfileId: authorization.actorProfileId,
    attribution,
    connectionName: connectionName ?? parsed.data.connectionName,
    db: authorization.db,
    executionConnection,
    nowMs: Date.now(),
    operationId: parsed.data.operationId,
    organizationId: authorization.activeOrganization.organizationId,
    outcome: parsed.data.outcome,
    providerExecutionId: parsed.data.providerExecutionId,
    requester,
    requestSignature: parsed.data.requestSignature,
    service: parsed.data.service,
  });
  return centerAgentRecordConnectorActionOperationResponseSchema.parse({
    attribution: result.attribution,
    executionConnection: result.operation.executionConnection,
    operationId: result.operation.operationId,
    providerExecutionId: result.operation.providerExecutionId,
    recorded: true,
    replayed: result.replayed,
    status: result.operation.status,
  });
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

export async function rpcCenterAgentWakeAgentProfilesInSpace(
  env: CoreBindings,
  input: CenterAgentWakeAgentProfilesInSpaceInput
): Promise<CenterAgentWakeAgentProfilesInSpaceResponse> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentWakeAgentProfilesInSpaceBodySchema.safeParse({
    agentProfileIds: input.agentProfileIds,
    ...(input.completionMode === undefined
      ? {}
      : { completionMode: input.completionMode }),
    ...(input.fallbackAgentProfileId === undefined
      ? {}
      : { fallbackAgentProfileId: input.fallbackAgentProfileId }),
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

  await requireCenterAgentSpaceInActiveOrganization({
    authorization,
    env,
    spaceId: parsed.data.spaceId,
  });

  const db = requireCenterAgentDb(env);
  const taskCoordinationDb = requireAgentTaskCoordinationDb(env);
  const targetProfileIds = [...new Set(parsed.data.agentProfileIds)].sort();
  const referenceProfileIds = [
    ...new Set(parsed.data.referenceProfileIds ?? []),
  ].sort();
  const validatedProfileIds = [
    ...targetProfileIds,
    ...(parsed.data.fallbackAgentProfileId
      ? [parsed.data.fallbackAgentProfileId]
      : []),
  ];
  const centerAgentMember = await requireCenterAgentWakeMembers({
    actorProfileId: authorization.actorProfileId,
    db,
    organizationId: authorization.activeOrganization.organizationId,
    targetProfileIds: validatedProfileIds,
  });

  if (parsed.data.onBehalfOf?.profileId === authorization.actorProfileId) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        "onBehalfOfProfileId must identify the human member the Center Agent is helping.",
      code: "center_agent.on_behalf_of_center_agent_disallowed",
    });
  }

  const clientMessageId = buildCenterAgentWakeClientMessageId({
    activationTargets: targetProfileIds,
    completionMode: parsed.data.completionMode,
    context: authorization.context,
    onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
    fallbackAgentProfileId: parsed.data.fallbackAgentProfileId ?? null,
    spaceId: parsed.data.spaceId,
    referenceProfileIds,
    text: parsed.data.text,
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
        signal: Extract<SignalEnvelope, { type: "signal.text" }>;
      }
    | {
        publicationStatus: "pending";
        retryAfterSeconds: number;
      };
  if (parsed.data.completionMode) {
    const delegatedWake = await executeCenterAgentDelegatedWake({
      authorization,
      clientMessageId,
      completionMode: parsed.data.completionMode,
      db: taskCoordinationDb,
      env,
      fallbackAgentProfileId: parsed.data.fallbackAgentProfileId ?? null,
      onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
      profile,
      referenceProfileIds,
      spaceId: parsed.data.spaceId,
      targetProfileIds,
      text: parsed.data.text,
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
    const postedSignal = await rpcPostSignalOnceByClientMessageId(env, {
      authoringPolicy: "user_authored",
      clientMessageId,
      context: authorization.context,
      messageEnvelope: {
        activationTargets: targetProfileIds,
        referenceTargets: referenceProfileIds,
        text: parsed.data.text,
      },
      meta: { clientMessageId },
      profile,
      spaceId: parsed.data.spaceId,
      text: parsed.data.text,
    });
    if (postedSignal.type !== "signal.text") {
      throw new Error(
        `Center Agent Space Wake expected signal.text but received ${postedSignal.type}`
      );
    }
    publication = {
      signal: postedSignal,
    };
    attribution = await writeCenterAgentAuditEntry({
      action: "wake_agent_profiles_in_space",
      authorization,
      onBehalfOfProfileId: parsed.data.onBehalfOf?.profileId ?? null,
      resource: { type: "space", id: parsed.data.spaceId },
    });
  }
  return buildCenterAgentWakeAgentProfilesInSpaceResponse({
    agentProfileIds: targetProfileIds,
    attribution,
    delegation,
    organizationId: authorization.activeOrganization.organizationId,
    publication,
    spaceId: parsed.data.spaceId,
  });
}

function buildCenterAgentWakeAgentProfilesInSpaceResponse(input: {
  agentProfileIds: string[];
  attribution: CenterAgentWakeAgentProfilesInSpaceResponse["attribution"];
  delegation: ReturnType<typeof planCenterAgentWakeDelegation> | null;
  organizationId: string;
  publication:
    | {
        signal: Extract<SignalEnvelope, { type: "signal.text" }>;
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
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
  const parsed = centerAgentWatchAgentTaskBodySchema.safeParse({
    completionCondition: input.completionCondition,
    instruction: input.instruction,
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
        registeredTask.ownerUserId !== authorization.activeOrganization.userId
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

async function isCenterAgentSpaceWakeWatchTargetRegistered(input: {
  organizationId: string;
  task: Extract<CenterAgentWatchAgentTaskInput["task"], { kind: "space_wake" }>;
  taskCoordinationDb: D1Database;
  wakeEvidenceDb: D1Database;
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
      delegation.spaceId === input.task.spaceId &&
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
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireRpcContext(input.context),
    env,
  });
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
    ownerUserId: authorization.activeOrganization.userId,
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
  db: D1Database;
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
  authorization: CurrentDesignatedCenterAgentAuthorization;
  clientMessageId: string;
  completionMode: CenterAgentWakePublicationCommand["completionMode"];
  db: D1Database;
  env: CoreBindings;
  fallbackAgentProfileId: string | null;
  onBehalfOfProfileId: string | null;
  profile: Profile;
  referenceProfileIds: string[];
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
        signal: Extract<SignalEnvelope, { type: "signal.text" }>;
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
      activationTargets: input.targetProfileIds,
      attribution,
      clientMessageId: input.clientMessageId,
      completionMode: input.completionMode,
      context: input.authorization.context,
      delegationId: delegation.delegationId,
      fallbackAgentProfileId: input.fallbackAgentProfileId,
      organizationId: input.authorization.activeOrganization.organizationId,
      parentSubmissionId,
      profile: input.profile,
      referenceTargets: input.referenceProfileIds,
      spaceId: input.spaceId,
      subscriptionIds: delegation.subscriptionIds,
      text: input.text,
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
  return await rpcPostSignalOnceByClientMessageId(env, {
    authoringPolicy: "user_authored",
    clientMessageId: command.clientMessageId,
    context: command.context,
    messageEnvelope: {
      activationTargets: command.activationTargets,
      referenceTargets: command.referenceTargets,
      text: command.text,
    },
    meta: { clientMessageId: command.clientMessageId },
    profile: command.profile,
    spaceId: command.spaceId,
    text: command.text,
  });
}

export async function rpcResolveCenterAgentWakePublicationSignal(
  env: CoreBindings,
  command: CenterAgentWakePublicationCommand
): Promise<Extract<SignalEnvelope, { type: "signal.text" }> | null> {
  const { stub } = resolveRpcSpaceStubOrThrow(env, command.spaceId);
  const resolution = await stub.rpcResolveOrRejectTextSignalByClientMessageId({
    clientMessageId: command.clientMessageId,
    spaceId: command.spaceId,
  });
  return resolution.status === "accepted" ? resolution.signal : null;
}

function buildCenterAgentWakeClientMessageId(input: {
  activationTargets: readonly string[];
  completionMode?: CenterAgentDelegationCompletionMode;
  context: CoreRpcContextInput;
  fallbackAgentProfileId: string | null;
  onBehalfOfProfileId: string | null;
  referenceProfileIds: readonly string[];
  spaceId: string;
  text: string;
}): string {
  const actorContext = input.context.actorContext;
  const material = JSON.stringify({
    actorRequestId: actorContext.requestId ?? null,
    agentControllerConversationId:
      input.context.agentControllerConversationId ?? null,
    completionMode: input.completionMode ?? null,
    fallbackAgentProfileId: input.fallbackAgentProfileId,
    onBehalfOfProfileId: input.onBehalfOfProfileId,
    profileId: actorContext.openMeldProfileId,
    ...(input.referenceProfileIds.length > 0
      ? { references: [...input.referenceProfileIds].sort() }
      : {}),
    spaceId: input.spaceId,
    targets: [...input.activationTargets].sort(),
    text: input.text.trim(),
  });
  return `ca-wake:${hashClientMessageIdMaterial(material)}`;
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
  authorization: CurrentDesignatedCenterAgentAuthorization;
  env: CoreBindings;
  spaceId: string;
}): Promise<void> {
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
  const timing = createCenterAgentDirectMessageOpenTiming({
    env,
    requestId: context.actorContext.requestId,
  });
  let centerAgentProfileId: string | null = null;
  let failure: unknown;
  let opened: { created: boolean; spaceId: string } | null = null;

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
    const openedSpace = await timing.measure(
      "direct_message_open",
      async () =>
        await openDirectMessageSpaceInternal(env, {
          context,
          humanMember,
          legacySpaceId,
          organizationId: activeOrganization.organizationId,
          targetMember: centerAgentMember,
          timing,
        })
    );
    opened = openedSpace;
    if (!input.suppressWelcome) {
      try {
        await timing.measure(
          "welcome",
          async () =>
            await ensureCenterAgentDirectMessageWelcomeSignal(env, {
              activeOrganization,
              centerAgentMember,
              humanMember,
              requestContext: context,
              spaceId: openedSpace.spaceId,
            })
        );
      } catch (error) {
        console.warn("[core.center_agent.dm_welcome_delivery_failed]", {
          event: "core.center_agent.dm_welcome_delivery_failed",
          organizationId: activeOrganization.organizationId,
          spaceId: openedSpace.spaceId,
          centerAgentProfileId: designation.agentProfileId,
          memberProfileId: humanMember.profileId,
          requestId: context.actorContext.requestId,
          error: toErrorMessage(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
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

async function ensureCenterAgentDirectMessageWelcomeSignal(
  env: CoreBindings,
  input: {
    activeOrganization: ActiveOrganization;
    centerAgentMember: ResolvedSpaceMemberProfile;
    humanMember: ResolvedSpaceMemberProfile;
    requestContext: CoreRpcContextInput;
    spaceId: string;
  }
): Promise<void> {
  const centerAgentContext = buildCenterAgentActorContext({
    activeOrganization: input.activeOrganization,
    centerAgentMember: input.centerAgentMember,
    requestContext: input.requestContext,
  });
  const organization = await readCenterAgentWelcomeOrganizationContext({
    db: requireCenterAgentDb(env),
    organizationId: input.activeOrganization.organizationId,
  });
  const text = buildCenterAgentDirectMessageWelcomeText({
    firstName: resolveFriendlyFirstName(input.humanMember.profileName),
    organizationKind: organization.isPersonal ? "personal" : "organization",
    organizationName: organization.name,
  });
  const clientMessageId = buildCenterAgentDirectMessageWelcomeClientMessageId(
    input.spaceId
  );
  await rpcPostSignalOnceByClientMessageId(env, {
    authoringPolicy: "system_emitted",
    clientMessageId,
    context: centerAgentContext,
    meta: {
      clientMessageId,
      purpose: CENTER_AGENT_DIRECT_MESSAGE_WELCOME_PURPOSE,
    },
    profile: {
      kind: "agent",
      profileId: input.centerAgentMember.profileId,
      profileName: input.centerAgentMember.profileName,
      ...(input.centerAgentMember.ownerUserId
        ? { owner: input.centerAgentMember.ownerUserId }
        : {}),
      ...(input.centerAgentMember.ownerName
        ? { ownerName: input.centerAgentMember.ownerName }
        : {}),
    },
    spaceId: input.spaceId,
    text,
  });
}

function buildCenterAgentDirectMessageWelcomeClientMessageId(
  spaceId: string
): string {
  return `center-agent-dm-welcome:${spaceId}`;
}

function buildCenterAgentActorContext(input: {
  activeOrganization: ActiveOrganization;
  centerAgentMember: ResolvedSpaceMemberProfile;
  requestContext: CoreRpcContextInput;
}): CoreRpcContextInput {
  return {
    activeOrganizationId: input.activeOrganization.organizationId,
    actorContext: {
      callerPrincipalId:
        input.centerAgentMember.ownerUserId ?? input.activeOrganization.userId,
      ownerUserId:
        input.centerAgentMember.ownerUserId ?? input.activeOrganization.userId,
      ...(input.centerAgentMember.ownerName
        ? { ownerName: input.centerAgentMember.ownerName }
        : {}),
      profileKind: "agent",
      profileName: input.centerAgentMember.profileName,
      requestId: `${input.requestContext.actorContext.requestId}:center-agent-welcome`,
      openMeldProfileId: input.centerAgentMember.profileId,
    },
  };
}

type CenterAgentWelcomeOrganizationContext = {
  isPersonal: boolean;
  name: string;
};

async function readCenterAgentWelcomeOrganizationContext(input: {
  db: D1Database;
  organizationId: string;
}): Promise<CenterAgentWelcomeOrganizationContext> {
  const row = await input.db
    .prepare(
      `
        SELECT
          name,
          slug,
          metadata
        FROM organizations
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<{
      metadata: string | null;
      name: string;
      slug: string;
    }>();
  if (!row) {
    throw new Error(
      `Center Agent DM welcome could not resolve Organization ${input.organizationId}`
    );
  }

  return {
    isPersonal:
      row.slug.startsWith("personal-") || hasPersonalOrganizationMetadata(row),
    name: normalizeOptionalText(row.name) ?? "this organization",
  };
}

function hasPersonalOrganizationMetadata(input: {
  metadata: string | null;
}): boolean {
  const metadata = normalizeOptionalText(input.metadata);
  if (!metadata) {
    return false;
  }
  try {
    const parsed = JSON.parse(metadata) as { personal?: unknown };
    return parsed.personal === true || parsed.personal === 1;
  } catch {
    return false;
  }
}

function buildCenterAgentDirectMessageWelcomeText(input: {
  firstName: string | null;
  organizationKind: "organization" | "personal";
  organizationName: string;
}): string {
  const greeting = input.firstName ? `Hi ${input.firstName} — ` : "";
  if (input.organizationKind === "personal") {
    return `👋 ${greeting}I'm your Center Agent. Pick a starting point below, or tell me what you'd like to get done.`;
  }
  return `👋 ${greeting}I'm the Center Agent for ${input.organizationName}. Pick a starting point below, or tell me what you'd like to get done.`;
}

function resolveFriendlyFirstName(value: unknown): string | null {
  const displayName = normalizeOptionalText(value);
  if (!displayName) {
    return null;
  }
  const firstSegment =
    displayName.split(friendlyNameWhitespacePattern)[0] ?? "";
  const emailLocalPart = normalizeEmailLocalPart(firstSegment);
  const friendlyName = normalizeOptionalText(emailLocalPart ?? firstSegment);
  if (!(friendlyName && friendlyNameTextPattern.test(friendlyName))) {
    return null;
  }
  return friendlyName;
}

async function readCurrentMemberCenterAgentDirectMessageSpaceProjection(input: {
  activeOrganization: ActiveOrganization;
  context: CoreRpcContextInput;
  env: CoreBindings;
}): Promise<CenterAgentDirectMessageSpaceProjection | null> {
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
  const candidate =
    await readCenterAgentDirectMessageProjectionCandidateByPairKey({
      db: requireSpaceIndexDb(input.env),
      organizationId: input.activeOrganization.organizationId,
      pairKey,
    });
  if (!candidate) {
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
  const humanMember = requireHumanSpaceMemberFromContext({
    context,
    userId: activeOrganization.userId,
  });
  if (input.targetProfileId === humanMember.profileId) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Choose another profile to start a Direct Message.",
      code: "direct_message.self_not_allowed",
    });
  }

  const targetMember = await readResolvedOrganizationSpaceMember({
    db,
    organizationId: activeOrganization.organizationId,
    profileId: input.targetProfileId,
  });
  if (!targetMember) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "That profile is not available in this Organization.",
      code: "direct_message.target_not_found",
    });
  }

  const opened = await openDirectMessageSpaceInternal(env, {
    context,
    humanMember,
    organizationId: activeOrganization.organizationId,
    targetMember,
  });
  const response: OpenDirectMessageSpaceResponse = {
    organizationId: activeOrganization.organizationId,
    memberProfileId: humanMember.profileId,
    targetProfileId: targetMember.profileId,
    spaceId: opened.spaceId,
    created: opened.created,
  };
  const validated = openDirectMessageSpaceResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Direct Message Space response: ${validated.error.message}`
    );
  }
  return validated.data;
}

export async function rpcConvertDirectMessageToSpace(
  env: CoreBindings,
  input: ConvertDirectMessageToSpaceInput
): Promise<ConvertDirectMessageToSpaceResponse> {
  const parsed = convertDirectMessageToSpaceBodySchema.safeParse({
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
  const response = await stub.rpcConvertDirectMessageToSpace({
    context,
    members,
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

async function openDirectMessageSpaceInternal(
  env: CoreBindings,
  input: {
    context: CoreRpcContextInput;
    humanMember: ResolvedSpaceMemberProfile;
    legacySpaceId?: string;
    organizationId: string;
    targetMember: ResolvedSpaceMemberProfile;
    timing?: CenterAgentDirectMessageOpenTimingRecorder;
  }
): Promise<{ created: boolean; spaceId: string }> {
  const measureStage = async <T>(
    stage: CenterAgentDirectMessageOpenTimingStage,
    operation: () => Promise<T> | T
  ): Promise<T> =>
    input.timing
      ? await input.timing.measure(stage, operation)
      : await operation();
  const pairKey = buildDirectMessagePairKey(
    input.humanMember.profileId,
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
        targetMember: input.targetMember,
      })
    ) {
      await measureStage(
        "members_upsert",
        async () =>
          await addDirectMessageMembers(env, {
            context: input.context,
            humanMember: input.humanMember,
            spaceId: reusableCandidate.spaceId,
            targetMember: input.targetMember,
          })
      );
    }
    return { created: false, spaceId: reusableCandidate.spaceId };
  }

  const guide = buildDirectMessageSpaceGuide({
    firstName: input.humanMember.profileName,
    secondName: input.targetMember.profileName,
  });
  const name = `${input.humanMember.profileName} and ${input.targetMember.profileName}`;

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
            humanMember: input.humanMember,
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
  const spaceId = resolveDirectMessageSpaceId(env.OPENMELD_SPACES, {
    generation,
    organizationId: input.organizationId,
    pairKey,
  });
  const initialized = await measureStage(
    "meta_upsert",
    async () =>
      await initializeDirectMessageSpaceMeta(env, {
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
        humanMember: input.humanMember,
        spaceId,
        targetMember: input.targetMember,
      })
  );
  return { created: initialized.created, spaceId };
}

function hasCompleteDirectMessageMembership(input: {
  candidate: {
    activeAgentCount: number | null;
    activeHumanCount: number | null;
    activeMemberCount: number | null;
  };
  targetMember: ResolvedSpaceMemberProfile;
}): boolean {
  const expectedAgentCount = input.targetMember.profileKind === "agent" ? 1 : 0;
  const expectedHumanCount = input.targetMember.profileKind === "human" ? 2 : 1;
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
    guide: string;
    name: string;
    organizationId: string;
    pairKey: string;
    spaceId: string;
  }
): Promise<{ created: boolean; meta: SpaceMeta }> {
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  return await stub.rpcInitializeDirectMessageMeta({
    spaceId: input.spaceId,
    name: input.name,
    purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
    pairKey: input.pairKey,
    creator: toSpaceCreator(input.context),
    guide: input.guide,
    organizationId: input.organizationId,
    visibility: "private",
  });
}

async function addDirectMessageMembers(
  env: CoreBindings,
  input: {
    context: CoreRpcContextInput;
    humanMember: ResolvedSpaceMemberProfile;
    spaceId: string;
    targetMember: ResolvedSpaceMemberProfile;
  }
): Promise<void> {
  const { stub } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  await stub.rpcPostMembers({
    spaceId: input.spaceId,
    members: [input.humanMember, input.targetMember],
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
  });
}

export async function rpcGetAgentExecutionReadinessBatch(
  env: CoreBindings,
  input: GetAgentExecutionReadinessBatchInput
): Promise<GetAgentExecutionReadinessBatchResponse> {
  const request = requireAgentExecutionReadinessBatchRequest(input);
  await Promise.all(
    request.agentProfileIds.map((agentProfileId) =>
      assertAgentProfileOwnerMatchesRequest({
        agentProfileId,
        env,
        owner: request.owner,
      })
    )
  );

  const generatedAt = new Date().toISOString();
  const targetRuntime = await resolveAgentExecutionTargetRuntimeContext({
    env,
    owner: request.owner,
    targetRuntime: request.targetRuntime ?? null,
  });
  // One RuntimeTransport round trip for the whole batch instead of one per profile.
  // A null prefetch (DO busy, schema drift) falls back to per-profile lookups.
  const preloadedRoutes = await lookupRuntimeTransportRoutesBatch({
    blockForgottenDevices: true,
    env,
    ownerUserId: request.owner.id,
    profileIds: request.agentProfileIds,
  });
  const readinessItems = await Promise.all(
    request.agentProfileIds.map((profileId) =>
      resolveCoreAgentExecutionReadinessForProfile({
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
    )
  );

  return buildGetAgentExecutionReadinessBatchResponse({
    generatedAt,
    readinessItems,
  });
}

export async function rpcEnsureAgentProfilePrimaryBinding(
  env: CoreBindings,
  input: EnsureAgentProfilePrimaryBindingInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const request = requireAgentProfileBindingRequest(input);
  const body = ensureAgentProfilePrimaryBindingBodySchema.safeParse({
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

  const db = requireAgentProfileBindingDb(env);
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

  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  const previousPrimaryBinding =
    body.data.writeMode === "reconnect"
      ? await readPrimaryAgentProfileBindingRecord({
          agentProfileId: request.agentProfileId,
          db,
          owner: request.owner,
        })
      : null;
  let result: AgentProfileBindingCommandResult;
  try {
    result = await ensurePrimaryAgentProfileBinding({
      agentProfileId: request.agentProfileId,
      bindingStore: createD1AgentProfileBindingCommandStore({ db }),
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
    throwAgentProfileBindingCommandHttpError(error);
  }
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }

  await applyAcceptedBindingAuthorizationPolicies({
    activeOrganizationId: normalizeOptionalText(
      request.context.activeOrganizationId
    ),
    actorProfileId: normalizeOptionalText(
      request.context.actorContext.openMeldProfileId
    ),
    agentProfileId: request.agentProfileId,
    bindingId: result.binding.bindingId,
    db,
    nowMs: Date.now(),
    ownerUserId: request.owner.id,
    previousBindingId: previousPrimaryBinding?.bindingId ?? null,
  });

  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createD1AgentProfileBindingLookupStore({ db }),
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

export async function rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
  env: CoreBindings,
  input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const request = requireAgentProfileBindingRequest(input);
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

  const db = requireAgentProfileBindingDb(env);
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  const result =
    await updatePrimaryAgentProfileBindingAgentControllerPermissionMode({
      agentProfileId: request.agentProfileId,
      agentControllerPermissionMode: body.data.agentControllerPermissionMode,
      bindingStore: createD1AgentProfileBindingCommandStore({ db }),
      nowMs: Date.now(),
      ownerAuthorization: {
        owner: request.owner,
        status: "allowed",
      },
      profileOwnerValidation,
    });
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }

  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createD1AgentProfileBindingLookupStore({ db }),
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
  const request = requireAgentProfileBindingRequest(input);
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

  const db = requireAgentProfileBindingDb(env);
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  const result =
    await updatePrimaryAgentProfileBindingAgentControllerCollaborationMode({
      agentProfileId: request.agentProfileId,
      agentControllerCollaborationMode:
        body.data.agentControllerCollaborationMode,
      bindingStore: createD1AgentProfileBindingCommandStore({ db }),
      nowMs: Date.now(),
      ownerAuthorization: {
        owner: request.owner,
        status: "allowed",
      },
      profileOwnerValidation,
    });
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }

  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createD1AgentProfileBindingLookupStore({ db }),
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
  const request = requireAgentProfileBindingRequest(input);
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

  const db = requireAgentProfileBindingDb(env);
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  let result: AgentProfileBindingCommandResult;
  try {
    result = await updatePrimaryAgentProfileBindingModelSelection({
      agentProfileId: request.agentProfileId,
      bindingStore: createD1AgentProfileBindingCommandStore({ db }),
      modelId: body.data.modelId,
      nowMs: Date.now(),
      ownerAuthorization: {
        owner: request.owner,
        status: "allowed",
      },
      profileOwnerValidation,
      reasoningLevel: body.data.reasoningLevel,
    });
  } catch (error) {
    throwAgentProfileBindingCommandHttpError(error);
  }
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }

  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createD1AgentProfileBindingLookupStore({ db }),
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

export async function rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(
  env: CoreBindings,
  input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput
): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const request = requireAgentProfileBindingRequest(input);
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

  const db = requireAgentProfileBindingDb(env);
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: request.agentProfileId,
    authWorker: env.OPENMELD_AUTH_WORKER,
  });
  const result = await updatePrimaryAgentProfileBindingOpenCodePermission({
    agentProfileId: request.agentProfileId,
    bindingStore: createD1AgentProfileBindingCommandStore({ db }),
    nowMs: Date.now(),
    openCodePermission: body.data.openCodePermission,
    ownerAuthorization: {
      owner: request.owner,
      status: "allowed",
    },
    profileOwnerValidation,
  });
  if (result.status === "rejected") {
    return buildRejectedAgentProfileBindingResponse(result.reasonCodes);
  }

  const lookupResult = await lookupPrimaryAgentProfileBinding({
    agentProfileId: request.agentProfileId,
    owner: request.owner,
    store: createD1AgentProfileBindingLookupStore({ db }),
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
  if (normalizedText.length === 0) {
    throw new Error("text is required");
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
    authoringPolicy: input.authoringPolicy,
    ...(attachments ? { attachments } : {}),
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
  if (normalizedText.length === 0) {
    throw new Error("text is required");
  }
  const attachments = await resolvePostSignalAttachments(env, {
    attachments: input.attachments,
    context,
    spaceId,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });

  return await stub.rpcPostSignalOnceByClientMessageId({
    ...(input.agentStreamId === undefined
      ? {}
      : { agentStreamId: input.agentStreamId }),
    spaceId,
    clientMessageId: input.clientMessageId,
    profile: input.profile,
    text: normalizedText,
    authoringPolicy: input.authoringPolicy,
    ...(attachments ? { attachments } : {}),
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
    context,
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
  });
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

  const db = wakeEvidenceDb(env);
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
    db: requireSpaceIndexDb(env),
    gatewayHost,
    ownerUserId,
    scope,
    selectedProfileId,
    limit,
    includeRecentlyDeletedItems: input.includeRecentlyDeletedItems === true,
    includePurposes: input.includePurposes === true,
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

  const wakeDb = wakeEvidenceDb(env);
  if (!wakeDb) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Wake evidence store is unavailable.",
      code: "account_spaces.wake_evidence_store_unavailable",
    });
  }
  const freshAfterMs =
    generatedAtMs - REMOTE_AGENT_ACTIVE_EXECUTION_EVIDENCE_FRESHNESS_MS;
  const [executionCounts, nativeDeliveryCounts] = await Promise.all([
    countActiveRuntimeCoordinatorExecutionsBySpaceIds({
      db: wakeDb,
      freshAfterMs,
      spaceIds,
    }),
    countActiveRemoteAgentNativeDeliveriesBySpaceIds({
      db: wakeDb,
      freshAfterMs,
      spaceIds,
    }),
  ]);

  const countsBySpaceId = new Map<string, number>(executionCounts);
  for (const [spaceId, count] of nativeDeliveryCounts) {
    countsBySpaceId.set(spaceId, (countsBySpaceId.get(spaceId) ?? 0) + count);
  }

  return {
    generatedAtMs,
    items: Array.from(countsBySpaceId, ([spaceId, activeWakeCount]) => ({
      activeWakeCount,
      spaceId,
    })).sort((left, right) => left.spaceId.localeCompare(right.spaceId)),
  };
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
  const access = await requireSpaceAttachmentAccess(env, input);
  const payload = resolveSpaceAttachmentForDownloadPayloadSchema.safeParse({
    attachmentId: input.attachmentId,
    spaceId: access.spaceId,
  });
  if (!payload.success) {
    throwAttachmentNotFound();
  }

  const attachment = await readSpaceAttachmentRecord({
    attachmentId: payload.data.attachmentId,
    db: access.db,
    organizationId: access.organizationId,
    spaceId: access.spaceId,
  });
  if (!attachment) {
    throwAttachmentNotFound();
  }
  return attachment;
}

async function requireSpaceAttachmentAccess(
  env: CoreBindings,
  input: SpaceAttachmentAccessInput
): Promise<{
  db: D1Database;
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
  input: SpaceAttachmentAccessInput & { attachments: unknown }
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

  return await stub.rpcGetDispatchTrace({
    spaceId,
    dispatchId,
    ...(input.includeRemoteAgentRuntimeDiagnostics === true
      ? { includeRemoteAgentRuntimeDiagnostics: true }
      : {}),
    ...access,
  });
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
  const db = wakeEvidenceDb(env);
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
    ...(input.includeTiming === undefined
      ? {}
      : { includeTiming: input.includeTiming }),
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
    ...(parsed.data.includeTiming === undefined
      ? {}
      : { includeTiming: parsed.data.includeTiming }),
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
    ...(input.includeTiming === undefined
      ? {}
      : { includeTiming: input.includeTiming }),
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
    ...(parsed.data.includeTiming === undefined
      ? {}
      : { includeTiming: parsed.data.includeTiming }),
    ...(parsed.data.includeWakeStopEligibility === undefined
      ? {}
      : { includeWakeStopEligibility: parsed.data.includeWakeStopEligibility }),
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

export async function rpcGetSpaceMessageDetails(
  env: CoreBindings,
  input: GetSpaceMessageDetailsInput
): Promise<GetSpaceMessageDetailsResponse> {
  const parsed = getSpaceMessageDetailsInputSchema.safeParse({
    spaceId: input.spaceId,
    signalId: input.signalId,
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
  return await stub.rpcGetMessageDetails({
    spaceId,
    signalId: parsed.data.signalId,
    ...access,
  });
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
  await assertAdditionalMembersCanBeAddedToSpace({
    env,
    members: input.members,
    spaceId,
  });
  return await stub.rpcPostMembers({
    spaceId,
    members: input.members,
    ...(input.requireActorMembership === true
      ? { requireActorMembership: true }
      : {}),
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
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
    ...(input.password === undefined ? {} : { password: input.password }),
    context,
  });
}

function resolveRpcSpaceStubOrThrow(
  env: CoreBindings,
  rawSpaceId: string
): { spaceId: string; stub: SpaceRpcStub } {
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
  if (input.password !== undefined) {
    const meta = await spaceStub.rpcPatchMetaWithPasswordAtomic({
      spaceId: normalizedSpaceId,
      ...(input.name ? { name: input.name } : {}),
      ...(typeof input.purpose === "string" ? { purpose: input.purpose } : {}),
      creator,
      ...(typeof input.guide === "string" ? { guide: input.guide } : {}),
      accessMode: input.accessMode ?? "protected",
      organizationId: input.organizationId,
      password: input.password,
      visibility: input.visibility,
      context,
    });
    return {
      spaceId: normalizedSpaceId,
      meta,
    };
  }

  const meta = await spaceStub.rpcPatchMeta({
    spaceId: normalizedSpaceId,
    ...(input.name ? { name: input.name } : {}),
    ...(typeof input.purpose === "string" ? { purpose: input.purpose } : {}),
    creator,
    ...(typeof input.guide === "string" ? { guide: input.guide } : {}),
    ...(input.accessMode === undefined ? {} : { accessMode: input.accessMode }),
    initializeIfAbsent: true,
    organizationId: input.organizationId,
    visibility: input.visibility,
    context,
  });

  return {
    spaceId: normalizedSpaceId,
    meta,
  };
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
  const db = localStateDb(env);
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

function requireRuntimeReadinessDb(env: CoreBindings): D1Database {
  const db = localStateDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "runtime prepare readiness store is unavailable",
      code: "runtime.prepare_readiness.store_unavailable",
    });
  }
  return db;
}

function requireAgentProfileBindingDb(env: CoreBindings): D1Database {
  const db = localStateDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Agent Profile Binding store is unavailable",
      code: "agent_profile_binding.store_unavailable",
    });
  }
  return db;
}

function requireSpaceIndexDb(env: CoreBindings): D1Database {
  const db = localStateDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Space Index store is unavailable",
      code: "space_index.store_unavailable",
    });
  }
  return db;
}

function requireIdentityDb(env: CoreBindings): D1Database {
  const db = identityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Organization identity store is unavailable",
      code: "organization.context_unavailable",
    });
  }
  return db;
}

function requireSpaceAttachmentDb(env: CoreBindings): D1Database {
  const db = identityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "attachment_storage_failed",
      reason: "Space attachment storage is unavailable.",
      status: 503,
    });
  }
  return db;
}

function requireCenterAgentDb(env: CoreBindings): D1Database {
  const db = identityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Center Agent store is unavailable.",
      code: "center_agent.designation_store_unavailable",
    });
  }
  return db;
}

function requireAgentTaskCoordinationDb(env: CoreBindings): D1Database {
  const db = agentTaskCoordinationDb(env);
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
): { memberId: string; userId: string } | null {
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

function normalizeEmailLocalPart(value: unknown): string | null {
  const email = normalizeOptionalText(value);
  if (!email) {
    return null;
  }

  const separatorIndex = email.indexOf("@");
  const localPart =
    separatorIndex >= 0 ? email.slice(0, separatorIndex) : email;
  return normalizeOptionalText(localPart);
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
): { userId: string; deviceId: string } {
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
): { userId: string; deviceId: string } {
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
): { userId: string; deviceId: string } {
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
  ownerUserId: string;
  profileId: string;
};

type OrganizationOwnerRecord = {
  userId: string;
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
  stateDb: D1Database;
  token: RemoteAgentMessageChannelIdentityLinkTokenRecord;
}> {
  const stateDb = localStateDb(input.env);
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
      reason: `Sign in before linking ${providerLabel(
        input.provider
      )} to OpenMeld.`,
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
  options: { allowPersonalWorkspace?: boolean } = {}
): Promise<{
  actor: {
    organizationId: string;
    profileId: string;
    userId: string;
  };
  db: D1Database;
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
  const db = localStateDb(env);
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
  db?: D1Database;
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

  const owner = await readOrganizationOwnerForCenterAgentBootstrap({
    db,
    organizationId: input.activeOrganization.organizationId,
  });
  const managedProfile =
    (await readManagedCenterAgentProfileForOrganization({
      db,
      organizationId: input.activeOrganization.organizationId,
    })) ??
    (await ensureManagedCenterAgentProfileForOrganization({
      env: input.env,
      db,
      organizationId: input.activeOrganization.organizationId,
      ownerUserId: owner.userId,
      requestId:
        normalizeOptionalText(input.context?.actorContext.requestId) ?? null,
    }));

  const bindingDb = requireAgentProfileBindingDb(input.env);
  const actorProfileId =
    normalizeOptionalText(input.context?.actorContext.openMeldProfileId) ??
    managedProfile.profileId;
  await designateRemoteCenterAgentBinding({
    activeOrganization: {
      organizationId: input.activeOrganization.organizationId,
      role: "owner",
      userId: owner.userId,
    },
    actorProfileId,
    agentProfileId: managedProfile.profileId,
    bindingDb,
    env: input.env,
    owner: { id: owner.userId, kind: "owner_account" },
  });

  const result = await upsertCenterAgentDesignationRecord({
    agentProfileId: managedProfile.profileId,
    db,
    designatedBy: owner.userId,
    nowMs: Date.now(),
    organizationId: input.activeOrganization.organizationId,
  });
  return result.designation;
}

async function readOrganizationOwnerForCenterAgentBootstrap(input: {
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationOwnerRecord> {
  const row = await input.db
    .prepare(
      `
        SELECT
          user_id
        FROM members
        WHERE organization_id = ?
          AND role = 'owner'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<{ user_id: string }>();
  const userId = normalizeOptionalText(row?.user_id);
  if (!userId) {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Center Agent initialization requires an Organization owner account.",
      code: "center_agent.organization_owner_required",
    });
  }
  return { userId };
}

async function ensureManagedCenterAgentProfileForOrganization(input: {
  db: D1Database;
  env: CoreBindings;
  organizationId: string;
  ownerUserId: string;
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
          ownerUserId: input.ownerUserId,
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
      ownerUserId: input.ownerUserId,
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
      ownerUserId: input.ownerUserId,
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
      ownerUserId: input.ownerUserId,
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
      ownerUserId: input.ownerUserId,
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
  ownerUserId: string;
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
    ownerUserId: input.ownerUserId,
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
  db: D1Database;
  organizationId: string;
  profileId: string;
}): Promise<ManagedCenterAgentProfileRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          profile_id,
          owner_user_id
        FROM openmeld_profiles
        WHERE organization_id = ?
          AND profile_id = ?
          AND profile_kind = 'agent'
          AND managed_role = ?
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.profileId, CENTER_AGENT_MANAGED_ROLE)
    .first<{
      owner_user_id: string;
      profile_id: string;
    }>();
  const profileId = normalizeOptionalText(row?.profile_id);
  const ownerUserId = normalizeOptionalText(row?.owner_user_id);
  return profileId && ownerUserId ? { ownerUserId, profileId } : null;
}

async function readManagedCenterAgentProfileForOrganization(input: {
  db: D1Database;
  organizationId: string;
}): Promise<ManagedCenterAgentProfileRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          profile_id,
          owner_user_id
        FROM openmeld_profiles
        WHERE organization_id = ?
          AND profile_kind = 'agent'
          AND managed_role = ?
          AND status = 'active'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `
    )
    .bind(input.organizationId, CENTER_AGENT_MANAGED_ROLE)
    .first<{
      owner_user_id: string;
      profile_id: string;
    }>();
  const profileId = normalizeOptionalText(row?.profile_id);
  const ownerUserId = normalizeOptionalText(row?.owner_user_id);
  return profileId && ownerUserId ? { ownerUserId, profileId } : null;
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
      id: managedProfile.ownerUserId,
      kind: "owner_account",
    },
  });
  if (
    binding?.bindingState !== "enabled_primary" ||
    binding.runtimeKind !== "hosted_center_agent" ||
    binding.agentControllerRef !== HOSTED_CENTER_AGENT_CONTROLLER_REF
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
  bindingDb: D1Database;
  context?: CoreRpcContextInput;
  env: CoreBindings;
  owner: AgentProfileBindingOwner;
}): Promise<void> {
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
  const previousPrimaryBinding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.bindingDb,
    owner: input.owner,
  });
  const writeResult = await reconnectPrimaryAgentProfileBindingRecord({
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
      owner: input.owner,
      reasonCode: "center_agent.remote_agent_designation",
      runtimeKind: "hosted_center_agent",
      updatedAtMs: nowMs,
      openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
    },
  });
  if (writeResult.status === "rejected") {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Remote Agent Binding could not replace the current primary Binding.",
      code: `center_agent.${writeResult.reason}`,
    });
  }

  await copyPreviousBindingAuthorizationsForHostedCenterAgent({
    activeOrganizationId: input.activeOrganization.organizationId,
    actorProfileId,
    bindingId: writeResult.binding.bindingId,
    db: input.bindingDb,
    nowMs,
    ownerUserId: input.activeOrganization.userId,
    previousBindingId: previousPrimaryBinding?.bindingId ?? null,
  });
  const authorization = await ensureOrganizationBindingAuthorizationRecord({
    authorizedBy: input.activeOrganization.userId,
    bindingId: writeResult.binding.bindingId,
    db: input.bindingDb,
    nowMs,
    organizationId: input.activeOrganization.organizationId,
  });
  await insertCenterAgentAuditJournalEntry({
    action: "authorize_remote_center_agent_binding",
    actorProfileId,
    attribution: { actorProfileId, onBehalfOf: null },
    db: input.bindingDb,
    id: crypto.randomUUID(),
    nowMs,
    organizationId: input.activeOrganization.organizationId,
    resource: {
      id: authorization.record.id,
      type: "organization_binding_authorization",
    },
  });
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

async function copyPreviousBindingAuthorizationsForHostedCenterAgent(input: {
  activeOrganizationId: string;
  actorProfileId: string;
  bindingId: string;
  db: D1Database;
  nowMs: number;
  ownerUserId: string;
  previousBindingId: string | null;
}): Promise<void> {
  if (!input.previousBindingId || input.previousBindingId === input.bindingId) {
    return;
  }
  const previousAuthorizations =
    await listOrganizationBindingAuthorizationRecordsForBinding({
      bindingId: input.previousBindingId,
      db: input.db,
    });
  for (const previousAuthorization of previousAuthorizations) {
    if (previousAuthorization.organizationId !== input.activeOrganizationId) {
      continue;
    }
    const authorization = await ensureOrganizationBindingAuthorizationRecord({
      authorizedBy: input.ownerUserId,
      bindingId: input.bindingId,
      db: input.db,
      nowMs: input.nowMs,
      organizationId: previousAuthorization.organizationId,
    });
    await insertCenterAgentAuditJournalEntry({
      action: "carry_over_binding_authorization",
      actorProfileId: input.actorProfileId,
      attribution: { actorProfileId: input.actorProfileId, onBehalfOf: null },
      db: input.db,
      id: crypto.randomUUID(),
      nowMs: input.nowMs,
      organizationId: previousAuthorization.organizationId,
      resource: {
        id: authorization.record.id,
        type: "organization_binding_authorization",
      },
    });
  }
}

async function assertSelfHostedDesignatableCenterAgentProfile(input: {
  activeOrganization: ActiveOrganization;
  agentProfileId: string;
  bindingDb: D1Database;
  owner: AgentProfileBindingOwner;
}): Promise<void> {
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
        "Center Agent designation requires the managed Center Agent profile for this Organization.",
      code: "center_agent.profile_org_mismatch",
    });
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.bindingDb,
    owner: input.owner,
  });
  if (binding?.bindingState !== "enabled_primary") {
    throw createCoreRpcHttpError({
      status: 409,
      reason:
        "Designating a self-hosted Center Agent requires your enabled primary Binding.",
      code: "center_agent.profile_binding_required",
    });
  }
}

async function requireActiveOrganizationMembershipOrThrow(input: {
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

function requireConnectorConnectionDb(env: CoreBindings): D1Database {
  const db = identityDb(env);
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
  db: D1Database;
  nowMs: number;
  organizationId: string;
}): D1PreparedStatement {
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
  return input.db
    .prepare(
      `
        INSERT INTO center_agent_audit_journal (
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
        SELECT ?, ?, ?, ?, NULL, NULL, NULL, 'app_connection', ?, ?
        WHERE changes() = 1
      `
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      actorProfileId,
      input.action,
      input.connectionName,
      input.nowMs
    );
}

async function listVisibleConnectorConnections(input: {
  activeOrganization: ActiveOrganization;
  db: D1Database;
  env: CoreBindings;
  service: ConnectorService;
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

  const db = identityDb(input.env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Organization context could not be verified.",
      code: "organization.context_unavailable",
    });
  }

  const membership = await db
    .prepare(
      `
        SELECT role
        FROM members
        WHERE organization_id = ?
          AND user_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, userId)
    .first<{ role: string }>();
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

function requireHumanSpaceMemberFromContext(input: {
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

function requireAgentExecutionReadinessRequest(input: {
  agentProfileId: string;
  context?: CoreRpcContextInput;
}): {
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
): {
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
    agentProfileIds: parsedBody.data.agentProfileIds,
    context,
    owner: {
      id: ownerUserId,
      kind: "owner_account",
    },
    targetRuntime: parsedBody.data.targetRuntime ?? null,
  };
}

async function resolveAgentExecutionTargetRuntimeContext(input: {
  env: CoreBindings;
  owner: AgentProfileBindingOwner;
  targetRuntime: AgentExecutionReadinessTargetRuntime | null;
}): Promise<AgentExecutionTargetRuntimeContext | null> {
  const db = localStateDb(input.env);
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
}): Promise<void> {
  const profileOwnerValidation = await resolveProfileOwnerValidationEvidence({
    agentProfileId: input.agentProfileId,
    authWorker: input.env.OPENMELD_AUTH_WORKER,
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

function requireRpcContext(context?: CoreRpcContextInput): CoreRpcContextInput {
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

function requireAuthenticatedOwnerUserId(
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
  openMeldServiceRuntimeId: { source: string; value: string };
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
  db: D1Database;
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

function buildAuthorizeAgentProfileBindingForOrganizationResponse(input: {
  agentProfileId: string;
  authorization: Awaited<
    ReturnType<typeof ensureOrganizationBindingAuthorizationRecord>
  >;
}): AuthorizeAgentProfileBindingForOrganizationResponse {
  const response = {
    agentProfileId: input.agentProfileId,
    authorizedBy: input.authorization.record.authorizedBy,
    bindingId: input.authorization.record.bindingId,
    createdAt: toIsoDateTime(input.authorization.record.createdAtMs),
    organizationId: input.authorization.record.organizationId,
    status: input.authorization.status,
  };
  const validated =
    authorizeAgentProfileBindingForOrganizationResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Binding authorization response: ${validated.error.message}`
    );
  }
  return validated.data;
}

function buildBulkAuthorizeAgentProfileBindingsForOrganizationResponse(input: {
  authorizations: BulkAuthorizeAgentProfileBindingsForOrganizationResponse["authorizations"];
  organizationId: string;
}): BulkAuthorizeAgentProfileBindingsForOrganizationResponse {
  const response = {
    alreadyAuthorizedCount: input.authorizations.filter(
      (authorization) => authorization.status === "already_authorized"
    ).length,
    authorizedCount: input.authorizations.filter(
      (authorization) => authorization.status === "authorized"
    ).length,
    authorizations: input.authorizations,
    organizationId: input.organizationId,
  };
  const validated =
    bulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build bulk Organization Binding authorization response: ${validated.error.message}`
    );
  }
  return validated.data;
}

function buildRevokeAgentProfileBindingForOrganizationResponse(input: {
  agentProfileId: string;
  bindingId: string | null;
  organizationId: string;
  revoked: boolean;
}): RevokeAgentProfileBindingForOrganizationResponse {
  const response = {
    agentProfileId: input.agentProfileId,
    bindingId: input.bindingId,
    organizationId: input.organizationId,
    revoked: input.revoked,
    status: input.revoked ? "revoked" : "missing",
  };
  const validated =
    revokeAgentProfileBindingForOrganizationResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Binding authorization revoke response: ${validated.error.message}`
    );
  }
  return validated.data;
}

function buildOrganizationBindingAuthorizationPreferenceResponse(input: {
  autoAuthorizeAgentProfileBindings: boolean;
  organizationId: string;
  updatedAtMs: number | null;
  userId: string;
}): GetOrganizationBindingAuthorizationPreferenceResponse {
  const response = {
    autoAuthorizeAgentProfileBindings: input.autoAuthorizeAgentProfileBindings,
    organizationId: input.organizationId,
    updatedAt:
      input.updatedAtMs === null ? null : toIsoDateTime(input.updatedAtMs),
    userId: input.userId,
  };
  const validated =
    getOrganizationBindingAuthorizationPreferenceResponseSchema.safeParse(
      response
    );
  if (!validated.success) {
    throw new Error(
      `failed to build Organization Binding authorization preference response: ${validated.error.message}`
    );
  }

  const setValidated =
    setOrganizationBindingAuthorizationPreferenceResponseSchema.safeParse(
      validated.data
    );
  if (!setValidated.success) {
    throw new Error(
      `failed to build Organization Binding authorization preference set response: ${setValidated.error.message}`
    );
  }
  return validated.data;
}

function buildGetAgentExecutionReadinessResponse(input: {
  generatedAt: string;
  readiness: CoreAgentExecutionReadiness;
}): GetAgentExecutionReadinessResponse {
  const response = {
    agentExecutionReadiness: input.readiness.agentExecutionReadiness,
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

function resolveHttpAgentWakeAvailability(
  readiness: CoreAgentExecutionReadiness
): GetAgentExecutionReadinessResponse["agentWakeAvailability"] {
  if (readiness.agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
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

function buildGetAgentExecutionReadinessBatchResponse(input: {
  generatedAt: string;
  readinessItems: readonly CoreAgentExecutionReadiness[];
}): GetAgentExecutionReadinessBatchResponse {
  const response = {
    items: input.readinessItems.map((readiness) =>
      buildGetAgentExecutionReadinessResponse({
        generatedAt: input.generatedAt,
        readiness,
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
  result: Extract<AgentProfileBindingCommandResult, { status: "accepted" }>;
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
    result = await input.authWorker.resolveProfileById({
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
