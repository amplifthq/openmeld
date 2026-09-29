// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes stable public entrypoints.

export {
  type AccountInvalidationFrame,
  accountInvalidationFrameSchema,
} from "./account-invalidation";
export {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  type AccountOrganizationContext,
  accountOrganizationContextSchema,
  type OrganizationSummary,
  organizationSummarySchema,
} from "./account-organization-context";
export {
  ACCOUNT_SESSION_PATH,
  type AccountSession,
  accountSessionSchema,
} from "./account-session";
export {
  AGENT_CONTEXT_ENVELOPE_VERSION,
  AGENT_CONTEXT_PROGRESSIVE_POLICY_VERSION,
  type AgentContextEnvelope,
  agentContextEnvelopeSchema,
  renderAgentContextEnvelope,
} from "./agent-context-envelope";
export type {
  BuiltinAgentControllerBrand,
  BuiltinAgentControllerBrandId,
} from "./agent-controller-brand";
export {
  BUILTIN_AGENT_CONTROLLER_BRAND_IDS,
  BUILTIN_AGENT_CONTROLLER_BRANDS,
  BUILTIN_AGENT_CONTROLLER_DISPLAY_ORDER,
  compareAgentControllerRefsForDisplay,
  isBuiltinAgentControllerBrandId,
  resolveBuiltinAgentControllerBrand,
} from "./agent-controller-brand";
export {
  AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
  AGENT_EXECUTION_READINESS_IMPACT_EFFECTS,
  AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
  AGENT_EXECUTION_READINESS_IMPACT_KINDS,
  AGENT_EXECUTION_READINESS_IMPACT_REASON_CODE_ALIASES,
  AGENT_EXECUTION_READINESS_IMPACT_REASON_CODES,
  AGENT_EXECUTION_READINESS_IMPACT_SCOPES,
  AGENT_EXECUTION_READINESS_IMPACT_SOURCES,
  AGENT_EXECUTION_READINESS_IMPACT_TAXONOMY,
  type AgentExecutionReadinessImpactClearingTrigger,
  type AgentExecutionReadinessImpactEffect,
  type AgentExecutionReadinessImpactKind,
  type AgentExecutionReadinessImpactReasonCode,
  type AgentExecutionReadinessImpactReasonCodeAlias,
  type AgentExecutionReadinessImpactScope,
  type AgentExecutionReadinessImpactSource,
  type AgentExecutionReadinessImpactTaxonomyEntry,
  agentExecutionReadinessImpactClearingTriggerSchema,
  agentExecutionReadinessImpactEffectSchema,
  agentExecutionReadinessImpactKindSchema,
  agentExecutionReadinessImpactReasonCodeSchema,
  agentExecutionReadinessImpactScopeSchema,
  agentExecutionReadinessImpactSourceSchema,
  isAgentExecutionReadinessImpactReasonCode,
  isKnownFinalFailureReasonCodeWithoutReadinessImpact,
  KNOWN_FINAL_FAILURE_REASON_CODES_WITHOUT_READINESS_IMPACT,
  type KnownFinalFailureReasonCodeWithoutReadinessImpact,
  resolveAgentExecutionReadinessImpactReasonCode,
  resolveAgentExecutionReadinessImpactTaxonomyEntry,
} from "./agent-execution-readiness-impact-taxonomy";
export {
  type AgentRecoveryActionId,
  agentRecoveryActionLabels,
  formatAgentRecoveryActionLabel,
} from "./agent-recovery-action";
export {
  isAgentWorkActivityPresentable,
  isLegacyAgentActivityWorkCompatible,
  resolveCommandAgentWorkActivity,
} from "./agent-work-activity";
export {
  CENTER_AGENT_ACCOUNT_CONNECTION_REQUIRED_PUBLIC_COPY,
  resolveCenterAgentCompletedCallbackMessage,
} from "./center-agent-publication-copy";
export {
  CLI_RELEASE_PATH,
  type CliRelease,
  cliReleaseSchema,
} from "./cli-release";
export {
  type ClientEnvironmentResponse,
  clientEnvironmentResponseSchema,
} from "./client-environment";
export {
  toCompatibleSpaceAddressingRequestWireValue,
  toLegacySpaceAddressingWireValue,
} from "./compatibility/legacy-space-addressing-wire";
export { toLegacySpaceFilesOriginWireValue } from "./compatibility/legacy-space-files-origin-wire";
export { toLegacySpaceImageGeometryWireValue } from "./compatibility/legacy-space-image-geometry-wire";
export { toSpaceSignalReadWireValue } from "./compatibility/space-signal-read-wire";
export {
  type ComputerConnectionIntent,
  type ComputerSetupOutput,
  computerConnectionIntentSchema,
  computerConnectionReviewSchema,
  computerSetupOutputSchema,
  type DesktopComputerConnectionOperation,
  type DesktopComputerConnectionProgress,
  type DesktopComputerConnectionRequest,
  type DesktopComputerConnectionResult,
  type DesktopComputerDisconnectOperation,
  type DesktopComputerDisconnectPhase,
  type DesktopComputerDisconnectRequest,
  type DesktopComputerDisconnectResult,
  type DesktopComputerOperation,
  desktopComputerConnectionOperationSchema,
  desktopComputerConnectionProgressSchema,
  desktopComputerConnectionRequestSchema,
  desktopComputerConnectionResultSchema,
  desktopComputerDisconnectOperationSchema,
  desktopComputerDisconnectPhaseSchema,
  desktopComputerDisconnectRequestSchema,
  desktopComputerDisconnectResultSchema,
  desktopComputerOperationSchema,
} from "./computer-connection";
export {
  type ComputerConnectionProgressObservation,
  type ComputerConnectionProgressPhase,
  computerConnectionProgressMeasurementSchema,
  computerConnectionProgressObservationSchema,
  computerConnectionProgressPhaseSchema,
} from "./computer-connection-progress";
export {
  DESKTOP_AUTH_SCHEME,
  DESKTOP_INSTALLED_AUTH_SCHEME,
  DESKTOP_TEST_AUTH_SCHEME,
  desktopAuthIdentity,
} from "./desktop-auth-identity";
export {
  DESKTOP_APP_ORIGIN,
  DESKTOP_COMPATIBILITY_PATH,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopAccountStreamBridge,
  type DesktopAccountStreamEvent,
  type DesktopAccountStreamInput,
  type DesktopInstalledTarget,
  type DesktopLocalComputer,
  type DesktopPlatform,
  type DesktopSession,
  type DesktopSpaceStreamBridge,
  type DesktopSpaceStreamEvent,
  type DesktopSpaceStreamInput,
  desktopAccountStreamInputSchema,
  desktopCompatibilitySchema,
  desktopInstalledTargetSchema,
  desktopLocalComputerSchema,
  desktopPlatformSchema,
  desktopProductionSourceSchema,
  desktopSessionSchema,
  desktopSpaceStreamEventSchema,
  desktopSpaceStreamIdSchema,
  desktopSpaceStreamInputSchema,
  desktopWebBuildSchema,
} from "./desktop-client";
export * from "./desktop-development";
export * from "./desktop-notifications";
export {
  DESKTOP_PROMOTED_RELEASE_KEY,
  DESKTOP_UPDATE_FEED_URL,
  DESKTOP_WINDOWS_INTERNAL_PREVIEW_KEY,
  type DesktopCandidateManifest,
  type DesktopReleasePlatform,
  desktopCandidateIdSchema,
  desktopCandidateLocation,
  desktopCandidateManifestKey,
  desktopCandidateManifestSchema,
  desktopCandidateUpdateArtifact,
  desktopPlatformUpdateFeedUrl,
  desktopPromotedReleaseKey,
  desktopPromotedReleaseSchema,
  desktopReleasePlatformSchema,
  desktopUpdaterFeedSchema,
  desktopUpdaterFeedSchemaForPlatform,
  desktopWindowsBuildSchema,
  desktopWindowsInternalPreviewLocation,
  desktopWindowsInternalPreviewSchema,
  resolveDesktopReleasePlatform,
} from "./desktop-release";
export * from "./desktop-transport-diagnostics";
export * from "./desktop-updater";
export {
  buildOpenMeldNavigationAction,
  buildOpenMeldOrganizationWebUrl,
  buildOrganizationPluginPath,
  buildOrganizationPluginsPath,
  buildOrganizationRootPath,
  buildOrganizationSpacePath,
  buildSlackIdentityLinkNavigationAction,
  type NavigationAction,
  navigationActionSchema,
  type OpenMeldNavigationTarget,
  openMeldNavigationTargetSchema,
  openMeldWebUrlSchema,
} from "./navigation-action";
export {
  OFFICIAL_CLI_SKILL_CONTRACT,
  OFFICIAL_CLI_SKILL_MAX_BYTES,
  OFFICIAL_CLI_SKILL_PUBLIC_KEY,
  OFFICIAL_CLI_SKILL_URL,
  type OfficialCliSkillPayload,
  type OfficialCliSkillRelease,
  officialCliSkillChannelSchema,
  officialCliSkillPayloadSchema,
  officialCliSkillReleaseSchema,
} from "./official-cli-skill";
export * from "./organization-actions";
export {
  type OrganizationJoinRequest,
  type OrganizationJoinRequestInput,
  type OrganizationJoinRequestResponse,
  type OrganizationJoinRequestRpcInput,
  organizationJoinRequestInputSchema,
  organizationJoinRequestResponseForVersion,
  organizationJoinRequestResponseSchema,
  organizationJoinRequestRpcInputSchema,
  organizationJoinRequestSchema,
} from "./organization-join-request";
export { normalizeOrganizationList } from "./organization-list";
export { ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE } from "./organization-request-context";
export {
  appendPluginConnectionReplyLink,
  readPluginConnectionReplyLink,
} from "./plugin-connection-reply";
export {
  buildHostedAgentRequestFailedPublicCopy,
  CENTER_AGENT_CONTEXT_WINDOW_EXCEEDED_PUBLIC_COPY,
  CENTER_AGENT_EMPTY_REPLY_PUBLIC_COPY,
  CENTER_AGENT_EXECUTION_IDENTITY_MISMATCH_PUBLIC_COPY,
  CENTER_AGENT_ORGANIZATION_UNAVAILABLE_PUBLIC_COPY,
  CENTER_AGENT_OUTPUT_LIMIT_EXCEEDED_PUBLIC_COPY,
  CENTER_AGENT_REPLY_PUBLICATION_FAILED_PUBLIC_COPY,
  CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY,
  CENTER_AGENT_REQUEST_START_FAILED_PUBLIC_COPY,
  CENTER_AGENT_REQUEST_STOPPED_PUBLIC_COPY,
  CENTER_AGENT_SOURCE_MESSAGE_MISSING_PUBLIC_COPY,
  CENTER_AGENT_TEMPORARILY_UNAVAILABLE_PUBLIC_COPY,
  CODEX_UPGRADE_REQUIRED_REASON,
  DISPATCH_ERROR_SUMMARY_MAX_LENGTH,
  isProjectLocalConnectionFailureReasonCode,
  ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_PUBLIC_COPY,
  ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_REASON_CODE,
  PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES,
  type ProjectLocalConnectionFailureReasonCode,
  type PublicAgentAvailabilityCopy,
  type PublicAgentAvailabilityCopyContext,
  type PublicAgentFailureRecovery,
  type PublicAgentFailureRecoveryKind,
  type PublicAgentFailureRecoveryTarget,
  projectLocalConnectionFailureReasonCodeSchema,
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE,
  REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY,
  REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE,
  REMOTE_AGENT_TOOL_SAFETY_LIMIT_PUBLIC_COPY,
  REMOTE_AGENT_TOOL_SAFETY_LIMIT_REASON_CODE,
  REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_PUBLIC_COPY,
  REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE,
  resolveCenterAgentCallbackFailureMessage,
  resolveMappedPublicAgentFailureReason,
  resolvePublicAgentAvailabilityCopy,
  resolvePublicAgentFailureRecovery,
  resolvePublicFailureCodeCategory,
  sanitizeDispatchErrorSummary,
  shouldPreferMappedPublicAgentFailureReason,
} from "./public-agent-failure-reason";
export {
  RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE,
  RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE,
} from "./runtime-coordinator-reason-code";
export {
  type AccountSidebarPreferences,
  type AccountSidebarSnapshot,
  accountSidebarErrorResponseSchema,
  accountSidebarPreferencesSchema,
  accountSidebarResponseSchema,
  accountSidebarSnapshotSchema,
  type PeopleSidebarPreferences,
  peopleSidebarPreferencesSchema,
  saveAccountSidebarBodySchema,
  sidebarSortSchema,
} from "./schemas/account-sidebar";
export {
  type PluginChannelContinueResponse,
  type PluginChannelDeliveryMetadata,
  type PluginChannelRequestPreview,
  type PluginChannelSelection,
  type PluginChannelSourceProof,
  pluginChannelContinueBodySchema,
  pluginChannelContinueResponseSchema,
  pluginChannelContinueRpcInputSchema,
  pluginChannelDeliveryMetadataSchema,
  pluginChannelRequestBodySchema,
  pluginChannelRequestPreviewSchema,
  pluginChannelRequestRpcInputSchema,
  pluginChannelSelectionSchema,
  pluginChannelSourceProofSchema,
} from "./schemas/http/plugin-channel-continuation";
export {
  type PluginConnectionContinuationBinding,
  type PluginConnectionContinuationBody,
  type PluginConnectionContinuationResponse,
  type PluginConnectionLocalSourceRequest,
  pluginConnectionContinuationBindingSchema,
  pluginConnectionContinuationBodySchema,
  pluginConnectionContinuationResponseSchema,
  pluginConnectionContinuationRpcInputSchema,
  pluginConnectionLocalSourceRequestSchema,
  pluginConnectionLocalSourceResponseSchema,
  type ReadPluginConnectionContinuationBindingRequest,
  readPluginConnectionContinuationBindingRequestSchema,
  readPluginConnectionContinuationBindingResponseSchema,
} from "./schemas/http/plugin-connection-continuation";
export type {
  GetSpaceLinkPreviewsResponse,
  LinkPreview,
  SpaceMessageLinks,
} from "./schemas/http/space-link-previews";
export {
  getSpaceLinkPreviewsInputSchema,
  getSpaceLinkPreviewsResponseSchema,
  linkPreviewSchema,
  MAX_MESSAGE_LINK_PREVIEWS,
  spaceMessageLinksSchema,
} from "./schemas/http/space-link-previews";
export {
  SPACE_MESSAGE_CHANGED_PURPOSE,
  spaceMessageMutationBodySchema,
  spaceMessageMutationResponseSchema,
} from "./schemas/http/space-message-mutation";
export type {
  MessageSearchResponse,
  MessageSearchRpcInput,
} from "./schemas/http/space-message-search";
export {
  messageSearchCursorSchema,
  messageSearchQuerySchema,
  messageSearchResponseSchema,
  messageSearchRpcInputSchema,
  spaceMessageSearchQuerySchema,
  spaceMessageSearchResponseSchema,
} from "./schemas/http/space-message-search";
export * from "./schemas/index";
export { agentControllerSessionTitleSchema } from "./schemas/runtime/agent-controller-session";
export {
  type RemoteAgentExecutionAccessRequest,
  type RemoteAgentExecutionAccessResponse,
  type RemoteAgentExecutionScope,
  remoteAgentExecutionAccessRequestSchema,
  remoteAgentExecutionAccessResponseSchema,
  remoteAgentExecutionScopeKey,
  remoteAgentExecutionScopeSchema,
  resolveRemoteAgentExecutionScope,
} from "./schemas/runtime/remote-agent-execution-access";
export {
  REMOTE_AGENT_GIT_BATCH_SIZE,
  REMOTE_AGENT_GIT_MAX_BLOB_BYTES,
  REMOTE_AGENT_GIT_MAX_FILES,
  REMOTE_AGENT_GIT_MAX_TOTAL_BYTES,
  REMOTE_AGENT_GIT_MAX_TREE_BYTES,
  REMOTE_AGENT_GIT_TTL_MS,
  type RemoteAgentGitCheckoutInput,
  type RemoteAgentGitNativeResult,
  type RemoteAgentGitPublishInput,
  type RemoteAgentGitTreeEntry,
  remoteAgentGitBlobSchema,
  remoteAgentGitCheckoutInputSchema,
  remoteAgentGitCommitSchema,
  remoteAgentGitKeySchema,
  remoteAgentGitNativeRequestSchema,
  remoteAgentGitNativeResultSchema,
  remoteAgentGitPublishInputSchema,
  remoteAgentGitRefSchema,
  remoteAgentGitRepositorySchema,
  remoteAgentGitShaSchema,
  remoteAgentGitTreeEntrySchema,
  remoteAgentGitTreeSchema,
} from "./schemas/runtime/remote-agent-git";
export {
  REMOTE_AGENT_RETAINED_RESULT_MAX_BYTES,
  REMOTE_AGENT_RETAINED_RESULT_MAX_PER_EXECUTION,
  REMOTE_AGENT_RETAINED_RESULT_READ_MAX_CHARS,
  REMOTE_AGENT_RETAINED_RESULT_TTL_MS,
  type RemoteAgentResultSource,
  remoteAgentReadToolResultRequestSchema,
  remoteAgentReadToolResultResponseSchema,
  remoteAgentResultSourceSchema,
  remoteAgentResultSourcesSchema,
} from "./schemas/runtime/remote-agent-retained-result";
export {
  SERVICE_ACCOUNT_STOP_REFUSED_CODE,
  type ServiceAccountAdmission,
  type ServiceAccountAdmissionIdentity,
  type ServiceAccountControlRequest,
  serviceAccountAdmissionIdentitySchema,
  serviceAccountAdmissionSchema,
  serviceAccountControlRequestSchema,
  serviceControlCapabilitiesSchema,
  serviceControlCarrierCapabilitySchema,
} from "./service-account-admission";
export {
  type ProfileWorkingFolderFact,
  profileWorkingFolderFactSchema,
  SERVICE_EXECUTION_HOST_MAX_FRAME_BYTES,
  SERVICE_EXECUTION_HOST_MAX_PENDING_REQUESTS,
  SERVICE_EXECUTION_HOST_PROTOCOL,
  type ServiceExecutionHostArguments,
  type ServiceExecutionHostCatalog,
  type ServiceExecutionHostIdentity,
  type ServiceExecutionHostInput,
  type ServiceExecutionHostMessage,
  type ServiceExecutionHostMethod,
  type ServiceExecutionHostOutput,
  type ServiceExecutionHostRoute,
  type ServiceExecutionHostSnapshot,
  serviceExecutionHostCatalogSchema,
  serviceExecutionHostIdentitySchema,
  serviceExecutionHostMessageSchema,
  serviceExecutionHostMethods,
  serviceExecutionHostOwnerSchema,
  serviceExecutionHostRequestSchema,
  serviceExecutionHostRouteSchema,
  serviceExecutionHostSnapshotSchema,
} from "./service-execution-host";
export {
  projectLegacySpaceAccessView,
  projectSpaceAccessViewForVersion,
  SPACE_ACCESS_VERSION,
  SPACE_ACCESS_VERSION_HEADER,
} from "./space-access-version";
export {
  ORGANIZATION_INVITATION_LIFETIME_SECONDS,
  type SpaceInvitation,
  type SpaceInvitationAccessInput,
  type SpaceInvitationGrantInput,
  type SpaceInvitationRequest,
  type SpaceInvitationResponse,
  type SpaceInvitationRevokeInput,
  type SpaceInvitationRpcInput,
  type SpaceInvitationRpcResult,
  type SpaceInvitationWorker,
  spaceInvitationAccessInputSchema,
  spaceInvitationGrantInputSchema,
  spaceInvitationRequestSchema,
  spaceInvitationResponseSchema,
  spaceInvitationRevokeInputSchema,
  spaceInvitationRpcInputSchema,
  spaceInvitationRpcResultSchema,
  spaceInvitationSchema,
} from "./space-invitation";
export {
  type SpaceOwnerDepartureInput,
  type SpaceOwnerDepartureResult,
  type SpaceOwnerDepartureSpaceInput,
  type SpaceOwnerDepartureWorker,
  spaceOwnerDepartureInputSchema,
  spaceOwnerDepartureResultSchema,
  spaceOwnerDepartureSpaceInputSchema,
} from "./space-owner-departure";
export {
  SPACE_WORK_HANDOFF_CAPABILITY_HEADER,
  SPACE_WORK_MAX_BYTES,
  type SpaceWorkHandoff,
  type SpaceWorkingCopyAccess,
  type SpaceWorkSelection,
  spaceWorkHandoffSchema,
  spaceWorkingCopyAccessSchema,
  spaceWorkingCopyResultSchema,
  spaceWorkRelativePathSchema,
  spaceWorkSelectionSchema,
} from "./space-work-handoff";
export type * from "./types/index";
export {
  WEB_APPLICATION_ERROR_MAX_BYTES,
  WEB_APPLICATION_ERROR_PATH,
  WEB_APPLICATION_REACT_UPDATE_TRACE_MAX_EVENTS,
  type WebApplicationErrorBoundary,
  type WebApplicationErrorQueryCategory,
  type WebApplicationErrorQueryDiagnostic,
  type WebApplicationErrorReport,
  type WebApplicationErrorSource,
  type WebApplicationReactUpdateEvent,
  webApplicationErrorBoundarySchema,
  webApplicationErrorQueryCategorySchema,
  webApplicationErrorQueryCodeSchema,
  webApplicationErrorQueryDiagnosticSchema,
  webApplicationErrorReportSchema,
  webApplicationErrorRouteIdSchema,
  webApplicationErrorSourceSchema,
  webApplicationErrorSummarySchema,
  webApplicationReactUpdateEventSchema,
} from "./web-application-error";
export {
  WEB_PERFORMANCE_PATH,
  type WebPerformancePolicy,
  type WebPerformanceReport,
  webPerformancePolicySchema,
  webPerformanceReportSchema,
} from "./web-performance";
export * from "./windows-artifact";
export {
  buildWorkingFolderRecoveryQuestion,
  isWorkingFolderRecoveryDecline,
  isWorkingFolderRecoveryQuestion,
  resolveLocalExecutionOwnerCancellationReason,
  WORKING_FOLDER_RECOVERY_DECLINED,
  WORKING_FOLDER_RECOVERY_QUESTION_ID,
} from "./working-folder-recovery";
