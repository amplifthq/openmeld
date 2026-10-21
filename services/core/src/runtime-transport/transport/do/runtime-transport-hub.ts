import { DurableObject } from "cloudflare:workers";
import {
  hasRuntimeAdapterCapabilityForRef,
  parseAgentControllerRef,
  resolveWakeStopEligibility,
  supportsLocalExecutionInput,
} from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import {
  DAEMON_STREAM_KEEPALIVE_PING,
  DAEMON_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import {
  AGENT_INTERACTION_DEFAULT_TIMEOUT_MS,
  AGENT_REPLY_PREVIEW_END_PURPOSE,
  AGENT_REPLY_PREVIEW_PURPOSE,
  agentInteractionResolutionSchema,
  agentProfileExecutionModeResponseSchema,
  agentTaskObservationRedriveQueueMessageSchema,
  buildRuntimeCoordinatorExecutionId,
  buildRuntimeCoordinatorFinalizationCommandId,
  COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  COMPUTER_POWER_CAPABILITY_HEADER,
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
  computerFileAccessDaemonFrameSchema,
  computerFileAccessPolicyResultSchema,
  computerPowerResultFrameSchema,
  computerPowerResultSchema,
  computerPowerTransportSchema,
  daemonStreamFrameSchema,
  LOCAL_EXECUTION_INPUT_CAPABILITY_HEADER,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  localAgentReasoningPreferencesSchema,
  localExecutionInputBindingSchema,
  localExecutionInputOperationSchema,
  localExecutionInputResolveSchema,
  localExecutionInputResponseSchema,
  localExecutionInputResultFrameSchema,
  localFolderPickerDaemonFrameSchema,
  localFolderPickerResultSchema,
  localProjectControlConnectResultSchema,
  localProjectControlDaemonFrameSchema,
  localProjectControlDiscoverProjectsResultSchema,
  localProjectControlRemoveConnectionResultSchema,
  localProjectControlRemoveMissingConnectionsResultSchema,
  localProjectControlSetDefaultConnectionResultSchema,
  OPENMELD_ADMISSION_EVIDENCE_HEADER,
  OPENMELD_COMPUTER_CARE_HEADER,
  OPENMELD_DAEMON_CANCEL_WITHDRAWN_BEFORE_START_REASON_CODE,
  OPENMELD_EXECUTION_ADMISSION_HEADER,
  OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
  OPENMELD_REASONING_STREAM_HEADER,
  OPENMELD_RUNTIME_CAPABILITIES_HEADER,
  openMeldDaemonManageLocalAgentInstallationPayloadSchema,
  openMeldDaemonManageProfileFoldersPayloadSchema,
  openMeldDaemonReadProfileWorkspacePayloadSchema,
  openMeldToolsControlResultSchema,
  type PluginConnectionExecutionSourceRequest,
  pluginConnectionExecutionSourceRequestSchema,
  pluginConnectionExecutionSourceResponseSchema,
  postSpaceDispatchOutboxRedriveBodySchema,
  postSpaceDispatchOutboxRedriveResponseSchema,
  projectTargetWakeLifecycleIdentity,
  RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE,
  RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
  RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE,
  RUNTIME_COORDINATOR_TOKEN_DIAGNOSTIC_MODEL_VERSION,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  resolveLocalExecutionOwnerCancellationReason,
  runtimeCoordinatorFailurePublicationOutcomeSchema,
  runtimeCoordinatorFinalizationClaimReadSchema,
  runtimeCoordinatorFinalizationCommandSchema,
  runtimeCoordinatorFinalizationOutcomeSchema,
  runtimeTransportAgentProfileExecutionModeRequestSchema,
  runtimeTransportAgentProfileExecutionStateRequestSchema,
  runtimeTransportAgentProfileExecutionStateResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationRequestSchema,
  runtimeTransportAgentProfileLegacyConversationMutationRequestSchema,
  runtimeTransportAgentProfileOperationalContextsRequestSchema,
  runtimeTransportAgentProfileOperationalContextsResponseSchema,
  runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema,
  runtimeTransportAgentProfileWorkContinuationAuthorizeResponseSchema,
  runtimeTransportAgentProfileWorkContinuationNeedsAttentionRequestSchema,
  runtimeTransportAgentProfileWorkContinuationNeedsAttentionResponseSchema,
  runtimeTransportAgentProfileWorkHandoffRequestSchema,
  runtimeTransportAgentProfileWorkHandoffResponseSchema,
  runtimeTransportAgentProfileWorkLocalAttemptWithdrawalRequestSchema,
  runtimeTransportAgentProfileWorkLocalAttemptWithdrawalResponseSchema,
  runtimeTransportAgentProfileWorkQueueApproveRequestSchema,
  runtimeTransportAgentProfileWorkQueueApproveResponseSchema,
  runtimeTransportAgentProfileWorkRecoveryReadRequestSchema,
  runtimeTransportAgentProfileWorkRecoveryReadResponseSchema,
  runtimeTransportAgentProfileWorkSkipRequestSchema,
  runtimeTransportAgentProfileWorkSkipResponseSchema,
  runtimeTransportAgentProfileWorkUsageAvailableRequestSchema,
  runtimeTransportAgentProfileWorkUsageAvailableResponseSchema,
  runtimeTransportComputerFileAccessReadRequestSchema,
  runtimeTransportComputerFileAccessUpdateRequestSchema,
  runtimeTransportDeletedAgentProfileWakeCancellationRequestSchema,
  runtimeTransportDeletedAgentProfileWakeCancellationResponseSchema,
  runtimeTransportDeliverDispatchRequestSchema,
  runtimeTransportDeliverDispatchResponseSchema,
  runtimeTransportDisconnectRatesResponseSchema,
  runtimeTransportDispatchInteractionDeliveredRequestSchema,
  runtimeTransportDispatchInteractionRequestSchema,
  runtimeTransportDispatchInteractionResponseFramePayloadSchema,
  runtimeTransportDispatchLifecycleAcknowledgementSchema,
  runtimeTransportDispatchLifecycleRequestSchema,
  runtimeTransportDispatchPreviewEndRequestSchema,
  runtimeTransportDispatchPreviewRequestSchema,
  runtimeTransportDispatchProgressRequestSchema,
  runtimeTransportDispatchReasoningRequestSchema,
  runtimeTransportDispatchReplyRequestSchema,
  runtimeTransportDispatchRuntimeEvidenceRequestSchema,
  runtimeTransportDispatchToolActivityRequestSchema,
  runtimeTransportForkAgentSessionRequestSchema,
  runtimeTransportForkAgentSessionResultSchema,
  runtimeTransportHeartbeatRequestSchema,
  runtimeTransportInspectExecutionRecoveryRequestSchema,
  runtimeTransportInspectExecutionRecoveryResponseSchema,
  runtimeTransportLocalAgentControlForkSessionFramePayloadSchema,
  runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema,
  runtimeTransportLocalAgentControlManageProfileFoldersFramePayloadSchema,
  runtimeTransportLocalAgentControlReadProfileWorkspaceFramePayloadSchema,
  runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema,
  runtimeTransportLocalAgentControlResultFramePayloadSchema,
  runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema,
  runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema,
  runtimeTransportLocalFolderPickerRequestSchema,
  runtimeTransportLocalProjectControlConnectCandidateRequestSchema,
  runtimeTransportLocalProjectControlConnectDeclaredPathRequestSchema,
  runtimeTransportLocalProjectControlDiscoverProjectsRequestSchema,
  runtimeTransportLocalProjectControlRemoveConnectionRequestSchema,
  runtimeTransportLocalProjectControlRemoveMissingConnectionsRequestSchema,
  runtimeTransportLocalProjectControlSetDefaultConnectionRequestSchema,
  runtimeTransportLookupOwnerServiceRequestSchema,
  runtimeTransportLookupOwnerServiceResponseSchema,
  runtimeTransportLookupRouteRequestSchema,
  runtimeTransportLookupRoutesBatchRequestSchema,
  runtimeTransportManageLocalAgentInstallationRequestSchema,
  runtimeTransportManageLocalAgentInstallationResponseSchema,
  runtimeTransportManageProfileFoldersRequestSchema,
  runtimeTransportManageProfileFoldersResponseSchema,
  runtimeTransportNotifyRouteCatalogChangedRequestSchema,
  runtimeTransportNotifyRouteCatalogChangedResponseSchema,
  runtimeTransportOpenMeldToolsControlRequestSchema,
  runtimeTransportOpenMeldToolsControlResponseSchema,
  runtimeTransportOpenMeldToolsControlResultFramePayloadSchema,
  runtimeTransportPreExecutionHandoffRequestSchema,
  runtimeTransportReadProfileFolderProjectionRequestSchema,
  runtimeTransportReadProfileFolderProjectionResponseSchema,
  runtimeTransportReadProfileWorkspaceRequestSchema,
  runtimeTransportReadProfileWorkspaceResponseSchema,
  runtimeTransportRefreshLocalAgentCatalogRequestSchema,
  runtimeTransportRefreshLocalAgentCatalogResponseSchema,
  runtimeTransportRegisterSessionRequestSchema,
  runtimeTransportResumeControllerConversationFramePayloadSchema,
  runtimeTransportResumeControllerConversationRequestSchema,
  runtimeTransportResumeControllerConversationResponseSchema,
  runtimeTransportResumeControllerConversationResultFramePayloadSchema,
  runtimeTransportRouteCatalogChangedFramePayloadSchema,
  runtimeTransportRuntimeCoordinatorDecisionRequestSchema,
  runtimeTransportRuntimeCoordinatorDecisionResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema,
  runtimeTransportRuntimeCoordinatorReadInteractionRequestSchema,
  runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema,
  runtimeTransportRuntimeCoordinatorReadInteractionRevisionResponseSchema,
  runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema,
  runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema,
  runtimeTransportRuntimeCoordinatorWakeStopRequestSchema,
  runtimeTransportRuntimeCoordinatorWakeStopResponseSchema,
  runtimeTransportSessionDisconnectDiagnosticSchema,
  runtimeTransportSetLocalAgentEnabledRequestSchema,
  runtimeTransportSetLocalAgentEnabledResponseSchema,
  runtimeTransportSetProfileWorkspaceRequestSchema,
  runtimeTransportSetProfileWorkspaceResponseSchema,
  runtimeTransportSocketDisconnectRateBucketSchema,
  runtimeTransportSubmitTaskResultRequestSchema,
  runtimeTransportWaitDispatchResultRequestSchema,
  SERVICE_CONNECTION_ID_QUERY_PARAMETER,
  SPACE_WORK_HANDOFF_CAPABILITY_HEADER,
  type SpacePreferences,
  serviceConnectionDiagnosticIdSchema,
  spacePreferencesSchema,
  toLegacySpaceAddressingWireValue,
  wakeStopEligibilityReadModelSchema,
} from "@openmeld/schemas";
import type {
  AgentInteractionPendingSummary,
  AgentProfileExecutionModeResponse,
  AgentTaskObservationRedriveQueueMessage,
  ComputerFileAccessErrorResponse,
  DaemonServiceLane,
  DaemonStreamFrame,
  LocalAgentReasoningPreferences,
  LocalAgentReasoningPreferencesRpc,
  LocalWakeRouteReport,
  OpenMeldDaemonCancelPayload,
  OpenMeldDaemonInterruptPayload,
  OpenMeldDaemonManageLocalAgentInstallationPayload,
  OpenMeldDaemonSetLocalAgentEnabledPayload,
  OpenMeldDaemonSetProfileWorkspacePayload,
  OpenMeldDaemonSyncRouteCatalogPayload,
  OpenMeldDaemonTaskResultEnvelope,
  OpenMeldToolsControlCapability,
  OpenMeldToolsControlResult,
  PostSpaceDispatchOutboxRedriveResponse,
  RuntimeCoordinatorDeliveryRouteEvidence,
  RuntimeCoordinatorExecutionEventType,
  RuntimeCoordinatorExecutionRecord,
  RuntimeCoordinatorExecutionStatus,
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeCoordinatorFailurePublicationCommand,
  RuntimeCoordinatorFailurePublicationOutcome,
  RuntimeCoordinatorFinalizationClaimRead,
  RuntimeCoordinatorFinalizationCommand,
  RuntimeCoordinatorFinalizationOutcome,
  RuntimeCoordinatorTerminalOutcome,
  RuntimeCoordinatorTokenReasonCode,
  RuntimeCoordinatorTokenRunAuthority,
  RuntimeCoordinatorTokenStatus,
  RuntimeTransportAgentProfileExecutionModeRequest,
  RuntimeTransportAgentProfileExecutionStateRequest,
  RuntimeTransportAgentProfileExecutionStateResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationRequest,
  RuntimeTransportAgentProfileLegacyConversationMutationRequest,
  RuntimeTransportAgentProfileOperationalContextsRequest,
  RuntimeTransportAgentProfileOperationalContextsResponse,
  RuntimeTransportAgentProfileWorkContinuationAuthorizeRequest,
  RuntimeTransportAgentProfileWorkContinuationAuthorizeResponse,
  RuntimeTransportAgentProfileWorkContinuationNeedsAttentionRequest,
  RuntimeTransportAgentProfileWorkContinuationNeedsAttentionResponse,
  RuntimeTransportAgentProfileWorkHandoffRequest,
  RuntimeTransportAgentProfileWorkHandoffResponse,
  RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalRequest,
  RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalResponse,
  RuntimeTransportAgentProfileWorkQueueApproveRequest,
  RuntimeTransportAgentProfileWorkQueueApproveResponse,
  RuntimeTransportAgentProfileWorkRecoveryReadRequest,
  RuntimeTransportAgentProfileWorkRecoveryReadResponse,
  RuntimeTransportAgentProfileWorkSkipRequest,
  RuntimeTransportAgentProfileWorkSkipResponse,
  RuntimeTransportAgentProfileWorkUsageAvailableRequest,
  RuntimeTransportAgentProfileWorkUsageAvailableResponse,
  RuntimeTransportDeletedAgentProfileWakeCancellationRequest,
  RuntimeTransportDeletedAgentProfileWakeCancellationResponse,
  RuntimeTransportDeliverDispatchRequest,
  RuntimeTransportDeliverDispatchResponse,
  RuntimeTransportDispatchInteractionDeliveredRequest,
  RuntimeTransportDispatchInteractionRequest,
  RuntimeTransportDispatchLifecycleRequest,
  RuntimeTransportDispatchPreviewEndRequest,
  RuntimeTransportDispatchPreviewRequest,
  RuntimeTransportDispatchProgressRequest,
  RuntimeTransportDispatchReasoningRequest,
  RuntimeTransportDispatchReplyRequest,
  RuntimeTransportDispatchRuntimeEvidenceRequest,
  RuntimeTransportDispatchToolActivityRequest,
  RuntimeTransportForkAgentSessionResult,
  RuntimeTransportInspectExecutionRecoveryRequest,
  RuntimeTransportInspectExecutionRecoveryResponse,
  RuntimeTransportLocalAgentControlCancelFramePayload,
  RuntimeTransportLocalAgentControlForkSessionFramePayload,
  RuntimeTransportLocalAgentControlInterruptFramePayload,
  RuntimeTransportLocalAgentControlManageInstallationFramePayload,
  RuntimeTransportLocalAgentControlRefreshCatalogFramePayload,
  RuntimeTransportLocalAgentControlSetEnabledFramePayload,
  RuntimeTransportLocalAgentControlSetProfileWorkspaceFramePayload,
  RuntimeTransportManageLocalAgentInstallationResponse,
  RuntimeTransportOpenMeldToolsControlResponse,
  RuntimeTransportPreExecutionHandoffRequest,
  RuntimeTransportPreExecutionHandoffResponse,
  RuntimeTransportRefreshLocalAgentCatalogResponse,
  RuntimeTransportResumeControllerConversationRequest,
  RuntimeTransportResumeControllerConversationResponse,
  RuntimeTransportRuntimeCoordinatorDecisionRequest,
  RuntimeTransportRuntimeCoordinatorDecisionResponse,
  RuntimeTransportRuntimeCoordinatorHeadAcceptRequest,
  RuntimeTransportRuntimeCoordinatorHeadAcceptResponse,
  RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest,
  RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse,
  RuntimeTransportRuntimeCoordinatorHeadWaitingRequest,
  RuntimeTransportRuntimeCoordinatorHeadWaitingResponse,
  RuntimeTransportRuntimeCoordinatorReadInteractionResponse,
  RuntimeTransportRuntimeCoordinatorRespondInteractionRequest,
  RuntimeTransportRuntimeCoordinatorRespondInteractionResponse,
  RuntimeTransportRuntimeCoordinatorWakeStopRequest,
  RuntimeTransportRuntimeCoordinatorWakeStopResponse,
  RuntimeTransportSessionDisconnectDiagnostic,
  RuntimeTransportSetLocalAgentEnabledResponse,
  RuntimeTransportSetProfileWorkspaceResponse,
  RuntimeTransportSocketCloseReasonCode,
  RuntimeTransportSocketDisconnectClass,
  RuntimeTransportSocketDisconnectRateBucket,
  RuntimeTransportStopCause,
  RuntimeTransportSubmitTaskResultRequest,
  RuntimeTransportSubmitTaskResultResponse,
  SpaceAgentStreamTerminal,
} from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { buildSystemNoticeText } from "@openmeld/space-mesh";
import { publishAccountInvalidation } from "../../../account-invalidation/publish-account-invalidation";
import { linkAcceptedAgentActivityExecutions } from "../../../agent-activity/activity-execution-link-repository";
import {
  type AgentExecutionReadinessImpactClearResult,
  clearAgentExecutionReadinessImpactForExecutionRunning,
  writeAgentExecutionReadinessImpact,
} from "../../../agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import { resolveAgentProfileWorkRecoveryAuthScope } from "../../../agent-profile/application/agent-profile-work-recovery-auth-scope";
import { readLocalRuntimeExpectedRoutes } from "../../../agent-profile-binding/application/local-runtime-expected-routes-service";
import {
  readPrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecordByControllerConversation,
} from "../../../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { recordAndEnqueueAgentTaskNeedsAttentionObservation } from "../../../agent-task-coordination/application/agent-task-needs-attention-observation-service";
import { recordAndEnqueueAgentTaskTerminalOutcome } from "../../../agent-task-coordination/application/agent-task-terminal-outcome-service";
import {
  inspectRuntimeCoordinatorPublicationFailedTaskOutcome,
  recordRuntimeCoordinatorFinalizationTaskOutcome,
  recordRuntimeCoordinatorPublicationFailedTaskOutcome,
  recordRuntimeCoordinatorStoppedTaskOutcome,
} from "../../../agent-task-coordination/application/runtime-coordinator-task-outcome";
import {
  readDispatchAttemptExecutionOwnershipFact,
  readDispatchAttemptResultAcceptanceFact,
  writeOpenMeldDaemonOpsDecision,
} from "../../../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import {
  DISPATCH_HINT_SYSTEM_PROFILE_ID,
  DISPATCH_HINT_SYSTEM_PROFILE_NAME,
} from "../../../dispatch/rules/dispatch-hint-policy";
import {
  executeHostedExecutionRecovery,
  type HostedExecutionRecoveryExecuteRequest,
  type HostedExecutionRecoveryInspectRequest,
  inspectHostedExecutionRecovery,
} from "../../../execution-recovery/application/hosted-execution-recovery-coordinator";
import { AlarmFailureBackoff } from "../../../lib/alarm-failure-backoff";
import type { CoreBindings } from "../../../lib/bindings";
import { resolveReleaseTriggeredOpenMeldToolsUpdateDecision } from "../../../local-components/automatic-update-trigger";
import {
  type CoreLocalComponentsRelease,
  readCoreLocalComponentsRelease,
  UNAVAILABLE_LOCAL_COMPONENTS_RELEASE,
} from "../../../local-components/release-source";
import { isLocalComponentVersionAtLeast } from "../../../local-components/update-projection";
import { isRequestChainEnforced } from "../../../member-agent/member-agents-feature";
import { resolveSpaceStub } from "../../../rpc/space-ref";
import {
  emitSpaceExecutionRecoveryNoticeSignal,
  emitSpaceSystemNoticeSignal,
  emitSpaceTextSignal,
} from "../../../rpc/space-signal-emitter";
import { readCurrentRuntimeAgentControllerReport } from "../../../runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import { emitCoreFinalVisibleOutcomeRuntimeEvidence } from "../../../shared/observability/final-visible-outcome-evidence";
import { CORE_LOG_EVENTS } from "../../../shared/observability/log-events";
import { readAcceptedDispatchFinalizationFact } from "../../../space/infrastructure/postgresql/accepted-dispatch-finalization-repo";
import { listActiveSpaceIdsForProfileFromSpaceIndex } from "../../../space-index/space-index-repository";
import { legacyContextAssociationFromBinding } from "../../application/agent-profile-context-migration";
import {
  type AgentProfileWorkCoordinatorHeadWriteResult,
  acquireAgentProfileContextMigration,
  acquireRuntimeCoordinatorAgentProfileExecutionTargetMutation,
  acquireRuntimeCoordinatorAgentProfileFutureWorkSettingsMutation,
  acquireRuntimeCoordinatorAgentProfileLegacyConversationMutation,
  activateAgentProfileContextMigration,
  advanceRuntimeCoordinatorAgentProfileExecutionIndexRepair,
  approveRuntimeCoordinatorAgentProfileWorkQueue,
  authorizeRuntimeCoordinatorAgentProfileWorkContinuation,
  completeRuntimeCoordinatorAgentProfileWorkRecoveryInboxProjection,
  handOffRuntimeCoordinatorOccupiedAgentProfileWork,
  isAgentProfileContextMigrationRetryDue,
  listDrainingAgentProfileContextMigrations,
  markRuntimeCoordinatorAgentProfileWorkContinuationNeedsAttention,
  markRuntimeCoordinatorAgentProfileWorkControllerConversationOccupancy,
  markRuntimeCoordinatorAgentProfileWorkUsageAvailable,
  prepareRuntimeCoordinatorAcceptedDeliveryWithAdmission,
  readOrUpdateAgentProfileExecutionMode,
  readRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarmAtMs,
  readRuntimeCoordinatorAgentProfileExecutionStateFromAdmission,
  readRuntimeCoordinatorAgentProfileOperationalContextsFromAdmission,
  readRuntimeCoordinatorAgentProfileWorkControllerConversationOccupied,
  readRuntimeCoordinatorAgentProfileWorkRecoveryFromAdmission,
  readRuntimeCoordinatorRiskWindowExecutions,
  recordAgentProfileContextMigrationFailure,
  releaseRuntimeCoordinatorAgentProfileExecutionTargetMutation,
  resolveNextAgentProfileContextMigrationAlarmAtMs,
  retireRuntimeCoordinatorAgentProfileHeadHistoryReference,
  rollbackRuntimeCoordinatorUnsentDeliveryWithAdmission,
  skipRuntimeCoordinatorAgentProfileInterruptedWork,
  writeRuntimeCoordinatorHeadLifecycleWithAdmission,
} from "../../application/agent-profile-execution-admission";
import {
  clearPendingAgentProfileWorkPromotion,
  deferPendingAgentProfileWorkPromotion,
  type PendingAgentProfileWorkPromotion,
  readNextPendingAgentProfileWorkPromotionAlarmAtMs,
  readPendingAgentProfileWorkPromotion,
  readPendingAgentProfileWorkPromotions,
} from "../../application/agent-profile-work-promotion";
import {
  projectAgentProfileWorkRecoveryInboxItem,
  resolveAgentProfileWorkRecoveryInboxItem,
} from "../../application/agent-profile-work-recovery-inbox-producer";
import {
  type AgentProfileWorkRecoveryInboxProjectionIntent,
  readNextAgentProfileWorkRecoveryInboxProjectionAlarmAtMs,
  readPendingAgentProfileWorkRecoveryInboxProjectionIntents,
  recordAgentProfileWorkRecoveryInboxProjectionFailure,
} from "../../application/agent-profile-work-recovery-inbox-projection";
import {
  publishAgentReadinessInvalidationToSpaces,
  resolveRouteCatalogChangedInvalidationProfileIds,
} from "../../application/agent-readiness-invalidation-service";
import { createComputerConnectionIncidents } from "../../application/computer-connection-incidents";
import { isDaemonExecutionCompatible } from "../../application/daemon-execution-compatibility";
import {
  emitDaemonDispatchRuntimeEvidence,
  validateDaemonDispatchRuntimeEvidence,
  validateDaemonDispatchToolActivityIdentity,
} from "../../application/daemon-runtime-evidence";
import {
  cancelDeletedAgentProfileWakesWithPorts,
  DELETED_AGENT_PROFILE_WAKE_STOP_REASON,
} from "../../application/deleted-agent-profile-wake-cancellation";
import {
  ExecutionContextSelectionError,
  readWakeExecutionContextDiagnostics,
  recordExecutionContextCandidate,
  recordExecutionContextCompletionInTransaction,
  resolveExecutionContextTask,
} from "../../application/execution-context-authority";
import { interactionResponseFingerprint } from "../../application/interaction-response-fingerprint";
import {
  buildFailedLocalAgentStreamTerminal,
  buildLocalAgentStreamId,
  buildLocalAgentStreamTerminal,
  buildStoppedLocalAgentStreamTerminal,
  createLocalAgentStreamClosureRetryEntry,
  incrementLocalAgentStreamClosureRetryEntry,
  listDueLocalAgentStreamClosureRetryEntries,
  readLocalAgentStreamClosureRetryEntry,
  readNextLocalAgentStreamClosureRetryAtMs,
  removeLocalAgentStreamClosureRetryEntry,
  upsertLocalAgentStreamClosureRetryEntry,
} from "../../application/local-agent-stream";
import {
  readProfileFolderProjectionRecord,
  writeProfileFolderProjectionRecord,
} from "../../application/profile-folder-projection-store";
import {
  markRuntimeCoordinatorAgentTaskObservationDeliveryProjected,
  type RuntimeCoordinatorAgentTaskObservationDeliveryRecord,
  readRuntimeCoordinatorAgentTaskObservationDeliveriesFromIndex,
  removeRuntimeCoordinatorAgentTaskObservationDeliveryFromIndex,
  upsertRuntimeCoordinatorAgentTaskObservationDelivery,
  upsertRuntimeCoordinatorAgentTaskObservationDeliveryInTransaction,
} from "../../application/runtime-coordinator-agent-task-observation-delivery";
import type {
  ReplayRuntimeCoordinatorFinalizationCommandInput,
  ReplayRuntimeCoordinatorFinalizationCommandResponse,
  RuntimeCoordinatorDecisionAuthorityRead,
  RuntimeCoordinatorDurableDecisionRecord,
  RuntimeCoordinatorFinalizationReplayFailure,
  RuntimeCoordinatorFinalizationRetryEntry,
  RuntimeCoordinatorHeadLifecycleRecord,
  RuntimeCoordinatorHeadPublicationRetryState,
  RuntimeCoordinatorHeadWaitingAlarmWorkItem,
  RuntimeCoordinatorHeadWaitingBoundary,
  RuntimeCoordinatorPendingAgentInteractionState,
  RuntimeCoordinatorPreExecutionHandoffRecord,
  RuntimeCoordinatorPublicationBlockerRecord,
  RuntimeCoordinatorPublicationClosureDiagnosticInput,
  RuntimeCoordinatorPublicationClosureDiagnostics,
  RuntimeCoordinatorRunCommandState,
  RuntimeCoordinatorRunExpiryCause,
  RuntimeCoordinatorRunLocalProgressState,
  RuntimeCoordinatorTerminalDecisionPlan,
  RuntimeCoordinatorTokenValidationContext,
  RuntimeCoordinatorTokenValidationFrameKind,
  RuntimeCoordinatorWakeStoppedNoticePublicationRecord,
} from "../../application/runtime-coordinator-authority";
import {
  appendRuntimeCoordinatorHeadDuplicateObservation,
  buildHistoricalEvidenceOnlyClosureDiagnostics,
  buildMissingPublicationFactsClosureDiagnostics,
  buildPreExecutionHandoffFailureResultRef,
  buildRuntimeCoordinatorCancelledExecutionRecord,
  buildRuntimeCoordinatorControllerConversationOccupiedTerminalPlan,
  buildRuntimeCoordinatorDecisionId,
  buildRuntimeCoordinatorDeliveryExpiredTerminalPlan,
  buildRuntimeCoordinatorExecutionRecordFromAuthority,
  buildRuntimeCoordinatorExecutionRecordFromCommandState,
  buildRuntimeCoordinatorExecutionRecordFromFinalizationCommand,
  buildRuntimeCoordinatorFailurePublicationFailureOutcome,
  buildRuntimeCoordinatorFinalizationCommandStorageKey,
  buildRuntimeCoordinatorFinalizationOutcomeStorageKey,
  buildRuntimeCoordinatorHeadFailurePublicationCommand,
  buildRuntimeCoordinatorHeadLifecycleStorageKey,
  buildRuntimeCoordinatorHeadPublicationExhaustion,
  buildRuntimeCoordinatorHeadPublicationIntentId,
  buildRuntimeCoordinatorHeadPublicationIntentReadyRecord,
  buildRuntimeCoordinatorHeadPublicationRetry,
  buildRuntimeCoordinatorHeadStoppedPublicationIntentId,
  buildRuntimeCoordinatorHeadWakeStoppedNoticePublicationId,
  buildRuntimeCoordinatorLocalRuntimeLostTerminalPlan,
  buildRuntimeCoordinatorProgressStaleTerminalPlan,
  buildRuntimeCoordinatorPublicationBlockerStorageKey,
  buildRuntimeCoordinatorRunCommandStateFromLifecycle,
  buildRuntimeCoordinatorRunExpiryEventPayload,
  buildRuntimeCoordinatorTokenValidationContextFromAuthority,
  buildRuntimeCoordinatorTokenValidationContextFromCommandState,
  buildRuntimeCoordinatorTokenValidationContextFromProjection,
  buildRuntimeCoordinatorWakeStoppedNoticePublicationId,
  buildRuntimeCoordinatorWakeStoppedNoticePublicationStorageKey,
  hasAcceptedResultRuntimeCoordinatorPointer,
  hasRuntimeCoordinatorDurableLocalProgress,
  hasRuntimeCoordinatorLocalProgressStaleTerminalExpired,
  incrementRuntimeCoordinatorFinalizationRetryEntry,
  isHistoricalPublicationClosureEvidence,
  isRuntimeCoordinatorFinalizationRetryParkLimitReached,
  isRuntimeCoordinatorHeadLifecycleRecord,
  isRuntimeCoordinatorHeadWaitingForDevice,
  isRuntimeCoordinatorHeadWaitingRecoveryCandidate,
  isRuntimeCoordinatorLateResultRecoverable,
  isRuntimeCoordinatorLocalAttemptWithdrawn,
  isRuntimeCoordinatorPublicationProjectionSettled,
  isRuntimeCoordinatorPublicationRetryExhausted,
  isRuntimeCoordinatorReevaluatableDecisionAction,
  isSameRuntimeCoordinatorHeadAuthority,
  minNullableTimestamp,
  normalizeLegacyRuntimeCoordinatorHeadAcceptanceTiming,
  normalizeRuntimeCoordinatorHeadWaitingBoundary,
  omitRuntimeCoordinatorHeadPublicationRetry,
  parkRuntimeCoordinatorFinalizationRetryEntry,
  RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
  RUNTIME_COORDINATOR_DECISION_MODEL_VERSION,
  RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
  RUNTIME_COORDINATOR_HEAD_WAITING_HARD_DEADLINE_MS,
  RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_HEADER,
  RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_REASON,
  RUNTIME_COORDINATOR_HEAD_WAITING_SOFT_WAIT_MS,
  RUNTIME_COORDINATOR_LOCAL_ATTEMPT_WITHDRAWAL_OCCUPANCY_TERMINAL_REASON_CODE,
  RUNTIME_COORDINATOR_LOCAL_ATTEMPT_WITHDRAWAL_SERVICE_AWAY_REASON_CODE,
  RUNTIME_COORDINATOR_LOCAL_ATTEMPT_WITHDRAWAL_SUPERSEDED_REASON_CODE,
  RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE,
  RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
  RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_DEADLINE_MS,
  RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION,
  RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE,
  RUNTIME_COORDINATOR_PUBLICATION_BLOCKER_MODEL_VERSION,
  RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
  RUNTIME_COORDINATOR_WAKE_STOP_LOCAL_CONTROL_ACCEPTED_REASON_CODE,
  RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
  RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
  rejectRuntimeCoordinatorFinalizationReplay,
  resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMsFromEntries,
  resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMsFromRecords,
  resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMsFromRecords,
  resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMsFromRecords,
  resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMsFromRecords,
  resolveNextRuntimeCoordinatorRunProgressPhase,
  resolveRuntimeCoordinatorDecisionRun,
  resolveRuntimeCoordinatorDecisionScopeMismatchReason,
  resolveRuntimeCoordinatorExecutionAdmissionValidityMs,
  resolveRuntimeCoordinatorFinalizationCommandIdFromClosureDiagnosticInput,
  resolveRuntimeCoordinatorHeadDuplicateReasonCode,
  resolveRuntimeCoordinatorHeadTargetDisplay,
  resolveRuntimeCoordinatorHeadWaitingDecision,
  resolveRuntimeCoordinatorHeadWaitingPolicy,
  resolveRuntimeCoordinatorLocalProgressDecisionReason,
  resolveRuntimeCoordinatorPreAcceptRedeliveryExpiry,
  resolveRuntimeCoordinatorPublicationStatus,
  resolveRuntimeCoordinatorPublicationTerminalOutcomeKind,
  resolveRuntimeCoordinatorRedeliveryAction,
  resolveRuntimeCoordinatorResultAuthorityMismatchReason,
  resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs,
  resolveRuntimeCoordinatorTerminalDecisionPlan,
  resolveRuntimeCoordinatorWatchdogProgressBaselineAtMs,
  sanitizeRuntimeCoordinatorDeliveryRequestForCommandState,
  settleRuntimeCoordinatorAuthorityForCancellationAccepted,
  settleRuntimeCoordinatorAuthorityForTerminalDecision,
  toRuntimeCoordinatorHeadPublicationOutcomeFromFailurePublication,
  withRuntimeCoordinatorTerminalReplySignalId,
} from "../../application/runtime-coordinator-authority";
import {
  issueRuntimeCoordinatorExecutionToken,
  type RuntimeCoordinatorExecutionTokenValidationResult,
  resolveRuntimeCoordinatorTokenAwareExecutionDecision,
  retireRuntimeCoordinatorTokenRun,
  validateRuntimeCoordinatorExecutionTokenAgainstAuthority,
} from "../../application/runtime-coordinator-execution-token";
import { processRuntimeCoordinatorFinalizationRetryAlarm as processRuntimeCoordinatorFinalizationRetryAlarmWithPorts } from "../../application/runtime-coordinator-finalization-retry-alarm";
import {
  type RuntimeCoordinatorFinalizationSemantic,
  resolveRuntimeCoordinatorFinalizationSemantic,
} from "../../application/runtime-coordinator-finalization-semantic";
import { processRuntimeCoordinatorHeadAcceptedHandoffAlarm as processRuntimeCoordinatorHeadAcceptedHandoffAlarmWithPorts } from "../../application/runtime-coordinator-head-accepted-handoff-alarm";
import { processRuntimeCoordinatorHeadFailurePublicationRetryAlarm as processRuntimeCoordinatorHeadFailurePublicationRetryAlarmWithPorts } from "../../application/runtime-coordinator-head-failure-publication-retry-alarm";
import { processRuntimeCoordinatorHeadWaitingDeadlineAlarm as processRuntimeCoordinatorHeadWaitingDeadlineAlarmWithPorts } from "../../application/runtime-coordinator-head-waiting-deadline-alarm";
import {
  buildRuntimeCoordinatorInteractionAttentionEventId,
  runtimeCoordinatorInteractionAttentionCode,
} from "../../application/runtime-coordinator-interaction-attention";
import {
  type InteractionRequestRoot,
  projectRuntimeCoordinatorInteractionInboxItem,
  resolveRuntimeCoordinatorInteractionInboxItem,
} from "../../application/runtime-coordinator-interaction-inbox-producer";
import { projectPluginConnectionExecutionSource } from "../../application/runtime-coordinator-plugin-connection-source";
import { processRuntimeCoordinatorPreExecutionHandoffAlarm as processRuntimeCoordinatorPreExecutionHandoffAlarmWithPorts } from "../../application/runtime-coordinator-pre-execution-handoff-alarm";
import {
  appendRuntimeCoordinatorDecisionRecordToStorage,
  deleteRuntimeCoordinatorPreExecutionHandoffRecordFromStorage,
  readRuntimeCoordinatorDecisionByKeyFromStorage,
  readRuntimeCoordinatorDecisionRecordsFromStorage,
  readRuntimeCoordinatorFinalizationCommandFromStorage,
  readRuntimeCoordinatorFinalizationOutcomeFromStorage,
  readRuntimeCoordinatorFinalizationRetriesFromStorage,
  readRuntimeCoordinatorHeadLifecycleRecordFromStorage,
  readRuntimeCoordinatorHeadLifecycleRecordsFromStorageIndex,
  readRuntimeCoordinatorPreExecutionHandoffRecordFromStorage,
  readRuntimeCoordinatorPreExecutionHandoffRecordsFromStorageIndex,
  readRuntimeCoordinatorRunCommandStateFromStorage,
  readRuntimeCoordinatorRunCommandStatesFromStorageIndex,
  readRuntimeCoordinatorTokenAuthorityFromStorage,
  recordRuntimeCoordinatorLocalAttemptWithdrawnInStorage,
  removeRuntimeCoordinatorFinalizationRetryFromStorage,
  requestRuntimeCoordinatorLocalAttemptWithdrawalInStorage,
  retainRuntimeCoordinatorCommunicationRecovery,
  upsertRuntimeCoordinatorFinalizationRetryEntryInStorage,
  writeRuntimeCoordinatorPreExecutionHandoffRecordToStorage,
  writeRuntimeCoordinatorRunCommandStateInTransaction,
  writeRuntimeCoordinatorRunCommandStateToStorage,
  writeRuntimeCoordinatorTokenAuthorityInTransaction,
  writeRuntimeCoordinatorTokenAuthorityToStorage,
} from "../../application/runtime-coordinator-storage";
import { processRuntimeCoordinatorWatchdogAlarm as processRuntimeCoordinatorWatchdogAlarmWithPorts } from "../../application/runtime-coordinator-watchdog-alarm";
import {
  readNextRuntimeCoordinatorWatchdogAlarmAtMs,
  readRuntimeCoordinatorWatchdogDueCommands,
  repairRuntimeCoordinatorWatchdogSchedule,
} from "../../application/runtime-coordinator-watchdog-storage";
import {
  reconcileRuntimeTransportAlarmAtMs,
  resolveNextRuntimeTransportAlarmAtMs,
} from "../../application/runtime-transport-alarm-schedule";
import {
  buildPendingDispatchStateFromAcceptedRequest,
  deliverDispatch,
  handleDispatchLifecycle,
  handleSubmitTaskResult,
} from "../../application/runtime-transport-dispatch-service";
import { normalizeOptionalText } from "../../application/runtime-transport-normalization";
import {
  diffSessionReadinessComponents,
  snapshotSessionReadinessComponents,
} from "../../application/runtime-transport-readiness-delta";
import {
  buildRouteCatalogReconciliationMissingKey,
  nextRouteCatalogReconciliationBackoffLevel,
  ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS,
  resolveRouteCatalogReconciliationThrottleMs,
} from "../../application/runtime-transport-reconciliation-throttle";
import {
  compareRuntimeTransportSessionsByFreshness,
  detachSocket,
  handleHeartbeat,
  handleRegisterSession,
  LEASE_TTL_MS,
  lookupOwnerService,
  lookupRoute,
  lookupRoutesBatch,
  reapExpiredLeases,
} from "../../application/runtime-transport-session-service";
import {
  buildDispatchAttemptKey,
  type CompletedDispatchResultState,
  createRuntimeTransportMutableState as createRuntimeTransportHubMutableState,
  type PendingDispatchState,
  type RuntimeTransportProfileLeaseState,
  type RuntimeTransportSessionState,
  type WaitDispatchResultRequest,
  type WaitDispatchResultResponse,
} from "../../application/runtime-transport-state";
import {
  cleanupCompletedResults,
  cleanupExpiredPendingDispatches,
  failPendingDispatchResultWaitersForConnectionGeneration,
  resolvePendingResultWaiters,
  waitDispatchResult,
} from "../../application/runtime-transport-wait-service";
import {
  acceptDispatchResultInboxRecord,
  buildDispatchResultInboxKey,
  readDispatchResultInboxRecord,
  updateDispatchResultInboxPublishState,
} from "../../infrastructure/postgresql/dispatch-result-inbox-repo";
import {
  hasRuntimeCoordinatorWakeStopRequestedEvent,
  readRuntimeCoordinatorExecutionProjectionByDispatch,
  readRuntimeCoordinatorExecutionProjectionById,
  writeRuntimeCoordinatorExecutionEventFromParts,
  writeRuntimeCoordinatorExecutionProjection,
  writeRuntimeCoordinatorTerminalExecutionProjectionWithoutRead,
} from "../../infrastructure/postgresql/runtime-coordinator-execution-repo";
import {
  adoptHibernatedSockets,
  persistServiceRuntimeRecords,
  persistServiceRuntimeRecordsNow,
  readServiceRuntimeConnectionGeneration,
  restoreServiceRuntimeRecords,
} from "../../infrastructure/runtime-transport-runtime-store";
import {
  applyRuntimeTransportNegotiatedCapabilities,
  RUNTIME_TRANSPORT_VERIFIED_OWNER_HEADER,
  readRuntimeTransportSocketAttachment,
  writeRuntimeTransportSocketAttachment,
} from "../../infrastructure/runtime-transport-socket-attachment";

type AcceptableWebSocket = WebSocket & {
  accept(): void;
};
type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];
const createWebSocketPair = (): AcceptableWebSocketPair => {
  const WebSocketPairConstructor = (
    globalThis as typeof globalThis & {
      WebSocketPair: new () => AcceptableWebSocketPair;
    }
  ).WebSocketPair;
  return new WebSocketPairConstructor();
};
const RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_MAX_WORK_UNITS = 25;
const RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_MAX_RUN_MS = 5000;
const RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_CONTINUATION_DELAY_MS = 1000;
const AGENT_PROFILE_WORK_RECOVERY_INBOX_HOUSEKEEPING_BATCH_SIZE = 8;
const AGENT_PROFILE_WORK_COORDINATOR_PROMOTION_REDRIVE_REASON =
  "agent_profile_work_coordinator_promotion" as const;
const RUNTIME_COORDINATOR_INTERACTION_INBOX_REPAIR_STORAGE_PREFIX =
  "runtime-coordinator:interaction-inbox-repair:";
const RUNTIME_COORDINATOR_INTERACTION_INBOX_RETRY_DELAYS_MS = [
  1000, 5000, 30_000, 120_000, 300_000,
] as const;
const RUNTIME_COORDINATOR_FINALIZATION_SERIALIZATION_WAIT_MS = 1000;
const LOCAL_AGENT_CONTROL_SET_ENABLED_RESPONSE_TIMEOUT_MS = 5000;
const LOCAL_AGENT_CONTROL_MANAGE_INSTALLATION_RESPONSE_TIMEOUT_MS = 30_000;
const LOCAL_AGENT_CONTROL_REFRESH_CATALOG_RESPONSE_TIMEOUT_MS = 15_000;
const CURRENT_DEVICE_CONTROL_RESPONSE_TIMEOUT_MS = 30_000;
const AUTOMATIC_TOOLS_UPDATE_UNAVAILABLE_RETRY_DELAYS_MS = [
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
] as const;
const AUTOMATIC_TOOLS_UPDATE_UNAVAILABLE_RETRY_STORAGE_PREFIX =
  "automatic_tools_update_unavailable_retry.v1.";
const LOCAL_FOLDER_PICKER_RESPONSE_TIMEOUT_MS = 600_000;
const SERVER_ROUTE_RECONCILIATION_REASON = "server_route_reconciliation";
// Coalesce readiness-invalidation bursts: one binding change fans out to every
// profile in the owner's sessions, and several call sites fire within a few
// ms, so hundreds of per-space broadcasts pile up. Buffering by reason for a
// short window collapses each storm into one deduplicated publish per reason.
const LIVE_INVALIDATION_COALESCE_WINDOW_MS = 200;
// A Service replay records its connection before the coalesced broadcast
// runs, so later replays on that connection no longer re-announce. A failed
// broadcast is retried a few times instead of relying on those replays.
const WAKE_PROGRESS_INVALIDATION_MAX_ATTEMPTS = 3;
const AGENT_READINESS_INVALIDATION_DEFAULT_REASON =
  "agent.readiness.invalidated";
const EXPECTED_ROUTE_RECONCILIATION_READ_CACHE_MAX_AGE_MS = 5 * 60_000;
const SOCKET_DISCONNECT_RATE_BUCKET_MS = 60 * 60_000;
const SOCKET_DISCONNECT_RATE_RETENTION_MS =
  24 * SOCKET_DISCONNECT_RATE_BUCKET_MS;
const SOCKET_DISCONNECT_RATE_STORAGE_PREFIX = "socket_disconnect_rate.v1.";
const SOCKET_DISCONNECT_SESSION_LIMIT = 20;
const SOCKET_DISCONNECT_SESSION_PROFILE_ID_LIMIT = 20;
const SOCKET_DISCONNECT_SESSION_STORAGE_PREFIX =
  "socket_disconnect_session.v1.";
const SOCKET_DISCONNECT_SESSION_STORAGE_CURSOR_KEY = `${SOCKET_DISCONNECT_SESSION_STORAGE_PREFIX}cursor`;
const SOCKET_DISCONNECT_SESSION_STORAGE_SLOT_PREFIX = `${SOCKET_DISCONNECT_SESSION_STORAGE_PREFIX}slot.`;
const RUNTIME_COORDINATOR_STOPPED_TASK_PROJECTION_INDEX_STORAGE_KEY =
  "runtime-coordinator:stopped-task-projection:index";
type SocketDisconnectSessionStorageCursor = {
  nextSequence: number;
};
type RuntimeCoordinatorStoppedTaskProjectionIndex = {
  publicationIds: string[];
};
export type LocalAgentControlResultPayloadKind =
  | "fork_session"
  | "manage_installation"
  | "refresh_catalog"
  | "set_profile_workspace"
  | "read_profile_workspace"
  | "manage_profile_folders"
  | "set_enabled";
export function resolveLocalAgentControlResponseTimeoutMs(
  expectedPayload: LocalAgentControlResultPayloadKind
): number {
  if (expectedPayload === "manage_installation") {
    return LOCAL_AGENT_CONTROL_MANAGE_INSTALLATION_RESPONSE_TIMEOUT_MS;
  }
  if (expectedPayload === "refresh_catalog") {
    return LOCAL_AGENT_CONTROL_REFRESH_CATALOG_RESPONSE_TIMEOUT_MS;
  }
  if (expectedPayload === "fork_session") {
    return 35_000;
  }
  return LOCAL_AGENT_CONTROL_SET_ENABLED_RESPONSE_TIMEOUT_MS;
}
function parseRuntimeTransportDispatchLiveActivity(
  payload: unknown,
  kind: "progress" | "reasoning" | "reply" | "tool"
):
  | RuntimeTransportDispatchProgressRequest
  | RuntimeTransportDispatchReplyRequest
  | RuntimeTransportDispatchReasoningRequest
  | RuntimeTransportDispatchToolActivityRequest
  | null {
  if (kind === "reply") {
    const parsed =
      runtimeTransportDispatchReplyRequestSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }
  if (kind === "reasoning") {
    const parsed =
      runtimeTransportDispatchReasoningRequestSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }
  if (kind === "progress") {
    const parsed =
      runtimeTransportDispatchProgressRequestSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }
  const parsed =
    runtimeTransportDispatchToolActivityRequestSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
type RuntimeTransportHubHousekeepingAlarmPhase =
  | "computer_connection_incidents"
  | "context_migration"
  | "local_agent_stream_closure_retry"
  | "runtime_coordinator_agent_profile_work_recovery_inbox"
  | "runtime_coordinator_agent_profile_work_promotion"
  | "runtime_coordinator_agent_profile_execution_index"
  | "runtime_coordinator_finalization_retry"
  | "runtime_coordinator_watchdog"
  | "runtime_coordinator_head_accepted_handoff"
  | "runtime_coordinator_head_waiting"
  | "runtime_coordinator_head_failure_publication"
  | "runtime_coordinator_pre_execution_handoff"
  | "runtime_coordinator_agent_task_observation_delivery"
  | "runtime_coordinator_interaction_inbox_projection"
  | "runtime_coordinator_stopped_task_projection";
type RuntimeTransportHubHousekeepingAlarmRun = {
  continuationReasonCode: string | null;
  continuationRequired: boolean;
  deadlineAtMs: number;
  processedWorkUnits: number;
};
type RuntimeCoordinatorInteractionInboxRepairRecord = {
  attemptCount: number;
  desiredStatus: "open" | "resolved";
  interaction: Pick<
    RuntimeTransportDispatchInteractionRequest["interaction"],
    "interactionId" | "kind" | "requestedAtMs"
  >;
  nextAttemptAtMs: number;
  ownerUserId: string;
  resolvedAtMs: number | null;
  runtimeCoordinatorExecutionId: string;
  sourceSignalId?: string;
  spaceId: string;
  targetProfileName: string;
  /**
   * Explicit null means the Space main timeline. Undefined identifies a
   * persisted v1 repair written before thread-aware Inbox targets.
   */
  threadRootSignalId?: string | null;
  /** Absent on records written before the request chain was enforced. */
  requestRoot?: InteractionRequestRoot | null;
  updatedAtMs: number;
  v: 1;
};
type FinalizationRetryParkExhaustedResult =
  | "already_published"
  | "already_terminal"
  | "authority_unavailable"
  | "authority_write_failed"
  | "db_unavailable"
  | "projection_conflict"
  | "projection_unavailable"
  | "space_claim_read_unavailable"
  | "space_claim_recovery_pending"
  | "task_outcome_conflict"
  | "task_outcome_inspection_failed"
  | "task_outcome_unavailable"
  | "task_outcome_write_failed"
  | "terminal_projection_read_failed"
  | "terminal_projection_written"
  | "terminal_projection_write_failed";
type CurrentDeviceOperationWaiter = {
  daemonSessionId: string;
  expectedResponseCode: string;
  isExpectedPayload: (payload: unknown) => boolean;
  reject: (error: Error) => void;
  resolve: (payload: unknown) => void;
  socket: WebSocket;
  timeoutId: ReturnType<typeof setTimeout>;
};
class CurrentDeviceOperationError extends Error {
  readonly kind: "invalid_response" | "send_failed" | "timeout";
  constructor(
    kind: "invalid_response" | "send_failed" | "timeout",
    message: string
  ) {
    super(message);
    this.name = "CurrentDeviceOperationError";
    this.kind = kind;
  }
}
function resolveCurrentDeviceOperationHttpStatus(code: string): number {
  if (code === "computer.file_access.service_offline") {
    return 503;
  }
  if (code === "computer.file_access.timeout") {
    return 504;
  }
  return 502;
}
function resolveComputerFileAccessOperationErrorCode(
  error: unknown
): ComputerFileAccessErrorResponse["code"] {
  if (!(error instanceof CurrentDeviceOperationError)) {
    return "computer.file_access.internal_error";
  }
  if (error.kind === "send_failed") {
    return "computer.file_access.service_offline";
  }
  if (error.kind === "timeout") {
    return "computer.file_access.timeout";
  }
  return "computer.file_access.invalid_response";
}
function resolveLocalFolderPickerOperationErrorCode(
  error: unknown
):
  | "local.folder_picker.internal_error"
  | "local.folder_picker.invalid_response"
  | "local.folder_picker.service_offline"
  | "local.folder_picker.timed_out" {
  if (!(error instanceof CurrentDeviceOperationError)) {
    return "local.folder_picker.internal_error";
  }
  if (error.kind === "send_failed") {
    return "local.folder_picker.service_offline";
  }
  if (error.kind === "timeout") {
    return "local.folder_picker.timed_out";
  }
  return "local.folder_picker.invalid_response";
}
type LocalProjectControlCapability =
  | "connectCandidate"
  | "connectDeclaredPath"
  | "discoverProjects"
  | "removeConnection"
  | "removeMissingConnections"
  | "setDefaultConnection";
type ComputerFileAccessCapability = "readPolicy" | "updatePolicy";
type ComputerFileAccessOperation = {
  capability: ComputerFileAccessCapability;
  requestCode:
    | "daemon.computer_file_access.read_policy"
    | "daemon.computer_file_access.update_policy";
  requestSchema: RuntimeSchema<unknown>;
};
type LocalFolderPickerOperation = {
  requestCode: "daemon.local_folder_picker.select_folders";
  requestSchema: RuntimeSchema<unknown>;
};
type LocalProjectControlOperation = {
  capability: LocalProjectControlCapability;
  requestCode:
    | "daemon.local_project_control.connect_candidate"
    | "daemon.local_project_control.connect_declared_path"
    | "daemon.local_project_control.discover_projects"
    | "daemon.local_project_control.remove_connection"
    | "daemon.local_project_control.remove_missing_connections"
    | "daemon.local_project_control.set_default_connection";
  requestSchema: RuntimeSchema<unknown>;
  resultSchema: RuntimeSchema<unknown>;
};
function projectControlRequestForSession(
  operation: LocalProjectControlOperation,
  request: unknown,
  capabilities: RuntimeTransportSessionState["capabilities"]
): unknown {
  if (
    operation.capability !== "discoverProjects" ||
    capabilities.localProjectControl?.readConnections === true
  ) {
    return request;
  }
  // Older Services validate a strict request schema. Keep their established
  // discovery behavior without exposing a new field to old public clients.
  const legacyRequest = { ...(request as Record<string, unknown>) };
  legacyRequest.includeCandidates = undefined;
  return legacyRequest;
}
type RuntimeSchema<T> = {
  safeParse: (value: unknown) =>
    | {
        data: T;
        success: true;
      }
    | {
        error: {
          issues: Array<{
            message?: string;
          }>;
        };
        success: false;
      };
};
const COMPUTER_FILE_ACCESS_OPERATIONS_BY_PATH: Readonly<
  Record<string, ComputerFileAccessOperation>
> = {
  "/computer-file-access/read-policy": {
    capability: "readPolicy",
    requestCode: "daemon.computer_file_access.read_policy",
    requestSchema: runtimeTransportComputerFileAccessReadRequestSchema,
  },
  "/computer-file-access/update-policy": {
    capability: "updatePolicy",
    requestCode: "daemon.computer_file_access.update_policy",
    requestSchema: runtimeTransportComputerFileAccessUpdateRequestSchema,
  },
};
const LOCAL_FOLDER_PICKER_OPERATIONS_BY_PATH: Readonly<
  Record<string, LocalFolderPickerOperation>
> = {
  "/local-folder-picker/select-folders": {
    requestCode: "daemon.local_folder_picker.select_folders",
    requestSchema: runtimeTransportLocalFolderPickerRequestSchema,
  },
};
const LOCAL_PROJECT_CONTROL_OPERATIONS_BY_PATH: Readonly<
  Record<string, LocalProjectControlOperation>
> = {
  "/local-project-control/discover-projects": {
    capability: "discoverProjects",
    requestCode: "daemon.local_project_control.discover_projects",
    requestSchema:
      runtimeTransportLocalProjectControlDiscoverProjectsRequestSchema,
    resultSchema: localProjectControlDiscoverProjectsResultSchema,
  },
  "/local-project-control/connect-candidate": {
    capability: "connectCandidate",
    requestCode: "daemon.local_project_control.connect_candidate",
    requestSchema:
      runtimeTransportLocalProjectControlConnectCandidateRequestSchema,
    resultSchema: localProjectControlConnectResultSchema,
  },
  "/local-project-control/connect-declared-path": {
    capability: "connectDeclaredPath",
    requestCode: "daemon.local_project_control.connect_declared_path",
    requestSchema:
      runtimeTransportLocalProjectControlConnectDeclaredPathRequestSchema,
    resultSchema: localProjectControlConnectResultSchema,
  },
  "/local-project-control/set-default-connection": {
    capability: "setDefaultConnection",
    requestCode: "daemon.local_project_control.set_default_connection",
    requestSchema:
      runtimeTransportLocalProjectControlSetDefaultConnectionRequestSchema,
    resultSchema: localProjectControlSetDefaultConnectionResultSchema,
  },
  "/local-project-control/remove-connection": {
    capability: "removeConnection",
    requestCode: "daemon.local_project_control.remove_connection",
    requestSchema:
      runtimeTransportLocalProjectControlRemoveConnectionRequestSchema,
    resultSchema: localProjectControlRemoveConnectionResultSchema,
  },
  "/local-project-control/remove-missing-connections": {
    capability: "removeMissingConnections",
    requestCode: "daemon.local_project_control.remove_missing_connections",
    requestSchema:
      runtimeTransportLocalProjectControlRemoveMissingConnectionsRequestSchema,
    resultSchema: localProjectControlRemoveMissingConnectionsResultSchema,
  },
};
function isRejectedLocalProjectControlResult(value: unknown): value is {
  code: string;
  status: "rejected";
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in value &&
      value.status === "rejected" &&
      "code" in value &&
      typeof value.code === "string"
  );
}
type RouteCatalogReconciliationTrigger =
  | "daemon_session_heartbeat"
  | "daemon_session_registered";
type AgentProfileWorkPromotionRedriveTrigger =
  | "admission_reconciliation"
  | "alarm_recovery"
  | "terminal_transaction";
type RouteCatalogReconciliationSignalState = {
  backoffLevel: number;
  missingProfileIdsKey: string;
  notifiedAtMs: number;
  reportFingerprint: string;
};
type ExpectedRouteReconciliationReadCacheState = {
  completedAtMs: number;
  leaseSetKey: string;
};
type RuntimeCoordinatorWakeStopControlMode = "cancel" | "interrupt";
type RuntimeCoordinatorWakeStopControlReliability =
  | "native_cancel"
  | "native_interrupt";
type RuntimeCoordinatorWakeStopControlPayload =
  | OpenMeldDaemonCancelPayload
  | OpenMeldDaemonInterruptPayload;
type RuntimeCoordinatorLostRunTerminalReasonCode =
  | typeof RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
  | typeof RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE
  | typeof RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE
  | typeof RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE;
const resolveRuntimeCoordinatorLostRunTerminalPlan = (
  expiryCause: RuntimeCoordinatorRunExpiryCause
): RuntimeCoordinatorTerminalDecisionPlan => {
  if (expiryCause === "controller_conversation_occupied") {
    return buildRuntimeCoordinatorControllerConversationOccupiedTerminalPlan();
  }
  if (expiryCause === "local_progress_stale") {
    return buildRuntimeCoordinatorProgressStaleTerminalPlan();
  }
  if (expiryCause === "local_runtime_lost") {
    return buildRuntimeCoordinatorLocalRuntimeLostTerminalPlan();
  }
  return buildRuntimeCoordinatorDeliveryExpiredTerminalPlan();
};
const resolveRuntimeCoordinatorLostRunReasonCode = (
  expiryCause: RuntimeCoordinatorRunExpiryCause
): RuntimeCoordinatorLostRunTerminalReasonCode => {
  if (expiryCause === "controller_conversation_occupied") {
    return RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE;
  }
  if (expiryCause === "local_progress_stale") {
    return RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE;
  }
  if (expiryCause === "local_runtime_lost") {
    return RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE;
  }
  return RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE;
};
const resolveRuntimeCoordinatorLostRunPublicationPresentation = (
  reasonCode: RuntimeCoordinatorLostRunTerminalReasonCode
): {
  blockerSlug: string;
  noticeVariant:
    | "controller_conversation_occupied"
    | "delivery_expired"
    | "local_runtime_lost"
    | "progress_stale";
} => {
  if (
    reasonCode ===
    RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
  ) {
    return {
      blockerSlug: "controller-conversation-occupied",
      noticeVariant: "controller_conversation_occupied",
    };
  }
  if (reasonCode === RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE) {
    return {
      blockerSlug: "progress-stale",
      noticeVariant: "progress_stale",
    };
  }
  if (reasonCode === RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE) {
    return {
      blockerSlug: "local-runtime-lost",
      noticeVariant: "local_runtime_lost",
    };
  }
  return {
    blockerSlug: "delivery-expired",
    noticeVariant: "delivery_expired",
  };
};
const didRuntimeSessionCompleteStartupReconciliation = (input: {
  nextAcceptingDispatches: boolean | undefined;
  nextHasStopCause: boolean;
  previousAcceptingDispatches: boolean | undefined;
}): boolean => {
  return (
    input.previousAcceptingDispatches === false &&
    input.nextAcceptingDispatches !== false &&
    !input.nextHasStopCause
  );
};
type RuntimeCoordinatorWakeStoppedNoticePublicationResult =
  | {
      ok: true;
      publishedSignalId: string;
      status: "already_visible" | "published";
    }
  | {
      ok: false;
      reasonCode: "runtime_coordinator.stopped_publication_unavailable";
      status: "unavailable";
    };
type SerializedRuntimeCoordinatorFinalizationResult<T> =
  | {
      status: "completed";
      value: T;
    }
  | {
      status: "in_flight";
    };
type RuntimeCoordinatorFinalizationRecoveryResult =
  | {
      ok: true;
      outcome: RuntimeCoordinatorFinalizationOutcome;
    }
  | {
      ok: true;
      reasonCode: "runtime_coordinator.wake_stop_requested";
      status: "suppressed";
    }
  | null;
type RuntimeCoordinatorFinalizationOutcomeWriteResult = {
  outcome: RuntimeCoordinatorFinalizationOutcome;
  recoveryPending: boolean;
};
type RuntimeCoordinatorFinalizationOutcomeReplayResult =
  | {
      ok: true;
      outcome: RuntimeCoordinatorFinalizationOutcome;
    }
  | RuntimeCoordinatorFinalizationReplayFailure;
const runtimeCoordinatorFinalizationOutcomeMatchesVisibleClaim = (
  outcome: RuntimeCoordinatorFinalizationOutcome,
  expected: Extract<
    RuntimeCoordinatorFinalizationOutcome,
    {
      ok: true;
    }
  >
): boolean =>
  outcome.ok &&
  outcome.finalizationCommandId === expected.finalizationCommandId &&
  outcome.finalMessageKind === expected.finalMessageKind &&
  outcome.publishState === expected.publishState &&
  outcome.publishedSignalId === expected.publishedSignalId;
const upgradeLegacyRuntimeCoordinatorFinalizationOutcomeFromVisibleClaim = (
  outcome: Extract<
    RuntimeCoordinatorFinalizationOutcome,
    {
      ok: true;
    }
  >,
  visibleClaim: Extract<
    RuntimeCoordinatorFinalizationOutcome,
    {
      ok: true;
    }
  >
): Extract<
  RuntimeCoordinatorFinalizationOutcome,
  {
    ok: true;
  }
> | null => {
  if (outcome.finalMessageKind !== undefined) {
    return outcome;
  }
  if (
    visibleClaim.finalMessageKind === undefined ||
    outcome.finalizationCommandId !== visibleClaim.finalizationCommandId ||
    outcome.publishState !== visibleClaim.publishState ||
    outcome.publishedSignalId !== visibleClaim.publishedSignalId
  ) {
    return null;
  }
  return {
    ...outcome,
    finalMessageKind: visibleClaim.finalMessageKind,
  };
};
const resolveRuntimeCoordinatorFinalVisibleReasonCode = (input: {
  executionSemantic: RuntimeCoordinatorFinalizationSemantic | null;
  outcome: RuntimeCoordinatorFinalizationOutcome;
  reasonCode: string | null;
}): string => {
  if (input.reasonCode) {
    return input.reasonCode;
  }
  if (input.executionSemantic?.status === "stayed_silent") {
    return "space.stayed_silent";
  }
  if (input.outcome.publishState === "reply_published") {
    return "space.reply_published";
  }
  return input.outcome.publishState;
};
function resolveRuntimeCoordinatorHeadAdmissionResponse(input: {
  admission: AgentProfileWorkCoordinatorHeadWriteResult;
  request: RuntimeTransportRuntimeCoordinatorHeadAcceptRequest;
}): RuntimeTransportRuntimeCoordinatorHeadAcceptResponse {
  const identity = input.request.targetWakeLifecycleIdentity;
  switch (input.admission.status) {
    case "context_rejected":
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: input.admission.reasonCode,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    case "continuation_needs_attention":
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode:
          "agent_profile_work_coordinator.continuation_needs_attention",
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    case "execution_target_mutation_in_progress":
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.execution_target_mutation_in_progress",
        status: "retry_later",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    case "legacy_execution_active":
    case "written":
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.agent_profile_execution_active",
        status: "retry_later",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    case "snapshot_compatibility_retry":
      return {
        ok: false,
        primaryDispatchId: input.admission.effectiveRecord.primaryDispatchId,
        reasonCode: input.admission.reasonCode,
        status: "retry_later",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    case "queue_full":
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "agent_profile_work_coordinator.queue_full",
        status: "queue_full",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
        waitingCount: 50,
      };
    case "conflict":
      return {
        ok: false,
        primaryDispatchId: input.admission.effectiveRecord.primaryDispatchId,
        reasonCode:
          input.admission.conflictKind === "accepted_dispatch_payload"
            ? RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE
            : "runtime_coordinator.head_authority_conflict",
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    case "queued":
      return {
        ...(input.request.acceptedDispatchSnapshot &&
        input.admission.effectiveRecord.acceptedDispatchSnapshot
          ? {
              acceptedDispatchSnapshot:
                input.admission.effectiveRecord.acceptedDispatchSnapshot,
            }
          : {}),
        action: "wait_in_queue",
        ok: true,
        primaryDispatchId: input.admission.effectiveRecord.primaryDispatchId,
        queuePosition: input.admission.queuePosition,
        reasonCode: "agent_profile_work_coordinator.queued",
        runtimeCoordinatorExecutionId: null,
        status: "queued",
        targetWakeLifecycleId:
          input.admission.effectiveRecord.targetWakeLifecycleId,
        waitingCount: input.admission.waitingCount,
      };
    case "started":
      return {
        ...(input.request.acceptedDispatchSnapshot &&
        input.admission.effectiveRecord.acceptedDispatchSnapshot
          ? {
              acceptedDispatchSnapshot:
                input.admission.effectiveRecord.acceptedDispatchSnapshot,
            }
          : {}),
        action: "create_execution",
        ok: true,
        primaryDispatchId: input.admission.effectiveRecord.primaryDispatchId,
        reasonCode: "runtime_coordinator.head_accepted",
        runtimeCoordinatorExecutionId: null,
        status: "accepted",
        targetWakeLifecycleId:
          input.admission.effectiveRecord.targetWakeLifecycleId,
      };
    case "existing":
      return resolveExistingRuntimeCoordinatorHeadAdmissionResponse({
        existing: input.admission.effectiveRecord,
        request: input.request,
      });
    default:
      throw new Error("Unsupported RuntimeCoordinator head admission status");
  }
}
function resolveExistingRuntimeCoordinatorHeadAdmissionResponse(input: {
  existing: RuntimeCoordinatorHeadLifecycleRecord;
  request: RuntimeTransportRuntimeCoordinatorHeadAcceptRequest;
}): RuntimeTransportRuntimeCoordinatorHeadAcceptResponse {
  const { existing } = input;
  if (existing.status === "stopped_before_execution") {
    return {
      action: "skip_duplicate",
      ok: true,
      primaryDispatchId: existing.primaryDispatchId,
      reasonCode: "runtime_coordinator.pre_agent_stop_already_recorded",
      runtimeCoordinatorExecutionId: null,
      status: "stopped_before_execution",
      targetWakeLifecycleId: existing.targetWakeLifecycleId,
    };
  }
  if (existing.status === "publication_intent_ready") {
    return {
      action: "skip_duplicate",
      ok: true,
      primaryDispatchId: existing.primaryDispatchId,
      reasonCode: "runtime_coordinator.head_publication_intent_already_ready",
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
      targetWakeLifecycleId: existing.targetWakeLifecycleId,
    };
  }
  const isPrimaryDispatch =
    existing.primaryDispatchId === input.request.dispatchId;
  let reasonCode = resolveRuntimeCoordinatorHeadDuplicateReasonCode(
    existing.status
  );
  if (isPrimaryDispatch) {
    reasonCode =
      existing.status === "execution_linked"
        ? "runtime_coordinator.head_execution_already_linked"
        : "runtime_coordinator.head_primary_reaccepted";
  }
  return {
    ...(input.request.acceptedDispatchSnapshot &&
    existing.acceptedDispatchSnapshot
      ? { acceptedDispatchSnapshot: existing.acceptedDispatchSnapshot }
      : {}),
    action:
      existing.status === "execution_linked" || !isPrimaryDispatch
        ? "skip_duplicate"
        : "create_execution",
    ok: true,
    primaryDispatchId: existing.primaryDispatchId,
    reasonCode,
    runtimeCoordinatorExecutionId: existing.runtimeCoordinatorExecutionId,
    status:
      existing.status === "execution_linked"
        ? "execution_linked"
        : "already_accepted",
    targetWakeLifecycleId: existing.targetWakeLifecycleId,
  };
}
function resolveHandledOpenMeldToolsUpdateTargetVersion(
  result: OpenMeldToolsControlResult
): string | null {
  if (result.operation !== "request_update") {
    return null;
  }
  if (result.result.status === "current") {
    return result.result.currentVersion;
  }
  if (
    result.result.status === "started" ||
    result.result.status === "already_running"
  ) {
    return result.result.operation.targetVersion;
  }
  return null;
}
type AutomaticToolsUpdateUnavailableRetry = {
  attempts: number;
  daemonSessionId: string;
  retryAtMs: number;
  targetVersion: string;
};
type StoredAutomaticToolsUpdateUnavailableRetry =
  AutomaticToolsUpdateUnavailableRetry & {
    computerKey: string;
    v: 1;
  };
type AutomaticToolsUpdateCoalescingMarker = {
  daemonSessionId: string;
  requestId: string;
  targetVersion: string;
};
function resolveAutomaticToolsUpdateUnavailableRetryDelayMs(
  attempts: number
): number {
  const index = Math.min(
    Math.max(attempts - 1, 0),
    AUTOMATIC_TOOLS_UPDATE_UNAVAILABLE_RETRY_DELAYS_MS.length - 1
  );
  return AUTOMATIC_TOOLS_UPDATE_UNAVAILABLE_RETRY_DELAYS_MS[index] ?? 0;
}
function buildAutomaticToolsUpdateUnavailableRetryStorageKey(
  computerKey: string,
  retry: Pick<
    AutomaticToolsUpdateUnavailableRetry,
    "daemonSessionId" | "targetVersion"
  >
): string {
  return `${AUTOMATIC_TOOLS_UPDATE_UNAVAILABLE_RETRY_STORAGE_PREFIX}${encodeURIComponent(computerKey)}:${encodeURIComponent(retry.daemonSessionId)}:${encodeURIComponent(retry.targetVersion)}`;
}
function parseStoredAutomaticToolsUpdateUnavailableRetry(
  value: unknown
): StoredAutomaticToolsUpdateUnavailableRetry | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const candidate =
    value as Partial<StoredAutomaticToolsUpdateUnavailableRetry>;
  if (
    candidate.v !== 1 ||
    typeof candidate.computerKey !== "string" ||
    candidate.computerKey.length === 0 ||
    typeof candidate.daemonSessionId !== "string" ||
    candidate.daemonSessionId.length === 0 ||
    typeof candidate.targetVersion !== "string" ||
    candidate.targetVersion.length === 0 ||
    !Number.isInteger(candidate.attempts) ||
    Number(candidate.attempts) < 1 ||
    !Number.isFinite(candidate.retryAtMs)
  ) {
    return null;
  }
  return candidate as StoredAutomaticToolsUpdateUnavailableRetry;
}

function requiredExecutionContextVersion(
  record: RuntimeCoordinatorHeadLifecycleRecord
): 2 | 3 | 4 | 5 | 6 {
  // A selected folder needs a Service that resolves folder ids; an older one
  // would otherwise run in its default folder.
  const executionContext = record.acceptedDispatchSnapshot?.executionContext;
  if (executionContext?.folderId || executionContext?.forkSource?.folderId) {
    return 6;
  }
  if (
    record.acceptedDispatchSnapshot?.executionContext?.projectWork?.commit ||
    record.acceptedDispatchSnapshot?.workHandoffVersion === 2
  ) {
    return 5;
  }
  if (record.acceptedDispatchSnapshot?.executionContext?.projectWork) {
    return 4;
  }
  if (
    record.acceptedDispatchSnapshot?.controllerSnapshot.agentControllerRef ===
      "builtin:claude-code" &&
    record.acceptedDispatchSnapshot.executionContext?.access === "workspace"
  ) {
    return 3;
  }
  return 2;
}
export class RuntimeTransportHub extends DurableObject<CoreBindings> {
  private readonly state = createRuntimeTransportHubMutableState();
  // The published CLI release decides accepted Service epochs and update
  // policy. Loaded before this instance handles any event, then refreshed.
  private localComponentsRelease: CoreLocalComponentsRelease =
    UNAVAILABLE_LOCAL_COMPONENTS_RELEASE;
  private readonly currentDeviceOperationWaiters = new Map<
    string,
    CurrentDeviceOperationWaiter
  >();
  private readonly automaticToolsUpdateTargetByComputer = new Map<
    string,
    AutomaticToolsUpdateCoalescingMarker
  >();
  // This is only a retry throttle, not update state. It is persisted so DO
  // hibernation cannot restart a heartbeat storm; a new daemon session or
  // release target still bypasses the prior failure immediately.
  private readonly automaticToolsUpdateUnavailableRetryByComputer = new Map<
    string,
    AutomaticToolsUpdateUnavailableRetry
  >();
  private readonly routeCatalogReconciliationSignalsBySessionKey = new Map<
    string,
    RouteCatalogReconciliationSignalState
  >();
  private pendingAgentReadinessInvalidationsByReason = new Map<
    string,
    Set<string>
  >();
  private liveInvalidationFlushTimer: ReturnType<typeof setTimeout> | null =
    null;
  private pendingWakeProgressInvalidationsBySpaceId = new Map<
    string,
    {
      agentProfileIds: Set<string>;
      clientMessageIds: Set<string>;
      failedAttempts: number;
    }
  >();
  private readonly expectedRouteReconciliationReadCacheBySessionKey = new Map<
    string,
    ExpectedRouteReconciliationReadCacheState
  >();
  private readonly orderedDispatchFrameTails = new Map<string, Promise<void>>();
  private readonly pendingReasoningDispatches = new Set<string>();
  private readonly runtimeCoordinatorFinalizationTails = new Map<
    string,
    Promise<void>
  >();
  private readonly runtimeCoordinatorFinalizationRecoveryTails = new Map<
    string,
    Promise<RuntimeCoordinatorFinalizationRecoveryResult>
  >();
  private scheduledHousekeepingAlarmAtMs: number | null | undefined;
  private reasoningStreamEnabled = true;
  async rpcSpacePreferences(
    input: Partial<SpacePreferences>
  ): Promise<SpacePreferences> {
    if (input.automaticWakeEnabled !== undefined) {
      const preference = spacePreferencesSchema.parse(input);
      await this.ctx.storage.put("space-preferences", preference);
      return preference;
    }
    const stored =
      await this.ctx.storage.get<SpacePreferences>("space-preferences");
    return stored === undefined
      ? { automaticWakeEnabled: true }
      : spacePreferencesSchema.parse(stored);
  }
  async rpcReasoningPreferences(
    input: Omit<LocalAgentReasoningPreferencesRpc, "context">
  ): Promise<LocalAgentReasoningPreferences> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      if (input.enabled !== undefined) {
        const preference = localAgentReasoningPreferencesSchema.parse(input);
        if (preference.enabled) {
          await this.clearPendingReasoningReplay();
        }
        await this.ctx.storage.put(
          "local-agent-reasoning-preferences",
          preference
        );
        this.reasoningStreamEnabled = preference.enabled;
        for (const session of this.state.sessionsById.values()) {
          if (session.socket) {
            this.sendReasoningPreference(session.socket);
          }
        }
        if (!preference.enabled) {
          await this.clearPendingReasoningReplay();
        }
      }
      return { enabled: this.reasoningStreamEnabled };
    });
  }
  private sendReasoningPreference(socket: WebSocket): void {
    if (readRuntimeTransportSocketAttachment(socket).reasoningStream) {
      this.sendFrame(socket, {
        code: "daemon.reasoning.preferences",
        payload: { enabled: this.reasoningStreamEnabled },
      });
    }
  }
  private async clearPendingReasoningReplay(): Promise<void> {
    const targets = new Map<
      string,
      {
        spaceId: string;
        profileId: string;
      }
    >();
    for (const pending of this.state.pendingDispatches.values()) {
      targets.set(JSON.stringify([pending.spaceId, pending.profileId]), {
        spaceId: pending.spaceId,
        profileId: pending.profileId,
      });
    }
    await Promise.all(
      [...targets.values()].map(async (target) => {
        const space = resolveSpaceStub(
          this.env.OPENMELD_SPACES,
          target.spaceId
        );
        if (!space) {
          throw new Error("reasoning.replay_space_unavailable");
        }
        await space.rpcClearReasoningReplay(target);
      })
    );
  }
  constructor(ctx: DurableObjectState, env: CoreBindings) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      await this.refreshLocalComponentsRelease();
      const reasoningPreference = await this.ctx.storage.get(
        "local-agent-reasoning-preferences"
      );
      this.reasoningStreamEnabled =
        reasoningPreference === undefined
          ? true
          : localAgentReasoningPreferencesSchema.parse(reasoningPreference)
              .enabled;
      const restoredRecords = await restoreServiceRuntimeRecords(
        this.ctx,
        this.state
      );
      await this.restoreAutomaticToolsUpdateUnavailableRetries();
      const adoptedSockets = adoptHibernatedSockets(this.ctx, this.state, {
        closeSocket: safeCloseSocket,
      });
      await this.observeComputerConnectionIncidents();
      this.reapExpiredLeases(Date.now());
      if (restoredRecords.needsPersist || adoptedSockets.needsPersist) {
        await persistServiceRuntimeRecordsNow(this.ctx, this.state);
      }
      await this.syncHousekeepingAlarm();
    });
    // Hibernation-safe transport keepalive: auto-answer the daemon-stream PING
    // with PONG without waking the DO, so the gateway-pass-through connection
    // chain never goes idle and gets evicted. Idle eviction surfaced as
    // code=1006 stream drops and periodic agent available<->offline flapping.
    // DO-global, applies to all current + future hibernation sockets, persists
    // across hibernation so the runtime answers while the DO sleeps. Keepalive
    // never refreshes a lease, writes readiness, or touches liveness authority
    // (the bare ping never reaches webSocketMessage in production; the test
    // fallback there also answers without parsing it as a frame).
    // biome-ignore lint/correctness/noUndeclaredVariables: Provided by the Workers runtime.
    const keepalivePair = new WebSocketRequestResponsePair(
      DAEMON_STREAM_KEEPALIVE_PING,
      DAEMON_STREAM_KEEPALIVE_PONG
    );
    this.ctx.setWebSocketAutoResponse(keepalivePair);
  }
  async alarm(): Promise<void> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const nowMs = Date.now();
      if (!(await this.getAlarmFailureBackoff().canRun("alarm", nowMs))) {
        const retryAtMs = await this.getAlarmFailureBackoff().retryAt("alarm");
        if (retryAtMs !== null) {
          const alarmAtMs = Math.max(nowMs + 1000, retryAtMs);
          await this.ctx.storage.setAlarm(alarmAtMs);
          this.scheduledHousekeepingAlarmAtMs = alarmAtMs;
        }
        return;
      }
      const run = this.createHousekeepingAlarmRun(nowMs);
      this.scheduledHousekeepingAlarmAtMs = null;
      try {
        await this.runHousekeepingAlarmPhase(
          run,
          "computer_connection_incidents",
          () => this.observeComputerConnectionIncidents(true)
        );
        this.reapExpiredLeases(nowMs);
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_finalization_retry",
          () => this.processRuntimeCoordinatorFinalizationRetryAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(run, "context_migration", () =>
          this.processAgentProfileContextMigrationAlarm(run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_agent_profile_work_promotion",
          () => this.processAgentProfileWorkPromotionAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_agent_profile_work_recovery_inbox",
          () => this.processAgentProfileWorkRecoveryInboxAlarm(run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_watchdog",
          () => this.processRuntimeCoordinatorWatchdogAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_head_accepted_handoff",
          () =>
            this.processRuntimeCoordinatorHeadAcceptedHandoffAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_head_waiting",
          () => this.processRuntimeCoordinatorHeadWaitingAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_head_failure_publication",
          () =>
            this.processRuntimeCoordinatorHeadFailurePublicationRetryAlarm(
              nowMs,
              run
            )
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_pre_execution_handoff",
          () =>
            this.processRuntimeCoordinatorPreExecutionHandoffAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "local_agent_stream_closure_retry",
          () => this.processLocalAgentStreamClosureRetryAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_agent_task_observation_delivery",
          () =>
            this.processRuntimeCoordinatorAgentTaskObservationDeliveryAlarm(
              nowMs,
              run
            )
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_stopped_task_projection",
          () =>
            this.processRuntimeCoordinatorStoppedTaskProjectionAlarm(nowMs, run)
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_interaction_inbox_projection",
          () =>
            this.processRuntimeCoordinatorInteractionInboxRepairAlarm(
              nowMs,
              run
            )
        );
        await this.runHousekeepingAlarmPhase(
          run,
          "runtime_coordinator_agent_profile_execution_index",
          () =>
            this.processRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm(
              nowMs,
              run
            )
        );
      } catch (error) {
        this.requestHousekeepingAlarmContinuation(
          run,
          "runtime_coordinator.housekeeping_alarm_failed"
        );
        console.warn("[core.runtime_transport.housekeeping_alarm_failed]", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await this.settleHousekeepingAlarmRun(run);
      }
    });
  }
  async rpcReplayRuntimeCoordinatorFinalizationCommand(
    input: ReplayRuntimeCoordinatorFinalizationCommandInput
  ): Promise<ReplayRuntimeCoordinatorFinalizationCommandResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const result =
        await this.replayRuntimeCoordinatorFinalizationCommand(input);
      if (result.ok) {
        return "outcome" in result
          ? { ok: true, outcome: result.outcome }
          : {
              ok: true,
              reasonCode: "runtime_coordinator.wake_stop_requested",
              status: "suppressed",
            };
      }
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    });
  }

  async rpcAuthorizeExecutionAccess(
    input: ReturnType<
      typeof runtimeCoordinatorExecutionAccessRequestSchema.parse
    >
  ) {
    const request = runtimeCoordinatorExecutionAccessRequestSchema.parse(input);
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      request.executionTokenEcho.runtimeCoordinatorExecutionId
    );
    const validation =
      await validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        ...request,
        authority,
        nowMs: Date.now(),
      });
    return runtimeCoordinatorExecutionAccessResponseSchema.parse(
      validation.ok
        ? { allowed: true }
        : { allowed: false, reasonCode: validation.reasonCode }
    );
  }

  /**
   * Resolves a task credential (the task's execution token) to its execution
   * and the root of that Wake's frozen request chain. Only an active token of
   * an execution in this owner's shard is valid; the root always comes from
   * the accepted assignment, never from the caller.
   */
  async rpcResolveTaskCredential(
    input: RuntimeCoordinatorExecutionTokenEcho
  ): Promise<TaskCredentialResolution> {
    const echo = runtimeCoordinatorExecutionTokenEchoSchema.safeParse(input);
    if (!echo.success) {
      return { reasonCode: "execution_token_missing", status: "rejected" };
    }
    const executionId = echo.data.runtimeCoordinatorExecutionId;
    const authority =
      await this.readRuntimeCoordinatorTokenAuthority(executionId);
    const validation =
      await validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority,
        executionTokenEcho: echo.data,
        nowMs: Date.now(),
      });
    if (!(validation.ok && authority)) {
      return {
        reasonCode: validation.ok
          ? "execution_token_authority_missing"
          : validation.reasonCode,
        status: "rejected",
      };
    }
    const commandState =
      await this.readRuntimeCoordinatorRunCommandState(executionId);
    if (!commandState) {
      return {
        reasonCode: "task_credential.execution_unavailable",
        status: "rejected",
      };
    }
    const payload = commandState.sanitizedDeliveryRequest.payload;
    const head = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      projectTargetWakeLifecycleIdentity({
        clientMessageId: commandState.sourceClientMessageId,
        dispatchId: commandState.dispatchId,
        sourceSignalId: payload.sourceEventId,
        spaceId: payload.spaceId,
        targetProfileId: commandState.targetProfileId,
      }).targetWakeLifecycleId
    );
    const snapshot = head?.acceptedDispatchSnapshot;
    const root = (snapshot?.executionContext?.requestChain ??
      snapshot?.contextRequest?.requestChain)?.[0];
    return taskCredentialResolutionSchema.parse({
      openMeldServiceRuntimeId:
        authority.authorityScope.openMeldServiceRuntimeId,
      rootProfileId: root?.kind === "human" ? root.profileId : null,
      runtimeCoordinatorExecutionId: executionId,
      status: "valid",
      targetProfileId: authority.executionScope.targetProfileId,
    });
  }

  /** The owner's running tasks with chain roots (decision 5a0). */
  async rpcReadRiskWindowExecutions(input: {
    ownerUserId: string;
  }): Promise<RiskWindowExecutionsResponse> {
    const response = await readRuntimeCoordinatorRiskWindowExecutions({
      nowMs: Date.now(),
      ownerUserId: input.ownerUserId,
      storage: this.ctx.storage,
    });
    if (response.status === "unavailable") {
      this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
    }
    return riskWindowExecutionsResponseSchema.parse(response);
  }

  async rpcReadPluginConnectionExecutionSource(
    raw: PluginConnectionExecutionSourceRequest
  ) {
    const parsed = pluginConnectionExecutionSourceRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { source: null };
    }
    const state = await this.readRuntimeCoordinatorRunCommandState(
      parsed.data.executionId
    );
    return pluginConnectionExecutionSourceResponseSchema.parse({
      source: projectPluginConnectionExecutionSource(parsed.data, state),
    });
  }

  async rpcReadAgentProfileExecutionState(
    input: RuntimeTransportAgentProfileExecutionStateRequest
  ): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileExecutionStateRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return {
          reasonCode: "runtime_coordinator.execution_state_request_invalid",
          status: "unavailable",
        };
      }
      const response =
        await readRuntimeCoordinatorAgentProfileExecutionStateFromAdmission({
          nowMs: Date.now(),
          ownerUserId: parsed.data.ownerUserId,
          storage: this.ctx.storage,
          targetProfileId: parsed.data.targetProfileId,
        });
      if (
        response.status === "unavailable" &&
        (response.reasonCode ===
          "runtime_coordinator.execution_state_rebuilding" ||
          response.reasonCode ===
            "runtime_coordinator.execution_state_repair_failed")
      ) {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      return runtimeTransportAgentProfileExecutionStateResponseSchema.parse(
        response
      );
    });
  }
  async rpcReadAgentProfileOperationalContexts(
    input: RuntimeTransportAgentProfileOperationalContextsRequest
  ): Promise<RuntimeTransportAgentProfileOperationalContextsResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileOperationalContextsRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return { contexts: [] };
      }
      const response =
        await readRuntimeCoordinatorAgentProfileOperationalContextsFromAdmission(
          {
            includeWorkReferences: parsed.data.includeWorkReferences,
            nowMs: Date.now(),
            ownerUserId: parsed.data.ownerUserId,
            storage: this.ctx.storage,
            targetProfileIds: parsed.data.targetProfileIds,
          }
        );
      if (
        response.contexts.some(
          ({ operationalContext }) =>
            operationalContext.status === "checking" &&
            (operationalContext.reasonCode ===
              "runtime_coordinator.execution_state_rebuilding" ||
              operationalContext.reasonCode ===
                "runtime_coordinator.execution_state_repair_failed")
        )
      ) {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      return runtimeTransportAgentProfileOperationalContextsResponseSchema.parse(
        response
      );
    });
  }
  async rpcMarkAgentProfileWorkUsageAvailable(
    input: RuntimeTransportAgentProfileWorkUsageAvailableRequest
  ): Promise<RuntimeTransportAgentProfileWorkUsageAvailableResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileWorkUsageAvailableRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return {
          changedProfileIds: [],
          continuationProfileIds: [],
          status: "unavailable",
        };
      }
      const nowMs = Date.now();
      const response =
        await markRuntimeCoordinatorAgentProfileWorkUsageAvailable({
          nowMs,
          ownerUserId: parsed.data.ownerUserId,
          storage: this.ctx.storage,
          targetProfileIds: parsed.data.targetProfileIds,
        });
      if (response.status === "unavailable") {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      if (response.changedProfileIds.length > 0) {
        this.publishAgentReadinessInvalidated({
          profileIds: response.changedProfileIds,
          reason: "agent_profile_work_coordinator.changed",
        });
      }
      return runtimeTransportAgentProfileWorkUsageAvailableResponseSchema.parse(
        {
          changedProfileIds: response.changedProfileIds,
          continuationProfileIds: response.continuationProfileIds,
          status: response.status,
        }
      );
    });
  }
  async rpcReadAgentProfileWorkRecovery(
    input: RuntimeTransportAgentProfileWorkRecoveryReadRequest
  ): Promise<RuntimeTransportAgentProfileWorkRecoveryReadResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileWorkRecoveryReadRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return { status: "unavailable" };
      }
      const response =
        await readRuntimeCoordinatorAgentProfileWorkRecoveryFromAdmission({
          nowMs: Date.now(),
          ownerUserId: parsed.data.ownerUserId,
          storage: this.ctx.storage,
          targetProfileId: parsed.data.targetProfileId,
        });
      if (response.status === "unavailable") {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      return runtimeTransportAgentProfileWorkRecoveryReadResponseSchema.parse(
        response
      );
    });
  }
  async rpcAuthorizeAgentProfileWorkContinuation(
    input: RuntimeTransportAgentProfileWorkContinuationAuthorizeRequest
  ): Promise<RuntimeTransportAgentProfileWorkContinuationAuthorizeResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return { status: "unavailable" };
      }
      const response =
        await authorizeRuntimeCoordinatorAgentProfileWorkContinuation({
          continuationClientMessageId: parsed.data.continuationClientMessageId,
          requesterProfileId: parsed.data.requesterProfileId,
          currentAgentControllerRef: parsed.data.currentAgentControllerRef,
          currentBindingId: parsed.data.currentBindingId,
          currentConfigurationRevision:
            parsed.data.currentConfigurationRevision,
          currentDefaultProjectId: parsed.data.currentDefaultProjectId,
          expectedInterruptedTargetWakeLifecycleId:
            parsed.data.expectedInterruptedTargetWakeLifecycleId,
          forkInterruptedConversation: parsed.data.forkInterruptedConversation,
          requireAutomaticForkEligibility:
            parsed.data.requireAutomaticForkEligibility,
          nowMs: Date.now(),
          ownerUserId: parsed.data.ownerUserId,
          storage: this.ctx.storage,
          targetProfileId: parsed.data.targetProfileId,
        });
      if (response.status === "unavailable") {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      if (
        response.status === "authorized" ||
        response.status === "needs_attention"
      ) {
        this.publishAgentReadinessInvalidated({
          profileIds: [parsed.data.targetProfileId],
          reason: "agent_profile_work_coordinator.changed",
        });
        if (response.status === "needs_attention") {
          this.scheduledHousekeepingAlarmAtMs = undefined;
        }
        if (response.status === "authorized" && response.interruptedExecution) {
          await this.stopSupersededInterruptedExecution({
            interruptedExecution: response.interruptedExecution,
            ownerUserId: parsed.data.ownerUserId,
            targetProfileId: parsed.data.targetProfileId,
          });
        }
      }
      // The stop target is Coordinator control state, not part of the public
      // answer. Returning the whole internal result would fail this strict
      // contract after the authorization has already been committed.
      return runtimeTransportAgentProfileWorkContinuationAuthorizeResponseSchema.parse(
        { status: response.status }
      );
    });
  }
  private async stopSupersededInterruptedExecution(input: {
    interruptedExecution: {
      dispatchId: string;
      runtimeCoordinatorExecutionId: string;
    };
    ownerUserId: string;
    targetProfileId: string;
  }): Promise<void> {
    const oldExecutionId =
      input.interruptedExecution.runtimeCoordinatorExecutionId;
    const oldCommandState = await this.readRuntimeCoordinatorRunCommandState(
      oldExecutionId
    ).catch(() => null);
    if (!oldCommandState) {
      return;
    }
    await this.requestRuntimeCoordinatorWakeStop({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: input.ownerUserId,
      runtimeCoordinatorExecutionId: oldExecutionId,
      dispatchId: oldCommandState.dispatchId,
      spaceId: oldCommandState.sanitizedDeliveryRequest.payload.spaceId,
      sourceClientMessageId: oldCommandState.sourceClientMessageId,
      targetProfileId: input.targetProfileId,
      reason: "superseded_by_continuation",
    }).catch(() => null);
    await this.requestRuntimeCoordinatorLocalAttemptWithdrawal({
      commandState: oldCommandState,
      controlReason: "superseded_by_continuation",
      nowMs: Date.now(),
      reasonCode:
        RUNTIME_COORDINATOR_LOCAL_ATTEMPT_WITHDRAWAL_SUPERSEDED_REASON_CODE,
    });
  }
  /**
   * Asks the computer to withdraw one attempt and records that it was asked.
   *
   * The control frame is best effort, so the durable request is what lets a
   * later acknowledgement be recognized and lets an unconfirmed withdrawal stay
   * visible instead of being assumed successful. A Service that is away keeps
   * its own reason rather than looking like a delivered request.
   */
  private async requestRuntimeCoordinatorLocalAttemptWithdrawal(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    controlReason: string;
    nowMs: number;
    reasonCode: string;
  }): Promise<void> {
    const session = this.state.sessionsById.get(
      input.commandState.sanitizedDeliveryRequest.daemonSessionId
    );
    let delivered = false;
    if (session?.socket) {
      try {
        this.sendFrame(session.socket, {
          code: "daemon.local_agent_control.cancel",
          payload: {
            requestId: buildRuntimeCoordinatorWakeStopControlRequestId(
              input.commandState.runtimeCoordinatorExecutionId
            ),
            payload: {
              runtimeCoordinatorExecutionId:
                input.commandState.runtimeCoordinatorExecutionId,
              target: {
                by: "task",
                taskId:
                  input.commandState.sanitizedDeliveryRequest.payload.taskId,
              },
              reason: input.controlReason,
            },
          },
        });
        delivered = true;
      } catch {
        // Socket send failure is best effort; the durable request records it.
      }
    }
    const requested =
      await requestRuntimeCoordinatorLocalAttemptWithdrawalInStorage({
        activeRunId: input.commandState.activeRunId,
        nowMs: input.nowMs,
        reasonCode: delivered
          ? input.reasonCode
          : RUNTIME_COORDINATOR_LOCAL_ATTEMPT_WITHDRAWAL_SERVICE_AWAY_REASON_CODE,
        runtimeCoordinatorExecutionId:
          input.commandState.runtimeCoordinatorExecutionId,
        storage: this.ctx.storage,
      }).catch((error) => {
        console.warn(
          "[core.runtime_transport.local_attempt_withdrawal_request_unrecorded]",
          {
            error: error instanceof Error ? error.message : String(error),
            reasonCode: input.reasonCode,
            runtimeCoordinatorExecutionId:
              input.commandState.runtimeCoordinatorExecutionId,
          }
        );
        return null;
      });
    if (requested) {
      this.publishWakeProgressChanged({
        agentProfileId: requested.targetProfileId,
        clientMessageId: requested.sourceClientMessageId,
        spaceId: requested.sanitizedDeliveryRequest.payload.spaceId,
      });
    }
  }
  async rpcHandOffOccupiedAgentProfileWork(
    input: RuntimeTransportAgentProfileWorkHandoffRequest
  ): Promise<RuntimeTransportAgentProfileWorkHandoffResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileWorkHandoffRequestSchema.safeParse(input);
      if (!parsed.success) {
        return { status: "unavailable" };
      }
      const response = await handOffRuntimeCoordinatorOccupiedAgentProfileWork({
        nowMs: Date.now(),
        ownerUserId: parsed.data.ownerUserId,
        sourceDispatchId: parsed.data.sourceDispatchId,
        sourceTargetWakeLifecycleId: parsed.data.sourceTargetWakeLifecycleId,
        storage: this.ctx.storage,
        successorDispatchId: parsed.data.successorDispatchId,
        successorExecutionContextId: parsed.data.successorExecutionContextId,
        successorTargetWakeLifecycleId:
          parsed.data.successorTargetWakeLifecycleId,
        targetProfileId: parsed.data.targetProfileId,
      });
      if (response.status === "unavailable") {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      if (response.status === "handed_off") {
        this.publishAgentReadinessInvalidated({
          profileIds: [parsed.data.targetProfileId],
          reason: "agent_profile_work_coordinator.changed",
        });
      }
      return runtimeTransportAgentProfileWorkHandoffResponseSchema.parse(
        response
      );
    });
  }
  async rpcMarkAgentProfileWorkContinuationNeedsAttention(
    input: RuntimeTransportAgentProfileWorkContinuationNeedsAttentionRequest
  ): Promise<RuntimeTransportAgentProfileWorkContinuationNeedsAttentionResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileWorkContinuationNeedsAttentionRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return { status: "unavailable" };
      }
      const response =
        await markRuntimeCoordinatorAgentProfileWorkContinuationNeedsAttention({
          expectedInterruptedTargetWakeLifecycleId:
            parsed.data.expectedInterruptedTargetWakeLifecycleId,
          nowMs: Date.now(),
          ownerUserId: parsed.data.ownerUserId,
          storage: this.ctx.storage,
          targetProfileId: parsed.data.targetProfileId,
        });
      if (response.status === "unavailable") {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      if (response.status === "marked") {
        this.publishAgentReadinessInvalidated({
          profileIds: [parsed.data.targetProfileId],
          reason: "agent_profile_work_coordinator.changed",
        });
        this.scheduledHousekeepingAlarmAtMs = undefined;
      }
      return runtimeTransportAgentProfileWorkContinuationNeedsAttentionResponseSchema.parse(
        response
      );
    });
  }
  async rpcApproveAgentProfileWorkQueue(
    input: RuntimeTransportAgentProfileWorkQueueApproveRequest
  ): Promise<RuntimeTransportAgentProfileWorkQueueApproveResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileWorkQueueApproveRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return { status: "unavailable" };
      }
      const response = await approveRuntimeCoordinatorAgentProfileWorkQueue({
        expectedInterruptedTargetWakeLifecycleId:
          parsed.data.expectedInterruptedTargetWakeLifecycleId,
        nowMs: Date.now(),
        ownerUserId: parsed.data.ownerUserId,
        storage: this.ctx.storage,
        targetProfileId: parsed.data.targetProfileId,
      });
      if (response.status === "unavailable") {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      if (response.status === "approved") {
        this.publishAgentReadinessInvalidated({
          profileIds: [parsed.data.targetProfileId],
          reason: "agent_profile_work_coordinator.changed",
        });
        this.scheduledHousekeepingAlarmAtMs = undefined;
      }
      if (response.pendingPromotion) {
        await this.requestSpaceDispatchOutboxRedriveForPromotion(
          response.pendingPromotion,
          "terminal_transaction"
        );
      }
      return runtimeTransportAgentProfileWorkQueueApproveResponseSchema.parse({
        status: response.status,
      });
    });
  }
  /**
   * Asks the computer again to withdraw the attempt a continuation replaces.
   *
   * Recovery consults this on every attempt instead of trusting that the
   * cancellation sent with the first authorization landed. A stored decision is
   * not evidence, and the honest answer while nothing has confirmed is
   * `requested`, never a silent permission to start replacement work.
   */
  async rpcRequestAgentProfileWorkLocalAttemptWithdrawal(
    input: RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalRequest
  ): Promise<RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, () =>
      RuntimeTransportHub.#executeRpcRequestAgentProfileWorkLocalAttemptWithdrawal(
        this,
        input
      )
    );
  }
  static async #executeRpcRequestAgentProfileWorkLocalAttemptWithdrawal(
    owner: RuntimeTransportHub,
    input: RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalRequest
  ): Promise<RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalResponse> {
    const parsed =
      runtimeTransportAgentProfileWorkLocalAttemptWithdrawalRequestSchema.safeParse(
        input
      );
    if (!parsed.success) {
      return { status: "unavailable" };
    }
    const recovery =
      await readRuntimeCoordinatorAgentProfileWorkRecoveryFromAdmission({
        nowMs: Date.now(),
        ownerUserId: parsed.data.ownerUserId,
        storage: owner.ctx.storage,
        targetProfileId: parsed.data.targetProfileId,
      });
    if (recovery.status === "unavailable") {
      owner.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      return { status: "unavailable" };
    }
    const interruptedTargetWakeLifecycleId =
      recovery.status === "available"
        ? recovery.interruptedTargetWakeLifecycleId
        : undefined;
    if (
      !interruptedTargetWakeLifecycleId ||
      interruptedTargetWakeLifecycleId !==
        parsed.data.expectedInterruptedTargetWakeLifecycleId
    ) {
      return { status: "not_pending" };
    }
    // The recovery read already resolved this from an authoritative head, so
    // both settled answers come from there. Rereading the head is only how this
    // call addresses the attempt it still has to ask about.
    if (recovery.status === "available") {
      if (recovery.interruptedLocalAttempt === "withdrawn") {
        return { status: "withdrawn" };
      }
      if (recovery.interruptedLocalAttempt === "not_started") {
        return { status: "not_started" };
      }
    }
    const head = await owner
      .readRuntimeCoordinatorHeadLifecycleRecord(
        interruptedTargetWakeLifecycleId
      )
      .catch((error: unknown) => {
        console.warn(
          "[core.runtime_transport.local_attempt_withdrawal_head_unreadable]",
          { error, targetWakeLifecycleId: interruptedTargetWakeLifecycleId }
        );
        return null;
      });
    const executionId = head?.runtimeCoordinatorExecutionId;
    if (!executionId) {
      // A head that cannot be read is not a head that never started work.
      // Answering `not_started` here would turn a read failure into permission
      // to run the same instruction again.
      return { status: "unavailable" };
    }
    const commandState = await owner
      .readRuntimeCoordinatorRunCommandState(executionId)
      .catch(() => null);
    if (!commandState) {
      // Without the delivery record Core cannot address the attempt, so it
      // reports the withdrawal as outstanding rather than assuming either way.
      return { status: "requested" };
    }
    await owner.requestRuntimeCoordinatorLocalAttemptWithdrawal({
      commandState,
      controlReason: "superseded_by_continuation",
      nowMs: Date.now(),
      reasonCode:
        RUNTIME_COORDINATOR_LOCAL_ATTEMPT_WITHDRAWAL_SUPERSEDED_REASON_CODE,
    });
    return runtimeTransportAgentProfileWorkLocalAttemptWithdrawalResponseSchema.parse(
      {
        status: isRuntimeCoordinatorLocalAttemptWithdrawn(commandState)
          ? "withdrawn"
          : "requested",
      }
    );
  }
  async rpcSkipAgentProfileInterruptedWork(
    input: RuntimeTransportAgentProfileWorkSkipRequest
  ): Promise<RuntimeTransportAgentProfileWorkSkipResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileWorkSkipRequestSchema.safeParse(input);
      if (!parsed.success) {
        return { status: "unavailable" };
      }
      const response = await skipRuntimeCoordinatorAgentProfileInterruptedWork({
        requesterProfileId: parsed.data.requesterProfileId,
        expectedInterruptedTargetWakeLifecycleId:
          parsed.data.expectedInterruptedTargetWakeLifecycleId,
        nowMs: Date.now(),
        ownerUserId: parsed.data.ownerUserId,
        storage: this.ctx.storage,
        targetProfileId: parsed.data.targetProfileId,
      });
      if (response.status === "unavailable") {
        this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
      }
      if (response.status === "skipped") {
        this.publishAgentReadinessInvalidated({
          profileIds: [parsed.data.targetProfileId],
          reason: "agent_profile_work_coordinator.changed",
        });
        this.scheduledHousekeepingAlarmAtMs = undefined;
      }
      if (response.pendingPromotion) {
        await this.requestSpaceDispatchOutboxRedriveForPromotion(
          response.pendingPromotion,
          "terminal_transaction"
        );
      }
      return runtimeTransportAgentProfileWorkSkipResponseSchema.parse({
        status: response.status,
      });
    });
  }
  async rpcCancelDeletedAgentProfileWakes(
    input: RuntimeTransportDeletedAgentProfileWakeCancellationRequest
  ): Promise<RuntimeTransportDeletedAgentProfileWakeCancellationResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportDeletedAgentProfileWakeCancellationRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        throw new Error(
          "runtime_coordinator.deleted_profile_wake_cancellation_request_invalid"
        );
      }
      const response = await cancelDeletedAgentProfileWakesWithPorts({
        request: parsed.data,
        ports: {
          readHeadLifecycleRecords: () =>
            this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex(),
          readRunCommandStates: () =>
            this.readRuntimeCoordinatorRunCommandStatesFromIndex(),
          stopHeadBeforeExecution: (request) =>
            this.recordRuntimeCoordinatorHeadPreAgentStop(request),
          stopRuntimeExecution: (request) =>
            this.requestRuntimeCoordinatorWakeStop(request),
        },
      });
      return runtimeTransportDeletedAgentProfileWakeCancellationResponseSchema.parse(
        response
      );
    });
  }
  // Keep the original ControllerMutation wire names during the broader
  // execution-target rollout. Durable Object code propagates eventually, so a
  // newly deployed Worker must remain callable against an older live shard and
  // an older Worker must remain callable against this shard.
  async rpcAcquireAgentProfileControllerMutation(
    input: RuntimeTransportAgentProfileExecutionTargetMutationRequest
  ): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      return await this.acquireAgentProfileMutation({
        acquire: acquireRuntimeCoordinatorAgentProfileExecutionTargetMutation,
        input,
      });
    });
  }
  async rpcAcquireAgentProfileFutureWorkSettingsMutation(
    input: RuntimeTransportAgentProfileExecutionTargetMutationRequest
  ): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      return await this.acquireAgentProfileMutation({
        acquire:
          acquireRuntimeCoordinatorAgentProfileFutureWorkSettingsMutation,
        input,
      });
    });
  }
  async rpcAgentProfileExecutionMode(
    input: RuntimeTransportAgentProfileExecutionModeRequest
  ): Promise<AgentProfileExecutionModeResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const request =
        runtimeTransportAgentProfileExecutionModeRequestSchema.parse(input);
      const response = await readOrUpdateAgentProfileExecutionMode({
        ...request,
        nowMs: Date.now(),
        storage: this.ctx.storage,
      });
      this.queueHousekeepingAlarmSync();
      return agentProfileExecutionModeResponseSchema.parse(response);
    });
  }
  async rpcAcquireAgentProfileLegacyConversationMutation(
    input: RuntimeTransportAgentProfileLegacyConversationMutationRequest
  ): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileLegacyConversationMutationRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return {
          reasonCode:
            "runtime_coordinator.execution_target_mutation_request_invalid",
          status: "unavailable",
        };
      }
      return this.settleAgentProfileMutationAcquire(
        await acquireRuntimeCoordinatorAgentProfileLegacyConversationMutation({
          agentControllerRef: parsed.data.agentControllerRef,
          nowMs: Date.now(),
          operationId: parsed.data.operationId,
          ownerUserId: parsed.data.ownerUserId,
          storage: this.ctx.storage,
          targetProfileId: parsed.data.targetProfileId,
        })
      );
    });
  }
  /**
   * Attempts one Profile's Context activation. A failure is recorded for that
   * Profile with its own backoff, so it never stops other Profiles' migrations
   * or the Wake acceptance that triggered the attempt, and later queued Wakes
   * wait out that backoff instead of retrying on every acceptance.
   */
  private async attemptAgentProfileContextMigration(input: {
    ownerUserId: string;
    targetProfileId: string;
  }): Promise<boolean> {
    if (
      !(await isAgentProfileContextMigrationRetryDue({
        nowMs: Date.now(),
        storage: this.ctx.storage,
        targetProfileId: input.targetProfileId,
      }))
    ) {
      return false;
    }
    try {
      return await this.reconcileAgentProfileContextMigration(input);
    } catch (error) {
      let reasonCode = String(error);
      if (error instanceof ExecutionContextSelectionError) {
        reasonCode = error.reasonCode;
      } else if (error instanceof Error) {
        reasonCode = error.message;
      }
      const failure = await recordAgentProfileContextMigrationFailure({
        nowMs: Date.now(),
        reasonCode,
        storage: this.ctx.storage,
        targetProfileId: input.targetProfileId,
      });
      console.warn("[core.runtime_transport.context_migration_failed]", {
        attempts: failure.attempts,
        nextAttemptAtMs: failure.nextAttemptAtMs,
        reasonCode: failure.reasonCode,
        targetProfileId: input.targetProfileId,
      });
      return false;
    }
  }
  private async reconcileAgentProfileContextMigration(input: {
    ownerUserId: string;
    targetProfileId: string;
  }): Promise<boolean> {
    const operationId = `context-migration:${crypto.randomUUID()}`;
    if (
      !(await acquireAgentProfileContextMigration({
        ...input,
        operationId,
        nowMs: Date.now(),
        storage: this.ctx.storage,
      }))
    ) {
      return false;
    }
    try {
      const db = getPostgresDatabase(this.env);
      if (!db) {
        throw new Error("execution_context.migration_binding_unavailable");
      }
      const owner = { id: input.ownerUserId, kind: "owner_account" as const };
      // Read current Binding only while the existing mutation lease fences
      // Controller changes and old-session attachment. Accepted snapshots are
      // evidence for individual work, never migration ownership authority.
      const binding = await readPrimaryAgentProfileBindingRecord({
        db,
        owner,
        agentProfileId: input.targetProfileId,
      });
      if (
        !binding ||
        binding.bindingState !== "enabled_primary" ||
        binding.runtimeKind !== "openmeld_service"
      ) {
        throw new Error("execution_context.migration_binding_unavailable");
      }
      if (
        binding.agentControllerConversationId &&
        (await readPrimaryAgentProfileBindingRecordByControllerConversation({
          db,
          owner,
          agentControllerRef: binding.agentControllerRef,
          agentControllerConversationId: binding.agentControllerConversationId,
          excludeAgentProfileId: input.targetProfileId,
        }))
      ) {
        throw new Error("execution_context.native_identity_conflict");
      }
      // Re-read the currently negotiated route after the asynchronous Binding
      // claim read, while its mutation lease still fences activation.
      if (
        this.resolveContextMigrationCapability({
          ...input,
          agentControllerRef: binding.agentControllerRef,
        })
      ) {
        return false;
      }
      return await activateAgentProfileContextMigration({
        ...input,
        operationId,
        association: legacyContextAssociationFromBinding(binding),
        nowMs: Date.now(),
        storage: this.ctx.storage,
      });
    } finally {
      await releaseRuntimeCoordinatorAgentProfileExecutionTargetMutation({
        ...input,
        operationId,
        nowMs: Date.now(),
        storage: this.ctx.storage,
      });
    }
  }
  private async refreshLocalComponentsRelease(): Promise<CoreLocalComponentsRelease> {
    this.localComponentsRelease = await readCoreLocalComponentsRelease(
      this.env.OPENMELD_CLI_RELEASES
    );
    return this.localComponentsRelease;
  }
  private resolveContextMigrationCapability(input: {
    allowPendingRoute?: boolean;
    ownerUserId: string;
    targetProfileId: string;
    agentControllerRef: string;
    requiredContextVersion?: 2 | 3 | 4 | 5 | 6 | 7;
    requirePermissionInheritance?: boolean;
  }): string | null {
    const route = lookupRoute(
      this.state,
      {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: input.ownerUserId,
        profileId: input.targetProfileId,
      },
      {
        persistRuntimeRecords: this.persistRuntimeRecords,
        cleanupExpiredPendingDispatches: this.cleanupExpiredPendingDispatches,
        recordReapedReadinessProfiles: this.publishReapedReadinessProfiles,
        localComponentsManifest: this.localComponentsRelease.manifest,
      }
    );
    if (!route.online || route.acceptingDispatches === false) {
      return input.allowPendingRoute
        ? null
        : "execution_context.service_capability_unavailable";
    }
    const adapterId = parseAgentControllerRef(input.agentControllerRef)?.id;
    return route.capabilities.runtimeAdapters?.some(
      (adapter) =>
        adapter.adapterId === adapterId &&
        (!input.requirePermissionInheritance ||
          adapter.capabilityDeclaration
            .executionContextPermissionInheritance === true) &&
        (adapter.capabilityDeclaration.executionContextVersion ?? 0) >=
          (input.requiredContextVersion ?? 2)
    )
      ? null
      : "service.update_required";
  }
  private async acquireAgentProfileMutation(input: {
    acquire: typeof acquireRuntimeCoordinatorAgentProfileExecutionTargetMutation;
    input: RuntimeTransportAgentProfileExecutionTargetMutationRequest;
  }): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
    const parsed =
      runtimeTransportAgentProfileExecutionTargetMutationRequestSchema.safeParse(
        input.input
      );
    if (!parsed.success) {
      return {
        reasonCode:
          "runtime_coordinator.execution_target_mutation_request_invalid",
        status: "unavailable",
      };
    }
    return this.settleAgentProfileMutationAcquire(
      await input.acquire({
        nowMs: Date.now(),
        operationId: parsed.data.operationId,
        ownerUserId: parsed.data.ownerUserId,
        storage: this.ctx.storage,
        targetProfileId: parsed.data.targetProfileId,
      })
    );
  }
  private settleAgentProfileMutationAcquire(
    response: RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse
  ): RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse {
    if (
      response.status === "unavailable" &&
      (response.reasonCode ===
        "runtime_coordinator.execution_state_rebuilding" ||
        response.reasonCode ===
          "runtime_coordinator.execution_state_repair_failed")
    ) {
      this.queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm();
    }
    return runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema.parse(
      response
    );
  }
  async rpcReleaseAgentProfileControllerMutation(
    input: RuntimeTransportAgentProfileExecutionTargetMutationRequest
  ): Promise<RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportAgentProfileExecutionTargetMutationRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        return { status: "not_owner" };
      }
      const response =
        await releaseRuntimeCoordinatorAgentProfileExecutionTargetMutation({
          nowMs: Date.now(),
          operationId: parsed.data.operationId,
          ownerUserId: parsed.data.ownerUserId,
          storage: this.ctx.storage,
          targetProfileId: parsed.data.targetProfileId,
        });
      return runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema.parse(
        response
      );
    });
  }
  async rpcInspectHostedExecutionRecovery(
    input: HostedExecutionRecoveryInspectRequest
  ) {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const db = getPostgresDatabase(this.env);
      if (!db) {
        throw new Error("execution_recovery.storage_unavailable");
      }
      return await inspectHostedExecutionRecovery({
        db,
        env: this.env,
        request: input,
      });
    });
  }
  async rpcExecuteHostedExecutionRecovery(
    input: HostedExecutionRecoveryExecuteRequest
  ) {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const db = getPostgresDatabase(this.env);
      if (!db) {
        throw new Error("execution_recovery.storage_unavailable");
      }
      return await executeHostedExecutionRecovery({
        db,
        env: this.env,
        request: input,
        storage: this.ctx.storage,
      });
    });
  }
  async rpcInspectExecutionRecovery(
    input: RuntimeTransportInspectExecutionRecoveryRequest
  ): Promise<RuntimeTransportInspectExecutionRecoveryResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportInspectExecutionRecoveryRequestSchema.safeParse(input);
      if (!parsed.success) {
        return {
          exactAssociationVerified: false,
          identity: null,
          reasonCode: "execution_recovery.invalid_request",
          serviceSupportsResume: false,
          status: "unavailable",
        };
      }
      const association = await this.resolveExecutionRecoveryAssociation(
        parsed.data
      );
      const response: RuntimeTransportInspectExecutionRecoveryResponse =
        association.ok
          ? {
              exactAssociationVerified: true,
              identity: association.identity,
              reasonCode:
                "execution_recovery.exact_controller_conversation_available",
              serviceSupportsResume: true,
              status: "available",
            }
          : {
              exactAssociationVerified: association.exactAssociationVerified,
              identity: association.identity,
              reasonCode: association.reasonCode,
              serviceSupportsResume: association.serviceSupportsResume,
              status: "unavailable",
            };
      return runtimeTransportInspectExecutionRecoveryResponseSchema.parse(
        response
      );
    });
  }
  async rpcRedriveAgentTaskObservation(
    input: AgentTaskObservationRedriveQueueMessage
  ): Promise<{
    status: "already_projected" | "projected";
  }> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed = agentTaskObservationRedriveQueueMessageSchema.parse(input);
      const delivery =
        await upsertRuntimeCoordinatorAgentTaskObservationDelivery(
          this.ctx.storage,
          {
            nowMs: parsed.enqueuedAtMs,
            observation: parsed.observation,
            runtimeCoordinatorExecutionId: parsed.runtimeCoordinatorExecutionId,
            task: parsed.task,
          }
        );
      if (delivery.deliveryId !== parsed.deliveryId) {
        throw new Error(
          "runtime_coordinator.agent_task_observation_delivery_conflict"
        );
      }
      if (delivery.status === "projected") {
        return { status: "already_projected" };
      }
      await this.projectRuntimeCoordinatorAgentTaskObservationDelivery(
        delivery
      );
      return { status: "projected" };
    });
  }
  async rpcResumeControllerConversation(
    input: RuntimeTransportResumeControllerConversationRequest
  ): Promise<RuntimeTransportResumeControllerConversationResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const parsed =
        runtimeTransportResumeControllerConversationRequestSchema.safeParse(
          input
        );
      if (!parsed.success) {
        throw new Error("execution_recovery.invalid_request");
      }
      const association = await this.resolveExecutionRecoveryAssociation(
        parsed.data
      );
      if (!association.ok) {
        return {
          destination: parsed.data.destination,
          identity: parsed.data.identity,
          message: association.reasonCode,
          operationId: parsed.data.operationId,
          reasonCode: association.reasonCode,
          status: "rejected",
        };
      }
      const requestId = `execution-recovery:${parsed.data.operationId}`;
      const payload =
        runtimeTransportResumeControllerConversationFramePayloadSchema.parse({
          destination: parsed.data.destination,
          identity: association.identity,
          operationId: parsed.data.operationId,
          providerRuntimeWorkingDirectory:
            parsed.data.providerRuntimeWorkingDirectory,
          requestId,
          sourceEventId:
            association.commandState.sanitizedDeliveryRequest.payload
              .sourceEventId,
          transportMode:
            association.commandState.sanitizedDeliveryRequest.payload
              .transportMode ?? "local-cli",
        });
      try {
        const result =
          await this.sendCurrentDeviceOperationAndWait<RuntimeTransportResumeControllerConversationResponse>(
            {
              code: "daemon.execution_recovery.resume_controller_conversation",
              expectedResponseCode:
                "daemon.execution_recovery.resume_controller_conversation_result",
              isExpectedPayload: (value) =>
                runtimeTransportResumeControllerConversationResponseSchema.safeParse(
                  value
                ).success,
              payload,
              requestId,
              session: association.session,
              timeoutMs: 10 * 60 * 1000,
            }
          );
        if (
          result.operationId !== parsed.data.operationId ||
          JSON.stringify(result.identity) !==
            JSON.stringify(association.identity) ||
          JSON.stringify(result.destination) !==
            JSON.stringify(parsed.data.destination)
        ) {
          throw new Error("execution_recovery.result_identity_mismatch");
        }
        return runtimeTransportResumeControllerConversationResponseSchema.parse(
          result
        );
      } catch (error) {
        return {
          destination: parsed.data.destination,
          identity: association.identity,
          message: error instanceof Error ? error.message : String(error),
          operationId: parsed.data.operationId,
          reasonCode: "execution_recovery.service_response_unavailable",
          status: "outcome_unknown",
        };
      }
    });
  }
  private async resolveExecutionRecoveryAssociation(
    input: Pick<
      RuntimeTransportInspectExecutionRecoveryRequest,
      "destination" | "identity" | "ownerUserId"
    >
  ): Promise<
    | {
        ok: true;
        commandState: RuntimeCoordinatorRunCommandState;
        identity: RuntimeTransportInspectExecutionRecoveryRequest["identity"];
        session: RuntimeTransportSessionState & {
          socket: WebSocket;
        };
      }
    | {
        ok: false;
        exactAssociationVerified: boolean;
        identity:
          | RuntimeTransportInspectExecutionRecoveryRequest["identity"]
          | null;
        reasonCode: string;
        serviceSupportsResume: boolean;
      }
  > {
    const runtimeCoordinatorExecutionId =
      input.identity.runtimeCoordinatorExecutionId;
    if (
      !(
        runtimeCoordinatorExecutionId &&
        input.identity.agentControllerRef &&
        input.identity.agentControllerConversationId &&
        input.identity.attemptId
      )
    ) {
      return {
        exactAssociationVerified: false,
        identity: null,
        ok: false,
        reasonCode: "execution_recovery.identity_incomplete",
        serviceSupportsResume: false,
      };
    }
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      runtimeCoordinatorExecutionId
    );
    const delivery = commandState?.sanitizedDeliveryRequest;
    if (
      !(
        commandState &&
        delivery &&
        commandState.ownerUserId === input.ownerUserId &&
        commandState.runtimeCoordinatorExecutionId ===
          runtimeCoordinatorExecutionId &&
        commandState.dispatchId === input.identity.dispatchId &&
        commandState.attemptId === input.identity.attemptId &&
        commandState.targetProfileId === input.identity.targetProfileId &&
        (input.identity.taskId === null ||
          delivery.payload.taskId === input.identity.taskId) &&
        delivery.payload.spaceId === input.identity.spaceId &&
        delivery.payload.executionIdentity.core.agentControllerRef ===
          input.identity.agentControllerRef &&
        (delivery.payload.agentControllerConversationId ?? null) ===
          input.identity.agentControllerConversationId &&
        input.destination.surface === "space" &&
        input.destination.spaceId === delivery.payload.spaceId &&
        input.destination.threadId ===
          (delivery.payload.threadContext?.threadId ?? null)
      )
    ) {
      return {
        exactAssociationVerified: false,
        identity: null,
        ok: false,
        reasonCode: "execution_recovery.identity_mismatch",
        serviceSupportsResume: false,
      };
    }
    this.reapExpiredLeases(Date.now());
    const lease = this.state.profileLeasesByProfileId.get(
      input.identity.targetProfileId
    );
    const session = lease
      ? this.state.sessionsById.get(lease.daemonSessionId)
      : null;
    if (
      !(
        lease &&
        session?.socket &&
        session.ownerUserId === input.ownerUserId &&
        session.profileIds.has(input.identity.targetProfileId) &&
        session.deviceId === lease.deviceId &&
        session.lane === lease.lane &&
        session.capabilities.localAgentControl?.resumeControllerConversation ===
          true &&
        isDaemonExecutionCompatible(session.executionCompatibility)
      )
    ) {
      return {
        exactAssociationVerified: true,
        identity: {
          ...input.identity,
          taskId: delivery.payload.taskId,
        },
        ok: false,
        reasonCode: "execution_recovery.service_resume_unavailable",
        serviceSupportsResume: false,
      };
    }
    return {
      commandState,
      identity: {
        ...input.identity,
        taskId: delivery.payload.taskId,
      },
      ok: true,
      session: session as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private async runSerializedRuntimeCoordinatorFinalization<T>(input: {
    run: () => Promise<T>;
    runtimeCoordinatorExecutionId: string;
  }): Promise<SerializedRuntimeCoordinatorFinalizationResult<T>> {
    const previous = this.runtimeCoordinatorFinalizationTails.get(
      input.runtimeCoordinatorExecutionId
    );
    if (previous) {
      const previousResult =
        await this.waitForRuntimeCoordinatorFinalizationWork(previous);
      if (previousResult.status === "in_flight") {
        return previousResult;
      }
      return await this.runSerializedRuntimeCoordinatorFinalization(input);
    }
    const run = this.beginSerializedRuntimeCoordinatorFinalization(input);
    return await this.waitForRuntimeCoordinatorFinalizationWork(run);
  }
  private async runSerializedRuntimeCoordinatorFinalizationToCompletion<
    T,
  >(input: {
    run: () => Promise<T>;
    runtimeCoordinatorExecutionId: string;
  }): Promise<T> {
    const previous = this.runtimeCoordinatorFinalizationTails.get(
      input.runtimeCoordinatorExecutionId
    );
    if (previous) {
      await previous;
      return await this.runSerializedRuntimeCoordinatorFinalizationToCompletion(
        input
      );
    }
    return await this.beginSerializedRuntimeCoordinatorFinalization(input);
  }
  private beginSerializedRuntimeCoordinatorFinalization<T>(input: {
    run: () => Promise<T>;
    runtimeCoordinatorExecutionId: string;
  }): Promise<T> {
    const run = input.run();
    const clearTail = () => {
      if (
        this.runtimeCoordinatorFinalizationTails.get(
          input.runtimeCoordinatorExecutionId
        ) === tail
      ) {
        this.runtimeCoordinatorFinalizationTails.delete(
          input.runtimeCoordinatorExecutionId
        );
      }
    };
    const tail = run.then(clearTail, clearTail);
    this.runtimeCoordinatorFinalizationTails.set(
      input.runtimeCoordinatorExecutionId,
      tail
    );
    return run;
  }
  private async waitForRuntimeCoordinatorFinalizationWork<T>(
    work: Promise<T>
  ): Promise<SerializedRuntimeCoordinatorFinalizationResult<T>> {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ status: "in_flight" });
      }, RUNTIME_COORDINATOR_FINALIZATION_SERIALIZATION_WAIT_MS);
      work.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve({ status: "completed", value });
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }
  private async runBoundedRuntimeCoordinatorFinalizationRecovery(input: {
    attemptId: string;
    dispatchId: string;
    executionTokenRunId: string;
    preloadedCommand?: RuntimeCoordinatorFinalizationCommand;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
  }): Promise<
    SerializedRuntimeCoordinatorFinalizationResult<RuntimeCoordinatorFinalizationRecoveryResult>
  > {
    let recovery = this.runtimeCoordinatorFinalizationRecoveryTails.get(
      input.runtimeCoordinatorExecutionId
    );
    if (!recovery) {
      const startedRecovery =
        this.recoverRuntimeCoordinatorFinalizationFromSpaceClaim(input).catch(
          (error: unknown) => {
            console.warn(
              "[core.runtime_transport.runtime_coordinator_finalization_recovery_failed]",
              {
                attemptId: input.attemptId,
                dispatchId: input.dispatchId,
                error: error instanceof Error ? error.message : String(error),
                runtimeCoordinatorExecutionId:
                  input.runtimeCoordinatorExecutionId,
                spaceId: input.spaceId,
              }
            );
            return null;
          }
        );
      recovery = startedRecovery.finally(() => {
        if (
          this.runtimeCoordinatorFinalizationRecoveryTails.get(
            input.runtimeCoordinatorExecutionId
          ) === recovery
        ) {
          this.runtimeCoordinatorFinalizationRecoveryTails.delete(
            input.runtimeCoordinatorExecutionId
          );
        }
      });
      this.runtimeCoordinatorFinalizationRecoveryTails.set(
        input.runtimeCoordinatorExecutionId,
        recovery
      );
    }
    return await this.waitForRuntimeCoordinatorFinalizationWork(recovery);
  }
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: contract tests exercise this diagnostic helper through the DO instance without exposing an operator route.
  private async classifyRuntimeCoordinatorPublicationClosureDiagnostics(
    input: RuntimeCoordinatorPublicationClosureDiagnosticInput
  ): Promise<RuntimeCoordinatorPublicationClosureDiagnostics> {
    if (input.publicationKind === "success_reply") {
      return await this.classifyRuntimeCoordinatorSuccessReplyClosureDiagnostics(
        input
      );
    }
    if (input.publicationKind === "stopped_notice") {
      return await this.classifyRuntimeCoordinatorStoppedNoticeClosureDiagnostics(
        input
      );
    }
    return await this.classifyRuntimeCoordinatorFailureNoticeClosureDiagnostics(
      input
    );
  }
  private async classifyRuntimeCoordinatorSuccessReplyClosureDiagnostics(
    input: RuntimeCoordinatorPublicationClosureDiagnosticInput
  ): Promise<RuntimeCoordinatorPublicationClosureDiagnostics> {
    const finalizationCommandId =
      resolveRuntimeCoordinatorFinalizationCommandIdFromClosureDiagnosticInput(
        input
      );
    if (!finalizationCommandId) {
      return isHistoricalPublicationClosureEvidence(input.evidenceSource)
        ? buildHistoricalEvidenceOnlyClosureDiagnostics("success_reply")
        : buildMissingPublicationFactsClosureDiagnostics({
            publicationKind: "success_reply",
            reasonCode:
              "runtime_coordinator.finalization_command_selector_missing",
          });
    }
    const command = await this.readRuntimeCoordinatorFinalizationCommand(
      finalizationCommandId
    );
    if (!command) {
      return isHistoricalPublicationClosureEvidence(input.evidenceSource)
        ? buildHistoricalEvidenceOnlyClosureDiagnostics("success_reply")
        : buildMissingPublicationFactsClosureDiagnostics({
            publicationKind: "success_reply",
            reasonCode: "runtime_coordinator.finalization_command_missing",
          });
    }
    if (
      command.dispatchId !== input.dispatchId ||
      command.finalizationCommandId !== finalizationCommandId ||
      command.spaceId !== input.spaceId ||
      command.targetProfileId !== input.targetProfileId ||
      (input.executionTokenRunId &&
        command.executionTokenRunId !== input.executionTokenRunId) ||
      (input.runtimeCoordinatorExecutionId &&
        command.runtimeCoordinatorExecutionId !==
          input.runtimeCoordinatorExecutionId)
    ) {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "success_reply",
        reasonCode: "runtime_coordinator.finalization_command_mismatch",
      });
    }
    const storedOutcome = await this.readRuntimeCoordinatorFinalizationOutcome(
      finalizationCommandId
    );
    if (storedOutcome?.ok) {
      return {
        finalizationCommandId,
        publicationKind: "success_reply",
        reasonCode: "runtime_coordinator.publication_already_visible",
        status: "already_visible",
      };
    }
    return {
      finalizationCommandId,
      publicationKind: "success_reply",
      reasonCode: "runtime_coordinator.publication_redrive_retryable",
      status: "retryable",
    };
  }
  private async classifyRuntimeCoordinatorFailureNoticeClosureDiagnostics(
    input: RuntimeCoordinatorPublicationClosureDiagnosticInput
  ): Promise<RuntimeCoordinatorPublicationClosureDiagnostics> {
    const targetWakeLifecycleId = input.targetWakeLifecycleId?.trim();
    if (!targetWakeLifecycleId) {
      return isHistoricalPublicationClosureEvidence(input.evidenceSource)
        ? buildHistoricalEvidenceOnlyClosureDiagnostics("failure_notice")
        : buildMissingPublicationFactsClosureDiagnostics({
            publicationKind: "failure_notice",
            reasonCode:
              "runtime_coordinator.failure_publication_selector_missing",
          });
    }
    const record = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      targetWakeLifecycleId
    );
    if (!record) {
      return isHistoricalPublicationClosureEvidence(input.evidenceSource)
        ? buildHistoricalEvidenceOnlyClosureDiagnostics("failure_notice")
        : buildMissingPublicationFactsClosureDiagnostics({
            publicationKind: "failure_notice",
            reasonCode:
              "runtime_coordinator.failure_publication_lifecycle_missing",
          });
    }
    if (!(record.publicationIntent && record.noExecutionDecision)) {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "failure_notice",
        reasonCode:
          "runtime_coordinator.failure_publication_lifecycle_incomplete",
      });
    }
    if (
      record.primaryDispatchId !== input.dispatchId ||
      record.targetWakeLifecycleIdentity.spaceId !== input.spaceId ||
      record.targetWakeLifecycleIdentity.targetProfileId !==
        input.targetProfileId
    ) {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "failure_notice",
        reasonCode: "runtime_coordinator.failure_publication_command_mismatch",
      });
    }
    const command = buildRuntimeCoordinatorHeadFailurePublicationCommand({
      nowMs: Date.now(),
      record,
    });
    if (
      input.failurePublicationCommandId &&
      command.failurePublicationCommandId !== input.failurePublicationCommandId
    ) {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "failure_notice",
        reasonCode: "runtime_coordinator.failure_publication_command_mismatch",
      });
    }
    if (
      record.publicationOutcome?.status === "failure_published" ||
      record.publicationOutcome?.status === "already_final"
    ) {
      return {
        failurePublicationCommandId: command.failurePublicationCommandId,
        publicationKind: "failure_notice",
        reasonCode: "runtime_coordinator.publication_already_visible",
        status: "already_visible",
        targetWakeLifecycleId,
      };
    }
    return {
      failurePublicationCommandId: command.failurePublicationCommandId,
      publicationKind: "failure_notice",
      reasonCode: "runtime_coordinator.publication_redrive_retryable",
      status: "retryable",
      targetWakeLifecycleId,
    };
  }
  private async classifyRuntimeCoordinatorStoppedNoticeClosureDiagnostics(
    input: RuntimeCoordinatorPublicationClosureDiagnosticInput
  ): Promise<RuntimeCoordinatorPublicationClosureDiagnostics> {
    const runtimeCoordinatorExecutionId =
      input.runtimeCoordinatorExecutionId?.trim();
    if (!runtimeCoordinatorExecutionId) {
      const targetWakeLifecycleId = input.targetWakeLifecycleId?.trim();
      if (!targetWakeLifecycleId) {
        return isHistoricalPublicationClosureEvidence(input.evidenceSource)
          ? buildHistoricalEvidenceOnlyClosureDiagnostics("stopped_notice")
          : buildMissingPublicationFactsClosureDiagnostics({
              publicationKind: "stopped_notice",
              reasonCode:
                "runtime_coordinator.stopped_publication_selector_missing",
            });
      }
      return await this.classifyRuntimeCoordinatorHeadStoppedNoticeClosureDiagnostics(
        {
          diagnosticInput: input,
          targetWakeLifecycleId,
        }
      );
    }
    const publicationId = buildRuntimeCoordinatorWakeStoppedNoticePublicationId(
      runtimeCoordinatorExecutionId
    );
    const storedPublication =
      await this.readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        publicationId
      );
    if (storedPublication?.status === "published") {
      return {
        publicationId,
        publicationKind: "stopped_notice",
        reasonCode: "runtime_coordinator.publication_already_visible",
        status: "already_visible",
      };
    }
    const db = getPostgresDatabase(this.env);
    const projection = db
      ? await readRuntimeCoordinatorExecutionProjectionById({
          db,
          runtimeCoordinatorExecutionId,
        }).catch(() => null)
      : null;
    if (!projection) {
      return isHistoricalPublicationClosureEvidence(input.evidenceSource)
        ? buildHistoricalEvidenceOnlyClosureDiagnostics("stopped_notice")
        : buildMissingPublicationFactsClosureDiagnostics({
            publicationKind: "stopped_notice",
            reasonCode:
              "runtime_coordinator.stopped_publication_execution_missing",
          });
    }
    if (
      projection.dispatchId !== input.dispatchId ||
      projection.spaceId !== input.spaceId ||
      projection.targetProfileId !== input.targetProfileId
    ) {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "stopped_notice",
        reasonCode:
          "runtime_coordinator.stopped_publication_execution_scope_mismatch",
      });
    }
    if (projection.status !== "cancelled") {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "stopped_notice",
        reasonCode:
          "runtime_coordinator.stopped_publication_execution_not_cancelled",
      });
    }
    return {
      publicationId,
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.publication_redrive_retryable",
      status: "retryable",
    };
  }
  private async classifyRuntimeCoordinatorHeadStoppedNoticeClosureDiagnostics(input: {
    diagnosticInput: RuntimeCoordinatorPublicationClosureDiagnosticInput;
    targetWakeLifecycleId: string;
  }): Promise<RuntimeCoordinatorPublicationClosureDiagnostics> {
    const publicationId =
      buildRuntimeCoordinatorHeadWakeStoppedNoticePublicationId(
        input.targetWakeLifecycleId
      );
    const storedPublication =
      await this.readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        publicationId
      );
    if (storedPublication?.status === "published") {
      return {
        publicationId,
        publicationKind: "stopped_notice",
        reasonCode: "runtime_coordinator.publication_already_visible",
        status: "already_visible",
      };
    }
    const record = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      input.targetWakeLifecycleId
    );
    if (!record) {
      return isHistoricalPublicationClosureEvidence(
        input.diagnosticInput.evidenceSource
      )
        ? buildHistoricalEvidenceOnlyClosureDiagnostics("stopped_notice")
        : buildMissingPublicationFactsClosureDiagnostics({
            publicationKind: "stopped_notice",
            reasonCode:
              "runtime_coordinator.stopped_publication_lifecycle_missing",
          });
    }
    if (
      record.primaryDispatchId !== input.diagnosticInput.dispatchId ||
      record.targetWakeLifecycleIdentity.spaceId !==
        input.diagnosticInput.spaceId ||
      record.targetWakeLifecycleIdentity.targetProfileId !==
        input.diagnosticInput.targetProfileId
    ) {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "stopped_notice",
        reasonCode:
          "runtime_coordinator.stopped_publication_lifecycle_scope_mismatch",
      });
    }
    if (record.status !== "stopped_before_execution") {
      return buildMissingPublicationFactsClosureDiagnostics({
        publicationKind: "stopped_notice",
        reasonCode:
          "runtime_coordinator.stopped_publication_lifecycle_not_stopped",
      });
    }
    return {
      publicationId,
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.publication_redrive_retryable",
      status: "retryable",
    };
  }
  fetch(request: Request): Promise<Response> {
    return Promise.resolve(this.handleFetch(request));
  }
  webSocketMessage(
    webSocket: WebSocket,
    rawMessage: string | ArrayBuffer
  ): void {
    // Keepalive fallback: in production setWebSocketAutoResponse answers the
    // bare PING below this handler, but environments without hibernation
    // auto-response (tests / local) surface it here. Answer PONG and return --
    // never parse it as a frame or touch lease / readiness / liveness.
    if (rawMessage === DAEMON_STREAM_KEEPALIVE_PING) {
      webSocket.send(DAEMON_STREAM_KEEPALIVE_PONG);
      return;
    }
    const frame = parseDaemonStreamFrame(rawMessage);
    if (!frame) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid daemon stream frame",
      });
      return;
    }
    this.handleParsedStreamFrame(webSocket, frame);
  }
  private handleParsedStreamFrame(
    webSocket: WebSocket,
    frame: DaemonStreamFrame
  ): void {
    switch (frame.code) {
      case "daemon.session.register": {
        this.ctx.waitUntil(
          this.ctx.blockConcurrencyWhile(() =>
            this.handleRegisterSessionFrame(webSocket, frame.payload)
          )
        );
        return;
      }
      case "daemon.session.heartbeat": {
        this.handleHeartbeatFrame(webSocket, frame.payload);
        return;
      }
      case "daemon.dispatch.result": {
        this.enqueueOrderedDispatchFrame({
          onError: (error) => {
            console.warn("[core.runtime_transport.result_frame_failed]", {
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
            this.sendFrame(webSocket, {
              code: "daemon.dispatch.accepted",
              payload: {
                attemptId: null,
                dispatchId: "unknown",
                ok: false,
                reasonCode: "daemon.result.inbox_unavailable",
                status: "retry_later",
              },
            });
          },
          payload: frame.payload,
          run: () => this.handleDispatchResultFrame(webSocket, frame.payload),
        });
        return;
      }
      case "daemon.dispatch.lifecycle": {
        this.handleDispatchLifecycleFrame(webSocket, frame.payload).catch(
          (error) => {
            console.warn("[core.runtime_transport.lifecycle_frame_failed]", {
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
            this.sendErrorFrame(webSocket, {
              code: "execution_token_authority_missing",
              message: "dispatch lifecycle rejected",
            });
          }
        );
        return;
      }
      case "daemon.dispatch.runtime_evidence": {
        this.handleDispatchRuntimeEvidenceFrame(webSocket, frame.payload).catch(
          (error) => {
            console.warn(
              "[core.runtime_transport.runtime_evidence_frame_failed]",
              {
                errorMessage:
                  error instanceof Error ? error.message : String(error),
              }
            );
            this.sendErrorFrame(webSocket, {
              code: "execution_token_authority_missing",
              message: "dispatch runtime evidence rejected",
            });
          }
        );
        return;
      }
      case "daemon.dispatch.reasoning": {
        const parsed = runtimeTransportDispatchReasoningRequestSchema.safeParse(
          frame.payload
        );
        if (!parsed.success) {
          return;
        }
        const dispatchId = parsed.data.dispatchId;
        if (parsed.data.reasoningState.status !== "streaming") {
          this.enqueueOrderedDispatchFrame({
            payload: parsed.data,
            onError: () => undefined,
            run: () =>
              this.handleDispatchToolActivityFrame(
                webSocket,
                { ...parsed.data, thinkingSnapshot: "" },
                "reasoning"
              ),
          });
          return;
        }
        // Every frame is a complete bounded snapshot. Drop intermediate frames
        // while delivery is busy rather than queueing private text behind it.
        if (
          this.pendingReasoningDispatches.size >= 128 ||
          this.pendingReasoningDispatches.has(dispatchId)
        ) {
          return;
        }
        this.pendingReasoningDispatches.add(dispatchId);
        this.enqueueOrderedDispatchFrame({
          payload: frame.payload,
          onError: () => this.pendingReasoningDispatches.delete(dispatchId),
          run: async () => {
            try {
              await this.handleDispatchToolActivityFrame(
                webSocket,
                frame.payload,
                "reasoning"
              );
            } finally {
              this.pendingReasoningDispatches.delete(dispatchId);
            }
          },
        });
        return;
      }
      case "daemon.dispatch.reply":
      case "daemon.dispatch.progress": {
        this.enqueueOrderedDispatchFrame({
          onError: (error) => {
            console.warn("[core.runtime_transport.progress_frame_failed]", {
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
            this.sendErrorFrame(webSocket, {
              code: "execution_token_authority_missing",
              message: "dispatch progress rejected",
            });
          },
          payload: frame.payload,
          run: () =>
            this.handleDispatchToolActivityFrame(
              webSocket,
              frame.payload,
              frame.code === "daemon.dispatch.reply" ? "reply" : "progress"
            ),
        });
        return;
      }
      case "daemon.dispatch.tool_activity": {
        this.enqueueOrderedDispatchFrame({
          onError: (error) => {
            console.warn(
              "[core.runtime_transport.tool_activity_frame_failed]",
              {
                errorMessage:
                  error instanceof Error ? error.message : String(error),
              }
            );
            this.sendErrorFrame(webSocket, {
              code: "execution_token_authority_missing",
              message: "dispatch tool activity rejected",
            });
          },
          payload: frame.payload,
          run: () =>
            this.handleDispatchToolActivityFrame(webSocket, frame.payload),
        });
        return;
      }
      case "daemon.dispatch.interaction_request": {
        this.enqueueOrderedDispatchFrame({
          onError: (error) => {
            console.warn(
              "[core.runtime_transport.interaction_request_frame_failed]",
              {
                errorMessage:
                  error instanceof Error ? error.message : String(error),
              }
            );
            this.sendErrorFrame(webSocket, {
              code: "execution_token_authority_missing",
              message: "dispatch interaction request rejected",
            });
          },
          payload: frame.payload,
          run: () =>
            this.handleDispatchInteractionRequestFrame(
              webSocket,
              frame.payload
            ),
        });
        return;
      }
      case "daemon.dispatch.interaction_delivered": {
        this.enqueueOrderedDispatchFrame({
          onError: (error) => {
            console.warn(
              "[core.runtime_transport.interaction_delivered_frame_failed]",
              {
                errorMessage:
                  error instanceof Error ? error.message : String(error),
              }
            );
            this.sendErrorFrame(webSocket, {
              code: "execution_token_authority_missing",
              message: "dispatch interaction delivery rejected",
            });
          },
          payload: frame.payload,
          run: () =>
            this.handleDispatchInteractionDeliveredFrame(
              webSocket,
              frame.payload
            ),
        });
        return;
      }
      case "daemon.dispatch.preview": {
        this.handleDispatchPreviewFrame(webSocket, frame.payload);
        return;
      }
      case "daemon.dispatch.preview_end": {
        this.handleDispatchPreviewEndFrame(webSocket, frame.payload);
        return;
      }
      case "daemon.local_agent_control.result": {
        this.handleLocalAgentControlResultFrame(webSocket, frame.payload);
        return;
      }
      case "daemon.execution_input.result": {
        const parsed = localExecutionInputResultFrameSchema.safeParse(
          frame.payload
        );
        if (!parsed.success) {
          return;
        }
        const waiter = this.currentDeviceOperationWaiters.get(
          parsed.data.requestId
        );
        if (
          !waiter ||
          waiter.socket !== webSocket ||
          waiter.expectedResponseCode !== "daemon.execution_input.result"
        ) {
          return;
        }
        clearTimeout(waiter.timeoutId);
        this.currentDeviceOperationWaiters.delete(parsed.data.requestId);
        if (waiter.isExpectedPayload(parsed.data.result)) {
          waiter.resolve(parsed.data.result);
        } else {
          waiter.reject(new Error("Execution input receipt target mismatch."));
        }
        return;
      }
      case "daemon.openmeld_tools_control.result": {
        this.handleOpenMeldToolsControlResultFrame(webSocket, frame.payload);
        return;
      }
      case "daemon.execution_recovery.resume_controller_conversation_result": {
        this.handleExecutionRecoveryResultFrame(webSocket, frame.payload);
        return;
      }
      case "daemon.computer_power.request_result": {
        const parsed = computerPowerResultFrameSchema.safeParse(frame);
        if (!parsed.success) {
          this.rejectInvalidCurrentDeviceOperationResultFrame({
            frame,
            message: "Invalid computer power response.",
            webSocket,
          });
          return;
        }
        this.resolveCurrentDeviceOperationResultFrame({
          code: parsed.data.code,
          payload: parsed.data.payload,
          invalidMessage: "Invalid computer power response.",
          webSocket,
        });
        return;
      }
      case "daemon.computer_file_access.read_policy_result":
      case "daemon.computer_file_access.update_policy_result": {
        this.handleComputerFileAccessResultFrame(webSocket, frame);
        return;
      }
      case "daemon.session_history.request_result": {
        const parsed = sessionHistoryResultFrameSchema.safeParse(frame);
        if (!parsed.success) {
          this.rejectInvalidCurrentDeviceOperationResultFrame({
            frame,
            message: "Invalid session history result.",
            webSocket,
          });
          return;
        }
        this.resolveCurrentDeviceOperationResultFrame({
          code: parsed.data.code,
          invalidMessage: "Invalid session history result.",
          payload: parsed.data.payload,
          webSocket,
        });
        return;
      }
      case "daemon.local_folder_picker.select_folders_result": {
        this.handleLocalFolderPickerResultFrame(webSocket, frame);
        return;
      }
      case "daemon.local_project_control.connect_candidate_result":
      case "daemon.local_project_control.connect_declared_path_result":
      case "daemon.local_project_control.discover_projects_result":
      case "daemon.local_project_control.remove_connection_result":
      case "daemon.local_project_control.remove_missing_connections_result":
      case "daemon.local_project_control.set_default_connection_result": {
        this.handleLocalProjectControlResultFrame(webSocket, frame);
        return;
      }
      case "daemon.dispatch.accepted":
      case "daemon.dispatch.deliver":
      case "daemon.dispatch.interaction_response":
      case "daemon.local_agent_control.refresh_catalog":
      case "daemon.local_agent_control.fork_session":
      case "daemon.local_agent_control.manage_installation":
      case "daemon.local_agent_control.set_enabled":
      case "daemon.local_agent_control.set_profile_workspace":
      case "daemon.local_agent_control.manage_profile_folders":
      case "daemon.openmeld_tools_control.request":
      case "daemon.execution_recovery.resume_controller_conversation":
      case "daemon.computer_file_access.read_policy":
      case "daemon.computer_file_access.update_policy":
      case "daemon.local_folder_picker.select_folders":
      case "daemon.local_project_control.connect_candidate":
      case "daemon.local_project_control.connect_declared_path":
      case "daemon.local_project_control.discover_projects":
      case "daemon.local_project_control.remove_connection":
      case "daemon.local_project_control.remove_missing_connections":
      case "daemon.local_project_control.set_default_connection":
      case "daemon.route_catalog.changed":
      case "daemon.error": {
        // These frames are server-driven for v1; client-side sends are ignored.
        return;
      }
      default: {
        this.sendErrorFrame(webSocket, {
          code: "schema.invalid",
          message: "unsupported frame code",
        });
      }
    }
  }
  private enqueueOrderedDispatchFrame(input: {
    onError: (error: unknown) => void;
    payload: unknown;
    run: () => Promise<void>;
  }): void {
    const dispatchId = readDispatchIdForFrameOrdering(input.payload);
    if (!dispatchId) {
      this.ctx.waitUntil(input.run().catch(input.onError));
      return;
    }
    const previous = this.orderedDispatchFrameTails.get(dispatchId);
    const run = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(input.run);
    let tail: Promise<void>;
    tail = run
      .catch((error) => {
        input.onError(error);
      })
      .finally(() => {
        if (this.orderedDispatchFrameTails.get(dispatchId) === tail) {
          this.orderedDispatchFrameTails.delete(dispatchId);
        }
      });
    this.orderedDispatchFrameTails.set(dispatchId, tail);
    this.ctx.waitUntil(tail);
  }
  private async handleRegisterSessionFrame(
    webSocket: WebSocket,
    payload: unknown
  ): Promise<void> {
    const parsed =
      runtimeTransportRegisterSessionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid register payload",
      });
      return;
    }
    const verifiedOwnerUserId = this.requireVerifiedOwnerUserId(webSocket);
    if (!verifiedOwnerUserId) {
      return;
    }
    const request = {
      ...parsed.data,
      capabilities: applyRuntimeTransportNegotiatedCapabilities({
        attachment: readRuntimeTransportSocketAttachment(webSocket),
        capabilities: parsed.data.capabilities,
      }),
    };
    const sessionBeforeRegister = this.state.sessionsById.get(
      parsed.data.daemonSessionId
    );
    const previousReadinessProfileIds = collectReadinessProfileIdsForSession(
      sessionBeforeRegister
    );
    const snapshotBeforeRegister = snapshotSessionReadinessComponents(
      sessionBeforeRegister
    );
    // A re-register on the SAME socket is a catalog refresh: only profiles
    // whose registration facts changed can have a different readiness
    // verdict. A new or replaced socket flips every carried profile between
    // offline and online, so it keeps the full fan-out.
    const isSameSocketReRegister = sessionBeforeRegister?.socket === webSocket;
    if (
      !isSameSocketReRegister &&
      request.ownerUserId === verifiedOwnerUserId
    ) {
      const highWater = await readServiceRuntimeConnectionGeneration(this.ctx, {
        ownerUserId: verifiedOwnerUserId,
        deviceId: request.deviceId,
        lane: request.lane,
      });
      request.connectionGeneration = Math.max(
        request.connectionGeneration,
        highWater + 1
      );
    }
    const localComponentsRelease = await this.refreshLocalComponentsRelease();
    const response = handleRegisterSession(
      this.state,
      {
        request,
        verifiedOwnerUserId,
        webSocket,
      },
      {
        persistRuntimeRecords: () => undefined,
        cleanupExpiredPendingDispatches: this.cleanupExpiredPendingDispatches,
        recordReapedReadinessProfiles: this.publishReapedReadinessProfiles,
        failPendingDispatchResultWaitersForConnectionGeneration:
          this.failPendingDispatchResultWaitersForConnectionGeneration,
        closeSocket: safeCloseSocket,
        localComponentsManifest: localComponentsRelease.manifest,
      }
    );
    // Registration must not acknowledge a fence that only exists in memory.
    // blockConcurrencyWhile resets this object on failure, withdrawing the
    // mutated session instead of exposing an uncommitted registration.
    await persistServiceRuntimeRecordsNow(this.ctx, this.state);
    this.sendFrame(webSocket, {
      code: "daemon.session.register",
      payload: {
        ...response,
        ...(readRuntimeTransportSocketAttachment(webSocket)
          .executionAdmissionConfirmation
          ? { executionAdmissionConfirmation: true }
          : {}),
        ...(readRuntimeTransportSocketAttachment(webSocket).computerCare
          ? { computerCare: true }
          : {}),
        ...(readRuntimeTransportSocketAttachment(webSocket).admissionEvidence
          ? { admissionEvidence: true }
          : {}),
      },
    });
    if (response.ok) {
      this.sendReasoningPreference(webSocket);
    }
    if (parsed.data.ownerUserId === verifiedOwnerUserId) {
      const profileIds =
        response.ok && isSameSocketReRegister
          ? diffSessionReadinessComponents(
              snapshotBeforeRegister,
              snapshotSessionReadinessComponents(
                this.state.sessionsById.get(parsed.data.daemonSessionId)
              )
            )
          : [
              ...previousReadinessProfileIds,
              ...parsed.data.profileIds,
              ...collectLocalWakeRouteReportProfileIds(
                parsed.data.localWakeRouteReport
              ),
              ...response.acceptedLeases.map((lease) => lease.profileId),
              ...response.rejectedProfiles.map((profile) => profile.profileId),
              ...collectReadinessProfileIdsForSession(
                this.state.sessionsById.get(parsed.data.daemonSessionId)
              ),
            ];
      this.publishAgentReadinessInvalidated({
        profileIds,
        reason: "daemon.session.registered",
      });
    }
    const registeredSession =
      this.state.sessionsById.get(parsed.data.daemonSessionId) ?? null;
    if (response.ok) {
      this.queueReleaseTriggeredOpenMeldToolsUpdate({
        connection: {
          daemonSessionId: parsed.data.daemonSessionId,
          deviceId: parsed.data.deviceId,
          lane: parsed.data.lane,
          ownerUserId: verifiedOwnerUserId,
        },
        release: localComponentsRelease,
        session: registeredSession,
        socket: webSocket,
        trigger: "register",
      });
      console.info("[core.runtime_transport.socket_connected]", {
        connectedAtMs: registeredSession?.connectedAtMs ?? Date.now(),
        connectionGeneration: response.connectionGeneration,
        daemonSessionId: parsed.data.daemonSessionId,
        deviceId: parsed.data.deviceId,
        event: "core.runtime_transport.socket_connected",
        lane: parsed.data.lane,
        ownerUserId: verifiedOwnerUserId,
        reconnectAcceptedLeaseCount: response.acceptedLeases.length,
        rejectedProfileCount: response.rejectedProfiles.length,
      });
      this.invalidateExpectedRouteReconciliationReadCacheForSession({
        connectionGeneration: response.connectionGeneration,
        daemonSessionId: parsed.data.daemonSessionId,
        deviceId: parsed.data.deviceId,
        lane: parsed.data.lane,
        ownerUserId: verifiedOwnerUserId,
      });
      this.ctx.waitUntil(
        this.reconcileExpectedRoutesForSession({
          connectionGeneration: response.connectionGeneration,
          daemonSessionId: parsed.data.daemonSessionId,
          deviceId: parsed.data.deviceId,
          lane: parsed.data.lane,
          ownerUserId: verifiedOwnerUserId,
          trigger: "daemon_session_registered",
        })
      );
      this.ctx.waitUntil(
        this.triggerRuntimeCoordinatorHeadWaitingRecovery({
          ownerUserId: verifiedOwnerUserId,
          profileIds: parsed.data.profileIds,
          trigger: "daemon_session_registered",
        })
      );
      this.ctx.waitUntil(
        this.replayRuntimeCoordinatorInteractionResponsesForSession(
          parsed.data.daemonSessionId
        )
      );
    }
    this.queueReplacementSessionReconciliation({
      daemonSessionId: parsed.data.daemonSessionId,
      shouldReconcile:
        response.acceptedLeases.length > 0 &&
        registeredSession?.socket === webSocket &&
        registeredSession.acceptingDispatches === true,
    });
    this.queueHousekeepingAlarmSync();
  }
  private queueReplacementSessionReconciliation(input: {
    daemonSessionId: string;
    shouldReconcile: boolean;
  }): void {
    if (!input.shouldReconcile) {
      return;
    }
    this.ctx.waitUntil(
      this.reconcileRuntimeCoordinatorExecutionsForReplacementSession({
        daemonSessionId: input.daemonSessionId,
      }).catch((error) => {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_replacement_session_reconcile_failed]",
          {
            daemonSessionId: input.daemonSessionId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      })
    );
  }
  private handleHeartbeatFrame(webSocket: WebSocket, payload: unknown): void {
    const parsed = runtimeTransportHeartbeatRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid heartbeat payload",
      });
      return;
    }
    const verifiedOwnerUserId = this.requireVerifiedOwnerUserId(webSocket);
    if (!verifiedOwnerUserId) {
      return;
    }
    const request = {
      ...parsed.data,
      admissionEvidence: readRuntimeTransportSocketAttachment(webSocket)
        .admissionEvidence
        ? parsed.data.admissionEvidence
        : undefined,
      capabilities: applyRuntimeTransportNegotiatedCapabilities({
        attachment: readRuntimeTransportSocketAttachment(webSocket),
        capabilities: parsed.data.capabilities,
      }),
    };
    const sessionBeforeHeartbeat = this.state.sessionsById.get(
      parsed.data.daemonSessionId
    );
    const previousReadinessProfileIds = collectReadinessProfileIdsForSession(
      sessionBeforeHeartbeat
    );
    const snapshotBeforeHeartbeat = snapshotSessionReadinessComponents(
      sessionBeforeHeartbeat
    );
    const previousServiceVersion =
      sessionBeforeHeartbeat?.serviceVersion ?? null;
    const previousCompatibilityReason =
      sessionBeforeHeartbeat?.executionCompatibility?.reasonCode ?? null;
    const previousCompatibilityStatus =
      sessionBeforeHeartbeat?.executionCompatibility?.status ?? null;
    const startupReconciliationCompleted =
      didRuntimeSessionCompleteStartupReconciliation({
        nextAcceptingDispatches: parsed.data.acceptingDispatches,
        nextHasStopCause: parsed.data.stopCause !== undefined,
        previousAcceptingDispatches:
          sessionBeforeHeartbeat?.acceptingDispatches,
      });
    // Heartbeats stay synchronous. They use the release this instance read
    // last and refresh it for the next frame.
    const localComponentsRelease = this.localComponentsRelease;
    this.ctx.waitUntil(this.refreshLocalComponentsRelease());
    const response = handleHeartbeat(
      this.state,
      {
        request,
        verifiedOwnerUserId,
      },
      {
        persistRuntimeRecords: this.persistRuntimeRecords,
        cleanupExpiredPendingDispatches: this.cleanupExpiredPendingDispatches,
        recordReapedReadinessProfiles: this.publishReapedReadinessProfiles,
        failPendingDispatchResultWaitersForConnectionGeneration:
          this.failPendingDispatchResultWaitersForConnectionGeneration,
        closeSocket: safeCloseSocket,
        localComponentsManifest: localComponentsRelease.manifest,
      }
    );
    this.sendFrame(webSocket, {
      code: "daemon.session.heartbeat",
      payload: response,
    });
    if (response.ok) {
      const sessionAfterHeartbeat = this.state.sessionsById.get(
        parsed.data.daemonSessionId
      );
      const serviceVersionChanged =
        previousServiceVersion !==
        (sessionAfterHeartbeat?.serviceVersion ?? null);
      const compatibilityChanged =
        previousCompatibilityReason !==
          (sessionAfterHeartbeat?.executionCompatibility?.reasonCode ?? null) ||
        previousCompatibilityStatus !==
          (sessionAfterHeartbeat?.executionCompatibility?.status ?? null);
      const changedReadinessProfileIds = diffSessionReadinessComponents(
        snapshotBeforeHeartbeat,
        snapshotSessionReadinessComponents(sessionAfterHeartbeat)
      );
      if (
        response.staleLeases.length > 0 ||
        serviceVersionChanged ||
        compatibilityChanged ||
        changedReadinessProfileIds.length > 0
      ) {
        // A service-version or execution-compatibility change is a
        // session-level fact that shifts the verdict of every carried
        // profile, so it keeps the full fan-out. The component diff handles
        // registration and admission changes; stale leases add their profiles.
        const profileIds =
          serviceVersionChanged || compatibilityChanged
            ? [
                ...previousReadinessProfileIds,
                ...parsed.data.leases.map((lease) => lease.profileId),
                ...response.staleLeases.map((lease) => lease.profileId),
                ...collectReadinessProfileIdsForSession(sessionAfterHeartbeat),
              ]
            : [
                ...response.staleLeases.map((lease) => lease.profileId),
                ...changedReadinessProfileIds,
              ];
        this.publishAgentReadinessInvalidated({
          profileIds,
          reason: "daemon.session.heartbeat_changed",
        });
      }
      if (sessionAfterHeartbeat) {
        this.queueReleaseTriggeredOpenMeldToolsUpdate({
          connection: {
            daemonSessionId: parsed.data.daemonSessionId,
            deviceId: parsed.data.deviceId,
            lane: parsed.data.lane,
            ownerUserId: verifiedOwnerUserId,
          },
          release: localComponentsRelease,
          session: sessionAfterHeartbeat,
          socket: webSocket,
          trigger: "heartbeat",
        });
        this.ctx.waitUntil(
          this.reconcileExpectedRoutesForSession({
            connectionGeneration: sessionAfterHeartbeat.connectionGeneration,
            daemonSessionId: parsed.data.daemonSessionId,
            deviceId: parsed.data.deviceId,
            lane: parsed.data.lane,
            ownerUserId: verifiedOwnerUserId,
            trigger: "daemon_session_heartbeat",
          })
        );
      }
      // Repeat even without a readiness change: an earlier online event may
      // have arrived before the durable waiting head was committed.
      this.ctx.waitUntil(
        this.triggerRuntimeCoordinatorHeadWaitingRecovery({
          ownerUserId: verifiedOwnerUserId,
          profileIds: parsed.data.leases.map((lease) => lease.profileId),
          trigger: "daemon_session_heartbeat",
        })
      );
      this.ctx.waitUntil(
        this.replayRuntimeCoordinatorInteractionResponsesForSession(
          parsed.data.daemonSessionId
        )
      );
      this.queueReplacementSessionReconciliation({
        daemonSessionId: parsed.data.daemonSessionId,
        shouldReconcile: startupReconciliationCompleted,
      });
    }
    this.queueHousekeepingAlarmSync();
  }
  private async handleDispatchResultFrame(
    webSocket: WebSocket,
    payload: unknown
  ): Promise<void> {
    const parsed =
      runtimeTransportSubmitTaskResultRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid result payload",
      });
      return;
    }
    const resultCoordinatorContract =
      await this.resolveRuntimeCoordinatorResultContract(parsed.data);
    if (!resultCoordinatorContract.ok) {
      const response: RuntimeTransportSubmitTaskResultResponse = {
        ok: false,
        reasonCode: resultCoordinatorContract.reasonCode,
        status: "rejected_terminal",
      };
      this.sendSubmitTaskResultResponseFrame(webSocket, parsed.data, response);
      this.queueHousekeepingAlarmSync();
      return;
    }
    const isOwnerConflictResult = isRuntimeCoordinatorOwnerConflictResult(
      parsed.data
    );
    const contextResolution =
      await this.resolveRuntimeCoordinatorResultTokenValidationContextForRequest(
        {
          request: parsed.data,
          verifiedRuntimeCoordinatorExecution:
            resultCoordinatorContract.verifiedRuntimeCoordinatorExecution,
        }
      );
    if (!contextResolution.ok) {
      this.sendSubmitTaskResultResponseFrame(
        webSocket,
        parsed.data,
        contextResolution.response
      );
      this.queueHousekeepingAlarmSync();
      return;
    }
    const tokenValidationContext = contextResolution.context;
    if (!tokenValidationContext) {
      this.recordRuntimeCoordinatorOwnerConflictWithoutValidationContext({
        enabled: isOwnerConflictResult,
        request: parsed.data,
        runtimeCoordinatorExecutionId:
          parsed.data.runtimeCoordinatorExecutionId ??
          resultCoordinatorContract.diagnosticRuntimeCoordinatorExecutionId ??
          null,
      });
      await this.rejectResultWithoutTokenValidationContext(
        webSocket,
        parsed.data
      );
      this.queueHousekeepingAlarmSync();
      return;
    }
    let tokenValidationError: unknown = null;
    const tokenValidation = await this.validateRuntimeCoordinatorProgressToken({
      context: tokenValidationContext,
      executionTokenEcho: parsed.data.executionTokenEcho ?? null,
      frameKind: "result",
      ignoredEventSummary: `result:${parsed.data.dispatchId}:${parsed.data.attemptId ?? "unknown"}`,
    }).catch(
      (error): RuntimeCoordinatorExecutionTokenValidationResult | null => {
        tokenValidationError = error;
        return null;
      }
    );
    if (!tokenValidation) {
      this.recordRuntimeCoordinatorTokenAuthorityUnavailableEvent({
        error: tokenValidationError,
        frameKind: "result",
        ignoredEventSummary: `result:${parsed.data.dispatchId}:${parsed.data.attemptId ?? "unknown"}`,
        runtimeCoordinatorExecutionId:
          tokenValidationContext.runtimeCoordinatorExecutionId,
      });
      const response: RuntimeTransportSubmitTaskResultResponse = {
        ok: false,
        reasonCode: "runtime_coordinator.execution_token_authority_unavailable",
        status: "retry_later",
      };
      this.sendSubmitTaskResultResponseFrame(webSocket, parsed.data, response);
      this.queueHousekeepingAlarmSync();
      return;
    }
    if (!tokenValidation.ok) {
      if (
        await this.tryAcceptRuntimeCoordinatorLateResult({
          request: parsed.data,
          runtimeCoordinatorExecution:
            resultCoordinatorContract.verifiedRuntimeCoordinatorExecution,
          tokenValidation,
          tokenValidationContext,
          webSocket,
        })
      ) {
        return;
      }
      await this.closeStoppedLocalAgentStreamAfterTerminalLateResult({
        reasonCode: tokenValidation.reasonCode,
        request: parsed.data,
      });
      this.recordRuntimeCoordinatorOwnerConflictForRejectedToken({
        enabled: isOwnerConflictResult,
        request: parsed.data,
        runtimeCoordinatorExecutionId:
          tokenValidationContext.runtimeCoordinatorExecutionId,
        sourceClientMessageId:
          tokenValidationContext.executionScope.sourceClientMessageId,
        tokenValidation,
      });
      const response: RuntimeTransportSubmitTaskResultResponse = {
        ok: false,
        reasonCode: tokenValidation.reasonCode,
        status: "rejected_terminal",
      };
      this.sendSubmitTaskResultResponseFrame(webSocket, parsed.data, response);
      this.queueHousekeepingAlarmSync();
      return;
    }
    this.recordRuntimeCoordinatorOwnerConflictForAcceptedToken({
      enabled: isOwnerConflictResult,
      request: parsed.data,
      runtimeCoordinatorExecutionId:
        tokenValidationContext.runtimeCoordinatorExecutionId,
      sourceClientMessageId:
        tokenValidationContext.executionScope.sourceClientMessageId,
      tokenValidation,
    });
    if (isOwnerConflictResult) {
      this.sendSubmitTaskResultResponseFrame(webSocket, parsed.data, {
        ok: true,
        status: "accepted",
      });
      this.queueHousekeepingAlarmSync();
      return;
    }
    const db = getPostgresDatabase(this.env);
    const contextRejection = await this.resolveExecutionContextResultRejection(
      parsed.data,
      tokenValidationContext
    );
    if (contextRejection) {
      this.sendSubmitTaskResultResponseFrame(
        webSocket,
        parsed.data,
        contextRejection
      );
      return;
    }
    const response = db
      ? await handleSubmitTaskResult(this.state, parsed.data, {
          resolvePendingResultWaiters: this.resolvePendingResultWaiters,
          cleanupCompletedResults: this.cleanupCompletedResults,
          acceptDispatchResult: async (result) =>
            await acceptDispatchResultInboxRecord(db, result),
          acceptedResultRuntimeCoordinatorPointer: {
            executionTokenFingerprint: tokenValidation.run.tokenFingerprint,
            executionTokenRunId: tokenValidation.run.runId,
            runtimeCoordinatorExecutionId:
              tokenValidationContext.runtimeCoordinatorExecutionId,
          },
          finalizeDurableDispatchResult: async (result) =>
            await this.finalizeDurableDispatchResult(result),
          settleDurableDispatchResult: async (result) =>
            await this.settleDurableDispatchResult(result),
          resolveDurableDispatchResultAcceptance: async (result) =>
            await this.resolveDurableDispatchResultAcceptance(db, result),
        })
      : ({
          ok: false,
          reasonCode: "daemon.result.inbox_unavailable",
          status: "retry_later",
        } as const);
    if (response.ok) {
      await this.markRuntimeCoordinatorRunCommandStateResultReceived({
        attemptId: parsed.data.attemptId ?? null,
        dispatchId: parsed.data.dispatchId,
        receivedAtMs: Date.now(),
        runtimeCoordinatorExecutionId:
          tokenValidationContext.runtimeCoordinatorExecutionId,
      });
      await this.retireAcceptedRuntimeCoordinatorTokenRun({
        runId: tokenValidation.run.runId,
        runtimeCoordinatorExecutionId:
          tokenValidationContext.runtimeCoordinatorExecutionId,
      });
    }
    await this.recordRuntimeCoordinatorResultProjection({
      diagnosticRuntimeCoordinatorExecutionId:
        resultCoordinatorContract.diagnosticRuntimeCoordinatorExecutionId,
      request: parsed.data,
      response,
      verifiedRuntimeCoordinatorExecution:
        resultCoordinatorContract.verifiedRuntimeCoordinatorExecution,
    });
    this.sendSubmitTaskResultResponseFrame(webSocket, parsed.data, response);
    if (response.ok) {
      this.persistRuntimeRecords();
    }
    this.queueHousekeepingAlarmSync();
  }
  private async resolveExecutionContextResultRejection(
    request: RuntimeTransportSubmitTaskResultRequest,
    context: RuntimeCoordinatorTokenValidationContext
  ): Promise<RuntimeTransportSubmitTaskResultResponse | null> {
    try {
      const scope = context.executionScope;
      const payload = request.taskResult.payload;
      await recordExecutionContextCandidate({
        storage: this.ctx.storage,
        headId: projectTargetWakeLifecycleIdentity({
          clientMessageId: scope.sourceClientMessageId,
          dispatchId: scope.dispatchId,
          sourceSignalId: payload.sourceEventId,
          spaceId: scope.spaceId,
          targetProfileId: scope.targetProfileId,
        }).targetWakeLifecycleId,
        dispatchId: request.dispatchId,
        runtimeCoordinatorExecutionId: context.runtimeCoordinatorExecutionId,
        contextId:
          "executionContextId" in payload
            ? payload.executionContextId
            : undefined,
        completion:
          "executionContextCompletion" in payload
            ? payload.executionContextCompletion
            : undefined,
      });
      return null;
    } catch (error) {
      console.warn(
        "[core.runtime_transport.execution_context_result_rejected]",
        {
          dispatchId: request.dispatchId,
          reasonCode:
            error instanceof ExecutionContextSelectionError
              ? error.reasonCode
              : "execution_context.storage_unavailable",
        }
      );
      return error instanceof ExecutionContextSelectionError
        ? {
            ok: false,
            status: "rejected_terminal",
            reasonCode: "runtime_coordinator.execution_context_mismatch",
          }
        : {
            ok: false,
            status: "retry_later",
            reasonCode: "runtime_coordinator.execution_context_unavailable",
          };
    }
  }
  private async tryAcceptRuntimeCoordinatorLateResult(input: {
    request: RuntimeTransportSubmitTaskResultRequest;
    runtimeCoordinatorExecution: RuntimeCoordinatorExecutionRecord | null;
    tokenValidation: Extract<
      RuntimeCoordinatorExecutionTokenValidationResult,
      {
        ok: false;
      }
    >;
    tokenValidationContext: RuntimeCoordinatorTokenValidationContext;
    webSocket: WebSocket;
  }): Promise<boolean> {
    const recoverable = isRuntimeCoordinatorLateResultRecoverable({
      executionStatus: input.runtimeCoordinatorExecution?.status ?? null,
      taskResultStatus: input.request.taskResult.payload.status,
      terminalReasonCode:
        input.runtimeCoordinatorExecution?.terminalOutcome?.reasonCode ?? null,
      tokenRunMatched: input.tokenValidation.run !== null,
      tokenValidationReasonCode: input.tokenValidation.reasonCode,
    });
    if (!(recoverable && input.tokenValidation.run)) {
      return false;
    }
    const contextRejection = await this.resolveExecutionContextResultRejection(
      input.request,
      input.tokenValidationContext
    );
    if (contextRejection) {
      this.sendSubmitTaskResultResponseFrame(
        input.webSocket,
        input.request,
        contextRejection
      );
      return true;
    }
    const db = getPostgresDatabase(this.env);
    const attemptId = resolveSubmitResultAttemptId(input.request);
    const targetProfileId = normalizeOptionalText(
      input.request.taskResult.payload.agentId
    );
    const taskId = normalizeOptionalText(
      input.request.taskResult.payload.taskId
    );
    const inboxAcceptance =
      db && attemptId && targetProfileId && taskId
        ? await acceptDispatchResultInboxRecord(db, {
            acceptedAtMs: Date.now(),
            attemptId,
            daemonSessionId: input.request.daemonSessionId,
            dispatchId: input.request.dispatchId,
            executionTokenFingerprint:
              input.tokenValidation.run.tokenFingerprint,
            executionTokenRunId: input.tokenValidation.run.runId,
            leaseEpoch: input.request.leaseEpoch,
            publishState: "late_result_available",
            runtimeCoordinatorExecutionId:
              input.tokenValidationContext.runtimeCoordinatorExecutionId,
            submittedConnectionGeneration: input.request.connectionGeneration,
            targetProfileId,
            taskId,
            taskResult: input.request.taskResult,
          })
        : ({
            ok: false,
            reasonCode: "daemon.result.inbox_unavailable",
            status: "retry_later",
          } as const);
    let response: RuntimeTransportSubmitTaskResultResponse = inboxAcceptance.ok
      ? { ok: true, status: "accepted" }
      : inboxAcceptance;
    if (inboxAcceptance.ok && db && attemptId) {
      try {
        const published =
          await this.publishRuntimeCoordinatorLateResultAvailable({
            attemptId,
            db,
            dispatchId: input.request.dispatchId,
            runtimeCoordinatorExecutionId:
              input.tokenValidationContext.runtimeCoordinatorExecutionId,
          });
        if (!published) {
          response = {
            ok: false,
            reasonCode: "daemon.result.finalization_unavailable",
            status: "retry_later",
          };
        }
      } catch (error) {
        response = {
          ok: false,
          reasonCode: "daemon.result.finalization_unavailable",
          status: "retry_later",
        };
        console.warn(
          "[core.runtime_transport.late_result_available_publication_failed]",
          {
            attemptId,
            dispatchId: input.request.dispatchId,
            error: error instanceof Error ? error.message : String(error),
            runtimeCoordinatorExecutionId:
              input.tokenValidationContext.runtimeCoordinatorExecutionId,
          }
        );
      }
    }
    this.sendSubmitTaskResultResponseFrame(
      input.webSocket,
      input.request,
      response
    );
    this.queueHousekeepingAlarmSync();
    return true;
  }
  private async publishRuntimeCoordinatorLateResultAvailable(input: {
    attemptId: string;
    db: PostgresDatabase;
    dispatchId: string;
    runtimeCoordinatorExecutionId: string;
  }): Promise<boolean> {
    const inboxRecord = await readDispatchResultInboxRecord(input.db, {
      attemptId: input.attemptId,
      dispatchId: input.dispatchId,
    });
    if (!inboxRecord || inboxRecord.publishState !== "late_result_available") {
      return false;
    }
    if (inboxRecord.publishedSignalId) {
      return true;
    }
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      input.runtimeCoordinatorExecutionId
    );
    if (!commandState) {
      return false;
    }
    const request = commandState.sanitizedDeliveryRequest;
    const payload = request.payload;
    const actorName =
      payload.targetProfileName ?? payload.targetProfileMentionLabel ?? null;
    const publication = await emitSpaceExecutionRecoveryNoticeSignal({
      env: this.env,
      spaceId: payload.spaceId,
      profile: {
        kind: "system",
        profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
        profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
      },
      data: {
        noticeType: "execution_recovery_available",
        actorProfileId: payload.targetProfileId,
        ...(actorName ? { actorName } : {}),
        dispatchId: payload.dispatchId,
        generatedBy: "openmeld",
        reason: "runtime_coordinator.late_result_available",
        reasonCode: "runtime_coordinator.late_result_available",
        resultRef: inboxRecord.resultKey,
        ...(payload.replyToSnapshot
          ? { replyTo: payload.replyToSnapshot }
          : {}),
        text: `${actorName ?? "This agent"} completed this Wake after the connection was lost. OpenMeld retained the result. Do not retry this Wake; open diagnostics to inspect the retained-result evidence.`,
      },
      spaceAccess: createDispatchContinuationSpaceAccessContext({
        attemptId: request.attemptId,
        dispatchId: request.dispatchId,
        password: payload.spacePassword ?? null,
        requestContext: {
          actorContext: {
            requestId: `runtime-coordinator-late-result-${request.dispatchId}`,
            openMeldProfileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
            profileKind: "system",
            profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
            ...(payload.dispatchChainId
              ? { dispatchChainId: payload.dispatchChainId }
              : {}),
            ...(typeof payload.autoRelayDepth === "number"
              ? { autoRelayDepth: payload.autoRelayDepth }
              : {}),
            ...(payload.visitedProfileIds
              ? { visitedProfileIds: payload.visitedProfileIds }
              : {}),
            ...(payload.visitedProfileIdsHash
              ? { visitedProfileIdsHash: payload.visitedProfileIdsHash }
              : {}),
          },
        },
        sourceSignalId: payload.sourceEventId,
        spaceId: payload.spaceId,
        targetProfileId: payload.targetProfileId,
      }),
      ...(payload.threadContext
        ? { threadContext: payload.threadContext }
        : {}),
    });
    const update = await updateDispatchResultInboxPublishState(input.db, {
      attemptId: input.attemptId,
      dispatchId: input.dispatchId,
      publishedSignalId: publication.publishedSignalId,
      publishState: "late_result_available",
      updatedAtMs: Date.now(),
    });
    return update.status === "updated";
  }
  private sendSubmitTaskResultResponseFrame(
    webSocket: WebSocket,
    request: RuntimeTransportSubmitTaskResultRequest,
    response: RuntimeTransportSubmitTaskResultResponse
  ): void {
    this.sendFrame(webSocket, {
      code: "daemon.dispatch.accepted",
      payload: {
        attemptId: request.attemptId ?? null,
        dispatchId: request.dispatchId,
        ok: response.ok,
        status: response.status,
        ...("reasonCode" in response
          ? { reasonCode: response.reasonCode }
          : {}),
      },
    });
  }
  private async finalizeDurableDispatchResult(result: {
    acceptedAtMs: number;
    acceptedResultStatus: "accepted" | "already_accepted";
    attemptId: string;
    daemonSessionId: string;
    dispatchId: string;
    executionTokenFingerprint?: string | null;
    executionTokenRunId?: string | null;
    finalizationRequired?: boolean;
    leaseEpoch: number;
    runtimeCoordinatorExecutionId?: string | null;
    spaceId: string | null;
    submittedConnectionGeneration: number;
    settledFinalization?: {
      command: RuntimeCoordinatorFinalizationCommand;
      outcome: RuntimeCoordinatorFinalizationOutcome;
    } | null;
    targetProfileId: string;
    taskId: string;
    taskResult: OpenMeldDaemonTaskResultEnvelope;
  }): Promise<
    | {
        ok: true;
      }
    | {
        ok: false;
        reasonCode: "daemon.result.finalization_unavailable";
        status: "retry_later";
      }
  > {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    const spaceId = normalizeOptionalText(result.spaceId);
    const runtimeCoordinatorExecutionId = normalizeOptionalText(
      result.runtimeCoordinatorExecutionId
    );
    const executionTokenRunId = normalizeOptionalText(
      result.executionTokenRunId
    );
    if (!(spaceId && runtimeCoordinatorExecutionId && executionTokenRunId)) {
      console.warn(
        "[core.runtime_transport.result_finalization_missing_space]",
        {
          attemptId: result.attemptId,
          dispatchId: result.dispatchId,
          hasExecutionTokenRunId: Boolean(executionTokenRunId),
          hasRuntimeCoordinatorExecutionId: Boolean(
            runtimeCoordinatorExecutionId
          ),
          reasonCode: "daemon.result.finalization_unavailable",
          spaceId,
        }
      );
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    if (result.settledFinalization) {
      return await this.finalizeSettledDurableDispatchResult({
        ...result,
        db,
        executionTokenRunId,
        runtimeCoordinatorExecutionId,
        settledFinalization: result.settledFinalization,
        spaceId,
      });
    }
    let command: RuntimeCoordinatorFinalizationCommand | null;
    try {
      command = await this.prepareRuntimeCoordinatorFinalizationCommand({
        ...result,
        db,
        executionTokenRunId,
        persistForReplay: true,
        runtimeCoordinatorExecutionId,
        spaceId,
      });
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_command_write_failed]",
        {
          attemptId: result.attemptId,
          dispatchId: result.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode: "daemon.result.finalization_unavailable",
          runtimeCoordinatorExecutionId,
          spaceId,
        }
      );
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    if (!command) {
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    await this.retireAcceptedRuntimeCoordinatorTokenRun({
      runId: executionTokenRunId,
      runtimeCoordinatorExecutionId,
    });
    // The daemon receipt needs durable cloud acceptance only: the command is
    // persisted and its retry entry is seeded (inside prepare… above), so the
    // finalization retry alarm replays this command even if the DO is evicted
    // before the waitUntil work runs. The Space publish never fed the receipt
    // result (replay converts publish failures into outcome records), so
    // moving it off the await changes timing only: the daemon stops holding
    // its result outbox record through the cross-DO publish window.
    this.ctx.waitUntil(
      this.replayRuntimeCoordinatorFinalizationCommand({
        attemptId: result.attemptId,
        dispatchId: result.dispatchId,
        executionTokenRunId,
        preloadedCommand: command,
        runtimeCoordinatorExecutionId,
        spaceId,
      }).catch((error) => {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_finalization_replay_failed]",
          {
            attemptId: result.attemptId,
            dispatchId: result.dispatchId,
            error: error instanceof Error ? error.message : String(error),
            runtimeCoordinatorExecutionId,
            spaceId,
          }
        );
      })
    );
    return { ok: true };
  }
  private async finalizeSettledDurableDispatchResult(input: {
    acceptedAtMs: number;
    attemptId: string;
    daemonSessionId: string;
    db: PostgresDatabase;
    dispatchId: string;
    executionTokenFingerprint?: string | null;
    executionTokenRunId: string;
    finalizationRequired?: boolean;
    leaseEpoch: number;
    runtimeCoordinatorExecutionId: string;
    settledFinalization: {
      command: RuntimeCoordinatorFinalizationCommand;
      outcome: RuntimeCoordinatorFinalizationOutcome;
    };
    spaceId: string;
    submittedConnectionGeneration: number;
    targetProfileId: string;
    taskId: string;
    taskResult: OpenMeldDaemonTaskResultEnvelope;
  }): Promise<
    | {
        ok: true;
      }
    | {
        ok: false;
        reasonCode: "daemon.result.finalization_unavailable";
        status: "retry_later";
      }
  > {
    const { command, outcome } = input.settledFinalization;
    if (
      !(
        outcome.ok &&
        outcome.finalizationCommandId === command.finalizationCommandId &&
        this.isRuntimeCoordinatorFinalizationCommandForDispatch(command, input)
      )
    ) {
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    try {
      await this.persistRuntimeCoordinatorFinalizationCommand({
        command,
        db: input.db,
      });
      await this.ctx.storage.put(
        buildRuntimeCoordinatorFinalizationOutcomeStorageKey(
          command.finalizationCommandId
        ),
        outcome
      );
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_command_write_failed]",
        {
          attemptId: input.attemptId,
          dispatchId: input.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode: "daemon.result.finalization_unavailable",
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
          spaceId: input.spaceId,
        }
      );
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    await this.retireAcceptedRuntimeCoordinatorTokenRun({
      runId: input.executionTokenRunId,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    });
    this.ctx.waitUntil(
      this.replayRuntimeCoordinatorFinalizationCommand({
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        executionTokenRunId: input.executionTokenRunId,
        preloadedCommand: command,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        spaceId: input.spaceId,
      }).catch((error) => {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_finalization_replay_failed]",
          {
            attemptId: input.attemptId,
            dispatchId: input.dispatchId,
            error: error instanceof Error ? error.message : String(error),
            runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
            spaceId: input.spaceId,
          }
        );
      })
    );
    return { ok: true };
  }
  private async settleDurableDispatchResult(result: {
    acceptedAtMs: number;
    attemptId: string;
    daemonSessionId: string;
    dispatchId: string;
    executionTokenFingerprint?: string | null;
    executionTokenRunId?: string | null;
    finalizationRequired?: boolean;
    leaseEpoch: number;
    runtimeCoordinatorExecutionId?: string | null;
    spaceId: string | null;
    submittedConnectionGeneration: number;
    targetProfileId: string;
    taskId: string;
    taskResult: OpenMeldDaemonTaskResultEnvelope;
  }): Promise<
    | {
        ok: true;
        settledFinalization: {
          command: RuntimeCoordinatorFinalizationCommand;
          outcome: RuntimeCoordinatorFinalizationOutcome;
        } | null;
      }
    | {
        ok: false;
        reasonCode: "space.agent_reply.context_changed";
        status: "review_required";
      }
    | {
        ok: false;
        reasonCode: "daemon.result.finalization_unavailable";
        status: "retry_later";
      }
  > {
    const db = getPostgresDatabase(this.env);
    const spaceId = normalizeOptionalText(result.spaceId);
    const runtimeCoordinatorExecutionId = normalizeOptionalText(
      result.runtimeCoordinatorExecutionId
    );
    const executionTokenRunId = normalizeOptionalText(
      result.executionTokenRunId
    );
    if (
      !(db && spaceId && runtimeCoordinatorExecutionId && executionTokenRunId)
    ) {
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    const command = await this.prepareRuntimeCoordinatorFinalizationCommand({
      ...result,
      db,
      executionTokenRunId,
      persistForReplay: false,
      runtimeCoordinatorExecutionId,
      spaceId,
    }).catch(() => null);
    if (!command) {
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    if (
      await this.suppressRuntimeCoordinatorFinalizationAfterWakeStop({
        command,
        db,
      })
    ) {
      return { ok: true, settledFinalization: null };
    }
    const spaceStub = resolveSpaceStub(this.env.OPENMELD_SPACES, spaceId);
    if (!spaceStub) {
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    let rawOutcome: unknown;
    try {
      rawOutcome =
        await spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand(command);
    } catch (error) {
      console.warn("[core.runtime_transport.agent_reply_settlement_failed]", {
        attemptId: result.attemptId,
        dispatchId: result.dispatchId,
        error: error instanceof Error ? error.message : String(error),
        runtimeCoordinatorExecutionId,
        spaceId,
      });
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    const parsedOutcome =
      runtimeCoordinatorFinalizationOutcomeSchema.safeParse(rawOutcome);
    if (!parsedOutcome.success) {
      return {
        ok: false,
        reasonCode: "daemon.result.finalization_unavailable",
        status: "retry_later",
      };
    }
    if (parsedOutcome.data.status === "review_required") {
      return {
        ok: false,
        reasonCode: "space.agent_reply.context_changed",
        status: "review_required",
      };
    }
    if (
      !parsedOutcome.data.ok &&
      (await this.suppressRuntimeCoordinatorFinalizationAfterWakeStop({
        command,
        db,
      }))
    ) {
      return { ok: true, settledFinalization: null };
    }
    return parsedOutcome.data.ok
      ? {
          ok: true,
          settledFinalization: { command, outcome: parsedOutcome.data },
        }
      : {
          ok: false,
          reasonCode: "daemon.result.finalization_unavailable",
          status: "retry_later",
        };
  }
  private async replayRuntimeCoordinatorFinalizationCommand(input: {
    attemptId: string;
    dispatchId: string;
    executionTokenRunId: string;
    // Hot-path callers that just wrote the command pass it in-memory to skip
    // the storage re-read; the alarm retry entry point has no in-memory
    // command and keeps the storage read.
    preloadedCommand?: RuntimeCoordinatorFinalizationCommand;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
  }): Promise<
    | {
        ok: true;
        outcome: RuntimeCoordinatorFinalizationOutcome;
      }
    | {
        ok: true;
        reasonCode: "runtime_coordinator.wake_stop_requested";
        status: "suppressed";
      }
    | RuntimeCoordinatorFinalizationReplayFailure
  > {
    const activeRecovery = this.runtimeCoordinatorFinalizationRecoveryTails.get(
      input.runtimeCoordinatorExecutionId
    );
    if (activeRecovery) {
      const recovery =
        await this.waitForRuntimeCoordinatorFinalizationWork(activeRecovery);
      if (recovery.status === "in_flight") {
        return rejectRuntimeCoordinatorFinalizationReplay({
          publicationUncertain: true,
        });
      }
      if (!recovery.value) {
        return rejectRuntimeCoordinatorFinalizationReplay({
          publicationUncertain: true,
        });
      }
      return recovery.value;
    }
    const serialized = await this.runSerializedRuntimeCoordinatorFinalization({
      run: () =>
        this.replayRuntimeCoordinatorFinalizationCommandUnserialized(input),
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    });
    if (serialized.status === "completed") {
      return serialized.value;
    }
    const recovery =
      await this.runBoundedRuntimeCoordinatorFinalizationRecovery(input);
    const recovered = recovery.status === "completed" ? recovery.value : null;
    return (
      recovered ??
      rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      })
    );
  }
  private async recoverRuntimeCoordinatorFinalizationFromSpaceClaim(input: {
    attemptId: string;
    dispatchId: string;
    executionTokenRunId: string;
    preloadedClaimRead?: RuntimeCoordinatorFinalizationClaimRead;
    preloadedCommand?: RuntimeCoordinatorFinalizationCommand;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
  }): Promise<RuntimeCoordinatorFinalizationRecoveryResult> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return null;
    }
    const command =
      input.preloadedCommand &&
      this.isRuntimeCoordinatorFinalizationCommandForDispatch(
        input.preloadedCommand,
        input
      )
        ? input.preloadedCommand
        : await this.readRuntimeCoordinatorFinalizationCommandForReplay({
            db,
            attemptId: input.attemptId,
            dispatchId: input.dispatchId,
            executionTokenRunId: input.executionTokenRunId,
            runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
            spaceId: input.spaceId,
          });
    if (!command) {
      return null;
    }
    const claimRead =
      input.preloadedClaimRead ??
      (await this.readRuntimeCoordinatorFinalizationClaim(command));
    if (!claimRead || claimRead.status === "unresolved") {
      return null;
    }
    if (claimRead.status === "wake_stopped_visible") {
      const suppressed =
        await this.suppressRuntimeCoordinatorFinalizationAfterWakeStop({
          command,
          db,
        });
      return suppressed
        ? {
            ok: true,
            reasonCode: "runtime_coordinator.wake_stop_requested",
            status: "suppressed",
          }
        : null;
    }
    if (claimRead.status === "publication_failed_visible") {
      return null;
    }
    const outcome = claimRead.outcome;
    if (
      outcome.finalizationCommandId !== command.finalizationCommandId ||
      outcome.publishState !== "reply_published" ||
      !outcome.publishedSignalId
    ) {
      return null;
    }
    const replayed =
      await this.replayRuntimeCoordinatorFinalizationCommandUnserialized({
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        executionTokenRunId: input.executionTokenRunId,
        expectedVisibleOutcome: outcome,
        preloadedCommand: command,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        spaceId: input.spaceId,
      });
    if (!replayed.ok) {
      return null;
    }
    return replayed;
  }
  private async confirmRuntimeCoordinatorFinalizationTaskOutcome(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    coordinationDb: PostgresDatabase;
    finalMessageKind?: Extract<
      RuntimeCoordinatorFinalizationOutcome,
      {
        ok: true;
      }
    >["finalMessageKind"];
    publishedSignalId: string | null;
    publishState: "invalid_space_action" | "reply_published";
  }): Promise<boolean> {
    try {
      const taskOutcomeWrite =
        await recordRuntimeCoordinatorFinalizationTaskOutcome({
          command: input.command,
          db: input.coordinationDb,
          env: this.env,
          finalMessageKind: input.finalMessageKind,
          publishedSignalId: input.publishedSignalId,
          publishState: input.publishState,
        });
      if (!taskOutcomeWrite || taskOutcomeWrite.matches) {
        return true;
      }
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_task_outcome_conflict]",
        {
          actualEventId: taskOutcomeWrite.storedOutcome.eventId,
          actualStatus: taskOutcomeWrite.storedOutcome.status,
          dispatchId: input.command.dispatchId,
          expectedEventId: taskOutcomeWrite.expectedOutcome.eventId,
          expectedStatus: taskOutcomeWrite.expectedOutcome.status,
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
          spaceId: input.command.spaceId,
        }
      );
      return false;
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_task_outcome_failed]",
        {
          dispatchId: input.command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
          spaceId: input.command.spaceId,
        }
      );
      return false;
    }
  }
  private async readRuntimeCoordinatorFinalizationClaim(
    command: RuntimeCoordinatorFinalizationCommand
  ): Promise<RuntimeCoordinatorFinalizationClaimRead | null> {
    const spaceStub = resolveSpaceStub(
      this.env.OPENMELD_SPACES,
      command.spaceId
    );
    if (!spaceStub?.rpcReadRuntimeCoordinatorFinalizationClaimOutcome) {
      return null;
    }
    let rawOutcome: unknown;
    try {
      rawOutcome =
        await spaceStub.rpcReadRuntimeCoordinatorFinalizationClaimOutcome(
          command
        );
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_claim_read_failed]",
        {
          dispatchId: command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: command.finalizationCommandId,
          runtimeCoordinatorExecutionId: command.runtimeCoordinatorExecutionId,
          spaceId: command.spaceId,
        }
      );
      return null;
    }
    const claimRead =
      runtimeCoordinatorFinalizationClaimReadSchema.safeParse(rawOutcome);
    if (!claimRead.success) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_claim_invalid]",
        {
          dispatchId: command.dispatchId,
          finalizationCommandId: command.finalizationCommandId,
          issue:
            claimRead.error.issues[0]?.message ??
            "Space finalization claim did not match the shared schema.",
          runtimeCoordinatorExecutionId: command.runtimeCoordinatorExecutionId,
          spaceId: command.spaceId,
        }
      );
      return null;
    }
    return claimRead.data;
  }
  private async applyRuntimeCoordinatorPublicationExhaustion(
    command: RuntimeCoordinatorFinalizationCommand
  ): Promise<RuntimeCoordinatorFinalizationClaimRead | null> {
    const spaceStub = resolveSpaceStub(
      this.env.OPENMELD_SPACES,
      command.spaceId
    );
    if (!spaceStub) {
      return null;
    }
    let rawOutcome: unknown;
    try {
      rawOutcome =
        await spaceStub.rpcApplyRuntimeCoordinatorPublicationExhaustionCommand(
          command
        );
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_publication_exhaustion_apply_failed]",
        {
          dispatchId: command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: command.finalizationCommandId,
          runtimeCoordinatorExecutionId: command.runtimeCoordinatorExecutionId,
          spaceId: command.spaceId,
        }
      );
      return null;
    }
    const claimRead =
      runtimeCoordinatorFinalizationClaimReadSchema.safeParse(rawOutcome);
    if (!claimRead.success) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_publication_exhaustion_outcome_invalid]",
        {
          dispatchId: command.dispatchId,
          finalizationCommandId: command.finalizationCommandId,
          issue:
            claimRead.error.issues[0]?.message ??
            "Space publication exhaustion outcome did not match the shared schema.",
          runtimeCoordinatorExecutionId: command.runtimeCoordinatorExecutionId,
          spaceId: command.spaceId,
        }
      );
      return null;
    }
    return claimRead.data;
  }
  private async replayRuntimeCoordinatorFinalizationCommandUnserialized(input: {
    attemptId: string;
    dispatchId: string;
    executionTokenRunId: string;
    expectedVisibleOutcome?: Extract<
      RuntimeCoordinatorFinalizationOutcome,
      {
        ok: true;
      }
    >;
    preloadedCommand?: RuntimeCoordinatorFinalizationCommand;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
  }): Promise<
    | {
        ok: true;
        outcome: RuntimeCoordinatorFinalizationOutcome;
      }
    | {
        ok: true;
        reasonCode: "runtime_coordinator.wake_stop_requested";
        status: "suppressed";
      }
    | RuntimeCoordinatorFinalizationReplayFailure
  > {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return rejectRuntimeCoordinatorFinalizationReplay();
    }
    const command =
      input.preloadedCommand &&
      this.isRuntimeCoordinatorFinalizationCommandForDispatch(
        input.preloadedCommand,
        input
      )
        ? input.preloadedCommand
        : await this.readRuntimeCoordinatorFinalizationCommandForReplay({
            db,
            attemptId: input.attemptId,
            dispatchId: input.dispatchId,
            executionTokenRunId: input.executionTokenRunId,
            runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
            spaceId: input.spaceId,
          });
    if (!command) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        blockerReasonCode: "runtime_coordinator.finalization_command_missing",
        retryable: false,
      });
    }
    const storedOutcome = await this.readRuntimeCoordinatorFinalizationOutcome(
      command.finalizationCommandId
    );
    if (storedOutcome?.ok) {
      return await this.repairStoredRuntimeCoordinatorFinalizationSuccess({
        command,
        db,
        expectedVisibleOutcome: input.expectedVisibleOutcome,
        outcome: storedOutcome,
      });
    }
    const suppressed =
      await this.suppressRuntimeCoordinatorFinalizationAfterWakeStop({
        command,
        db,
      });
    if (suppressed) {
      return {
        ok: true,
        reasonCode: "runtime_coordinator.wake_stop_requested",
        status: "suppressed",
      };
    }
    const spaceStub = resolveSpaceStub(
      this.env.OPENMELD_SPACES,
      command.spaceId
    );
    if (!spaceStub) {
      return await this.resolveMissingRuntimeCoordinatorFinalizationSpace({
        command,
        db,
        preserveVisibleClaim: Boolean(input.expectedVisibleOutcome),
      });
    }
    let rawOutcome: unknown;
    try {
      rawOutcome =
        await spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand(command);
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_failed]",
        {
          attemptId: input.attemptId,
          dispatchId: input.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode: "daemon.result.finalization_unavailable",
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
          spaceId: input.spaceId,
        }
      );
      const suppressedAfterPublicationFailure =
        await this.suppressRuntimeCoordinatorFinalizationAfterWakeStop({
          command,
          db,
        });
      if (suppressedAfterPublicationFailure) {
        return {
          ok: true,
          reasonCode: "runtime_coordinator.wake_stop_requested",
          status: "suppressed",
        };
      }
      if (input.expectedVisibleOutcome) {
        return rejectRuntimeCoordinatorFinalizationReplay({
          publicationUncertain: true,
        });
      }
      const outcome = this.buildRuntimeCoordinatorFinalizationFailureOutcome({
        command,
        reasonCode: "daemon.result.finalization_unavailable",
      });
      const streamSettled = await this.settleLocalAgentStreamForFinalization({
        command,
        outcome,
      });
      if (!streamSettled) {
        return rejectRuntimeCoordinatorFinalizationReplay();
      }
      const outcomeWrite =
        await this.writeRuntimeCoordinatorFinalizationOutcome({
          command,
          db,
          outcome,
        });
      return { ok: true, outcome: outcomeWrite.outcome };
    }
    const resolvedOutcome =
      await this.resolveAppliedRuntimeCoordinatorFinalizationOutcome({
        command,
        expectedVisibleOutcome: input.expectedVisibleOutcome,
        rawOutcome,
      });
    if (!resolvedOutcome.ok) {
      return resolvedOutcome;
    }
    return await this.completeRuntimeCoordinatorFinalizationReplay({
      command,
      db,
      outcome: resolvedOutcome.outcome,
    });
  }
  private async resolveAppliedRuntimeCoordinatorFinalizationOutcome(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    expectedVisibleOutcome?: Extract<
      RuntimeCoordinatorFinalizationOutcome,
      {
        ok: true;
      }
    >;
    rawOutcome: unknown;
  }): Promise<RuntimeCoordinatorFinalizationOutcomeReplayResult> {
    const parsedOutcome = runtimeCoordinatorFinalizationOutcomeSchema.safeParse(
      input.rawOutcome
    );
    if (!parsedOutcome.success && input.expectedVisibleOutcome) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    let outcome = parsedOutcome.success
      ? parsedOutcome.data
      : this.buildRuntimeCoordinatorFinalizationFailureOutcome({
          command: input.command,
          reasonCode: "runtime_coordinator.finalization_outcome_invalid",
        });
    if (outcome.ok && outcome.finalMessageKind === undefined) {
      let visibleOutcome = input.expectedVisibleOutcome;
      if (!visibleOutcome) {
        const claimRead = await this.readRuntimeCoordinatorFinalizationClaim(
          input.command
        );
        if (claimRead?.status !== "finalization_visible") {
          return rejectRuntimeCoordinatorFinalizationReplay({
            publicationUncertain: true,
          });
        }
        visibleOutcome = claimRead.outcome;
      }
      const upgradedOutcome =
        upgradeLegacyRuntimeCoordinatorFinalizationOutcomeFromVisibleClaim(
          outcome,
          visibleOutcome
        );
      if (!upgradedOutcome) {
        return rejectRuntimeCoordinatorFinalizationReplay({
          publicationUncertain: true,
        });
      }
      outcome = upgradedOutcome;
    }
    if (
      input.expectedVisibleOutcome &&
      !runtimeCoordinatorFinalizationOutcomeMatchesVisibleClaim(
        outcome,
        input.expectedVisibleOutcome
      )
    ) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    return { ok: true, outcome };
  }
  private async resolveMissingRuntimeCoordinatorFinalizationSpace(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    preserveVisibleClaim: boolean;
  }): Promise<RuntimeCoordinatorFinalizationOutcomeReplayResult> {
    if (input.preserveVisibleClaim) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    const outcome = await this.writeRuntimeCoordinatorFinalizationFailure({
      command: input.command,
      db: input.db,
      reasonCode: "daemon.result.finalization_unavailable",
    });
    return { ok: true, outcome };
  }
  private async completeRuntimeCoordinatorFinalizationReplay(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    outcome: RuntimeCoordinatorFinalizationOutcome;
  }): Promise<
    | RuntimeCoordinatorFinalizationOutcomeReplayResult
    | {
        ok: true;
        reasonCode: "runtime_coordinator.wake_stop_requested";
        status: "suppressed";
      }
  > {
    const { command, db, outcome } = input;
    if (outcome.status === "review_required") {
      // This result was already durably accepted. Unlike synchronous Service
      // settlement, there is no live caller responsible for replacing it.
      // Replaying this immutable proposal cannot re-check changed context. Its
      // safe publication attempts are exhausted, even without a storage outage.
      // Use the existing Space final-claim failure path; never re-run the Agent.
      const nowMs = Date.now();
      const retryEntry = await this.buildRuntimeCoordinatorFinalizationRetry({
        command,
        nowMs,
        nextReplayAtMs: nowMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
      });
      if (retryEntry.attemptCount <= 2) {
        console.warn(
          "[core.runtime_transport.accepted_reply_review_requires_recovery]",
          {
            dispatchId: command.dispatchId,
            finalizationCommandId: command.finalizationCommandId,
            reasonCode: outcome.publicationErrorCode,
            runtimeCoordinatorExecutionId:
              command.runtimeCoordinatorExecutionId,
            spaceId: command.spaceId,
            targetProfileId: command.targetProfileId,
          }
        );
      }
      await this.storeRuntimeCoordinatorFinalizationRetryOrPark({
        db,
        publicationCannotContinue: true,
        queueAlarm: true,
        retryEntry,
      });
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    if (
      !outcome.ok &&
      (await this.suppressRuntimeCoordinatorFinalizationAfterWakeStop({
        command,
        db,
      }))
    ) {
      return {
        ok: true,
        reasonCode: "runtime_coordinator.wake_stop_requested",
        status: "suppressed",
      };
    }
    const coordinationDb = getPostgresDatabase(this.env);
    if (
      outcome.ok &&
      !(
        coordinationDb &&
        (await this.confirmRuntimeCoordinatorFinalizationTaskOutcome({
          command,
          coordinationDb,
          finalMessageKind: outcome.finalMessageKind,
          publishedSignalId: outcome.publishedSignalId,
          publishState: outcome.publishState,
        }))
      )
    ) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    const streamSettled = await this.settleLocalAgentStreamForFinalization({
      command,
      outcome,
    });
    const outcomeWrite = await this.writeRuntimeCoordinatorFinalizationOutcome({
      command,
      db,
      keepRetryOnSuccess: !streamSettled,
      outcome,
      taskOutcomeConfirmed: outcome.ok,
    });
    return this.resolveRuntimeCoordinatorFinalizationOutcomeReplay({
      outcomeWrite,
      streamSettled,
    });
  }
  private resolveRuntimeCoordinatorFinalizationOutcomeReplay(input: {
    outcomeWrite: RuntimeCoordinatorFinalizationOutcomeWriteResult;
    streamSettled: boolean;
  }): RuntimeCoordinatorFinalizationOutcomeReplayResult {
    if (!input.streamSettled || input.outcomeWrite.recoveryPending) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    return { ok: true, outcome: input.outcomeWrite.outcome };
  }
  private async repairStoredRuntimeCoordinatorFinalizationSuccess(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    expectedVisibleOutcome?: Extract<
      RuntimeCoordinatorFinalizationOutcome,
      {
        ok: true;
      }
    >;
    outcome: Extract<
      RuntimeCoordinatorFinalizationOutcome,
      {
        ok: true;
      }
    >;
  }): Promise<RuntimeCoordinatorFinalizationOutcomeReplayResult> {
    let expectedVisibleOutcome = input.expectedVisibleOutcome;
    if (
      input.outcome.finalMessageKind === undefined &&
      !expectedVisibleOutcome
    ) {
      const claimRead = await this.readRuntimeCoordinatorFinalizationClaim(
        input.command
      );
      if (claimRead?.status !== "finalization_visible") {
        return rejectRuntimeCoordinatorFinalizationReplay({
          publicationUncertain: true,
        });
      }
      expectedVisibleOutcome = claimRead.outcome;
    }
    const outcome = expectedVisibleOutcome
      ? upgradeLegacyRuntimeCoordinatorFinalizationOutcomeFromVisibleClaim(
          input.outcome,
          expectedVisibleOutcome
        )
      : input.outcome;
    if (
      !outcome ||
      (expectedVisibleOutcome &&
        !runtimeCoordinatorFinalizationOutcomeMatchesVisibleClaim(
          outcome,
          expectedVisibleOutcome
        ))
    ) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    const coordinationDb = getPostgresDatabase(this.env);
    if (
      !(
        coordinationDb &&
        (await this.confirmRuntimeCoordinatorFinalizationTaskOutcome({
          command: input.command,
          coordinationDb,
          finalMessageKind: outcome.finalMessageKind,
          publishedSignalId: outcome.publishedSignalId,
          publishState: outcome.publishState,
        }))
      )
    ) {
      return rejectRuntimeCoordinatorFinalizationReplay({
        publicationUncertain: true,
      });
    }
    const streamSettled = await this.settleLocalAgentStreamForFinalization({
      command: input.command,
      outcome,
    });
    const outcomeWrite = await this.writeRuntimeCoordinatorFinalizationOutcome({
      command: input.command,
      db: input.db,
      keepRetryOnSuccess: !streamSettled,
      outcome,
      taskOutcomeConfirmed: true,
    });
    return this.resolveRuntimeCoordinatorFinalizationOutcomeReplay({
      outcomeWrite,
      streamSettled,
    });
  }
  private async settleLocalAgentStreamForFinalization(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    outcome: RuntimeCoordinatorFinalizationOutcome;
  }): Promise<boolean> {
    if (!input.outcome.ok) {
      return true;
    }
    await this.closeLocalAgentStreamOrScheduleRetry({
      attemptId: input.command.acceptedResult.attemptId,
      dispatchId: input.command.dispatchId,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      spaceId: input.command.spaceId,
      terminal: buildLocalAgentStreamTerminal(input),
    });
    return true;
  }
  private async closeLocalAgentStreamOrScheduleRetry(input: {
    attemptId: string;
    dispatchId: string;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
    terminal: SpaceAgentStreamTerminal;
  }): Promise<void> {
    const streamId = buildLocalAgentStreamId(input);
    const closed = await this.tryCloseLocalAgentStream({
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      spaceId: input.spaceId,
      streamId,
      terminal: input.terminal,
    });
    if (closed) {
      await removeLocalAgentStreamClosureRetryEntry({
        storage: this.ctx.storage,
        streamId,
      });
      return;
    }
    const nowMs = Date.now();
    const existing = await readLocalAgentStreamClosureRetryEntry({
      storage: this.ctx.storage,
      streamId,
    });
    const retryEntry = existing
      ? incrementLocalAgentStreamClosureRetryEntry({ entry: existing, nowMs })
      : createLocalAgentStreamClosureRetryEntry({ ...input, nowMs });
    await upsertLocalAgentStreamClosureRetryEntry({
      entry: retryEntry,
      storage: this.ctx.storage,
    });
    this.queueHousekeepingAlarmSync();
  }
  private async tryCloseLocalAgentStream(input: {
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
    streamId: string;
    terminal: SpaceAgentStreamTerminal;
  }): Promise<boolean> {
    const spaceStub = resolveSpaceStub(this.env.OPENMELD_SPACES, input.spaceId);
    if (!spaceStub) {
      console.warn("[core.runtime_transport.local_agent_stream_close_failed]", {
        reasonCode: "agent_stream.space_not_found",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        spaceId: input.spaceId,
        streamId: input.streamId,
      });
      return false;
    }
    try {
      await spaceStub.rpcCloseAgentStream({
        spaceId: input.spaceId,
        streamId: input.streamId,
        terminal: input.terminal,
      });
      return true;
    } catch (error) {
      console.warn("[core.runtime_transport.local_agent_stream_close_failed]", {
        error: error instanceof Error ? error.message : String(error),
        reasonCode: "agent_stream.close_failed",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        spaceId: input.spaceId,
        streamId: input.streamId,
      });
      return false;
    }
  }
  private async closeStoppedLocalAgentStreamAfterTerminalLateResult(input: {
    reasonCode: string;
    request: RuntimeTransportSubmitTaskResultRequest;
  }): Promise<void> {
    if (input.reasonCode !== "execution_token_terminal_late") {
      return;
    }
    const runtimeCoordinatorExecutionId = normalizeOptionalText(
      input.request.runtimeCoordinatorExecutionId
    );
    if (!runtimeCoordinatorExecutionId) {
      return;
    }
    const [authority, commandState] = await Promise.all([
      this.readRuntimeCoordinatorTokenAuthority(
        runtimeCoordinatorExecutionId
      ).catch(() => null),
      this.readRuntimeCoordinatorRunCommandState(
        runtimeCoordinatorExecutionId
      ).catch(() => null),
    ]);
    const terminalOutcome = authority?.terminalOutcome;
    if (
      terminalOutcome?.status !== "cancelled" ||
      !commandState ||
      commandState.dispatchId !== input.request.dispatchId ||
      (input.request.attemptId !== null &&
        input.request.attemptId !== undefined &&
        commandState.sanitizedDeliveryRequest.attemptId !==
          input.request.attemptId)
    ) {
      return;
    }
    await this.closeLocalAgentStreamOrScheduleRetry({
      attemptId: commandState.sanitizedDeliveryRequest.attemptId,
      dispatchId: commandState.dispatchId,
      runtimeCoordinatorExecutionId,
      spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
      terminal: buildStoppedLocalAgentStreamTerminal(
        terminalOutcome.reasonCode ??
          RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE
      ),
    });
  }
  private async claimAcceptedRuntimeCoordinatorWakeStop(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    commandState: RuntimeCoordinatorRunCommandState;
    db: PostgresDatabase;
    nowMs: number;
  }): Promise<boolean> {
    const { commandState, nowMs } = input;
    const space = resolveSpaceStub(
      this.env.OPENMELD_SPACES,
      input.command.spaceId
    );
    const claim = runtimeCoordinatorFinalizationClaimReadSchema.safeParse(
      await space?.rpcApplyRuntimeCoordinatorWakeStopCommand?.(input.command)
    );
    if (!claim.success || claim.data.status === "unresolved") {
      throw new Error("runtime_coordinator.stopped_publication_unavailable");
    }
    if (
      claim.data.status === "finalization_visible" ||
      claim.data.status === "publication_failed_visible"
    ) {
      await this.reconcileAcceptedResultFinalClaim({
        ...input,
        claim: claim.data,
      });
      return false;
    }
    // Space atomically elected the final claim before cancellation authority
    // or dependent task outcomes change. A concurrently published reply wins.
    const existing =
      await this.readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        buildRuntimeCoordinatorWakeStoppedNoticePublicationId(
          input.command.runtimeCoordinatorExecutionId
        )
      );
    if (
      existing?.status === "published" &&
      existing.publishedSignalId === claim.data.publishedSignalId
    ) {
      return true;
    }
    await this.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord({
      createdAtMs: nowMs,
      dispatchId: input.command.dispatchId,
      modelVersion:
        RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
      publicationId: buildRuntimeCoordinatorWakeStoppedNoticePublicationId(
        input.command.runtimeCoordinatorExecutionId
      ),
      publishedSignalId: claim.data.publishedSignalId,
      reasonCode:
        resolveLocalExecutionOwnerCancellationReason(
          input.command.acceptedResult.taskResult.payload
        ) ?? RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      spaceId: input.command.spaceId,
      status: "published",
      taskOutcomeProjectedAtMs: null,
      taskOutcomeSourceClientMessageId: commandState.sourceClientMessageId,
      targetProfileId: input.command.targetProfileId,
      targetWakeLifecycleId: projectTargetWakeLifecycleIdentity({
        clientMessageId: commandState.sourceClientMessageId,
        dispatchId: input.command.dispatchId,
        sourceSignalId:
          commandState.sanitizedDeliveryRequest.payload.sourceEventId,
        spaceId: input.command.spaceId,
        targetProfileId: input.command.targetProfileId,
      }).targetWakeLifecycleId,
      updatedAtMs: nowMs,
    });
    return true;
  }
  private async reconcileAcceptedResultFinalClaim(input: {
    claim: Extract<
      RuntimeCoordinatorFinalizationClaimRead,
      {
        status: "finalization_visible" | "publication_failed_visible";
      }
    >;
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    nowMs: number;
  }): Promise<void> {
    if (input.claim.status === "finalization_visible") {
      await this.repairStoredRuntimeCoordinatorFinalizationSuccess({
        command: input.command,
        db: input.db,
        outcome: input.claim.outcome,
      });
      return;
    }
    await this.persistRuntimeCoordinatorFinalizationCommand(input);
    await this.storeRuntimeCoordinatorFinalizationRetryOrPark({
      db: input.db,
      publicationCannotContinue: true,
      queueAlarm: true,
      retryEntry: await this.buildRuntimeCoordinatorFinalizationRetry({
        command: input.command,
        nowMs: input.nowMs,
        nextReplayAtMs:
          input.nowMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
      }),
    });
  }
  private async verifyLocalExecutionOwnerCancellation(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    commandState: RuntimeCoordinatorRunCommandState | null;
    db: PostgresDatabase;
    projection: RuntimeCoordinatorExecutionRecord | null;
  }): Promise<boolean> {
    if (
      !resolveLocalExecutionOwnerCancellationReason(
        input.command.acceptedResult.taskResult.payload
      )
    ) {
      return false;
    }
    // The accepted receipt is durable before the lagging result_received
    // progress update. A cancelled waiter or stale result grants no consent.
    const result = await readDispatchResultInboxRecord(input.db, {
      attemptId: input.command.acceptedResult.attemptId,
      dispatchId: input.command.dispatchId,
    });
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      input.command.runtimeCoordinatorExecutionId
    );
    const run = authority?.runsById[input.command.executionTokenRunId];
    const state = input.commandState;
    if (
      !(
        input.projection &&
        state &&
        result &&
        run &&
        state.activeRunId === input.command.executionTokenRunId &&
        state.dispatchId === input.command.dispatchId &&
        state.attemptId === result.attemptId &&
        state.targetProfileId === input.command.targetProfileId &&
        state.sanitizedDeliveryRequest.payload.spaceId ===
          input.command.spaceId &&
        result.runtimeCoordinatorExecutionId ===
          input.command.runtimeCoordinatorExecutionId &&
        result.executionTokenRunId === run.runId &&
        result.executionTokenFingerprint === run.tokenFingerprint &&
        result.executionTokenFingerprint ===
          input.command.acceptedResult.executionTokenFingerprint &&
        result.targetProfileId === input.command.targetProfileId &&
        resolveLocalExecutionOwnerCancellationReason(
          result.taskResult.payload
        ) ===
          resolveLocalExecutionOwnerCancellationReason(
            input.command.acceptedResult.taskResult.payload
          )
      )
    ) {
      throw new Error("runtime_coordinator.owner_cancellation_unverified");
    }
    return true;
  }
  private async readRuntimeCoordinatorFinalizationStopContext(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
  }) {
    const projection = await readRuntimeCoordinatorExecutionProjectionById({
      db: input.db,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
    }).catch(() => null);
    if (projection && hasNonCancelledFinalOutcome(projection)) {
      return null;
    }
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      input.command.runtimeCoordinatorExecutionId
    );
    const ownerCancellation = await this.verifyLocalExecutionOwnerCancellation({
      ...input,
      commandState,
      projection,
    });
    if (!projection) {
      return null;
    }
    const stopReasonCode = ownerCancellation
      ? (resolveLocalExecutionOwnerCancellationReason(
          input.command.acceptedResult.taskResult.payload
        ) ?? RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE)
      : RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE;
    const wakeStopRequested =
      ownerCancellation ||
      commandState?.lastCommandReasonCode ===
        RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE ||
      projection.status === "cancellation_requested" ||
      projection.status === "cancelled" ||
      (await hasRuntimeCoordinatorWakeStopRequestedEvent({
        db: input.db,
        reasonCode: RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
        runtimeCoordinatorExecutionId:
          input.command.runtimeCoordinatorExecutionId,
      }).catch(() => false));
    if (!wakeStopRequested) {
      return null;
    }
    return { projection, commandState, ownerCancellation, stopReasonCode };
  }
  private async suppressRuntimeCoordinatorFinalizationAfterWakeStop(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
  }): Promise<boolean> {
    const context =
      await this.readRuntimeCoordinatorFinalizationStopContext(input);
    if (!context) {
      return false;
    }
    const { projection, commandState, ownerCancellation, stopReasonCode } =
      context;
    const nowMs = Date.now();
    if (
      commandState &&
      (ownerCancellation ||
        commandState.localProgress.phase === "result_received") &&
      !(await this.claimAcceptedRuntimeCoordinatorWakeStop({
        ...input,
        commandState,
        nowMs,
      }))
    ) {
      return true;
    }
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      input.command.runtimeCoordinatorExecutionId
    ).catch(() => null);
    let stoppedNoticePublication: RuntimeCoordinatorWakeStoppedNoticePublicationResult | null =
      null;
    if (projection.status !== "cancelled") {
      if (authority) {
        await this.writeRuntimeCoordinatorTokenAuthority(
          settleRuntimeCoordinatorAuthorityForCancellationAccepted({
            authority,
            nowMs,
            reasonCode: stopReasonCode,
          })
        );
      }
      await writeRuntimeCoordinatorTerminalExecutionProjectionWithoutRead({
        db: input.db,
        record: buildRuntimeCoordinatorCancelledExecutionRecord({
          nowMs,
          reasonCode: stopReasonCode,
          record: projection,
        }),
      });
    }
    if (commandState) {
      stoppedNoticePublication =
        await this.publishRuntimeCoordinatorWakeStoppedNotice({
          commandState,
          nowMs,
          reasonCode: stopReasonCode,
          stopReason: commandState.stopReason ?? null,
        });
      if (!stoppedNoticePublication.ok) {
        const payload = commandState.sanitizedDeliveryRequest.payload;
        const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
          clientMessageId: commandState.sourceClientMessageId,
          dispatchId: commandState.dispatchId,
          sourceSignalId: payload.sourceEventId,
          spaceId: payload.spaceId,
          targetProfileId: commandState.targetProfileId,
        });
        await this.writeRuntimeCoordinatorPublicationBlocker({
          blockerId: buildRuntimeCoordinatorWakeStoppedNoticePublicationId(
            input.command.runtimeCoordinatorExecutionId
          ),
          blockerKind: "publication_unavailable",
          db: input.db,
          dispatchId: commandState.dispatchId,
          nowMs,
          publicationKind: "stopped_notice",
          reasonCode: stoppedNoticePublication.reasonCode,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
          spaceId: payload.spaceId,
          targetProfileId: commandState.targetProfileId,
          targetWakeLifecycleId:
            targetWakeLifecycleIdentity.targetWakeLifecycleId,
        });
      }
      await this.writeRuntimeCoordinatorRunCommandState({
        ...commandState,
        lastCommandReasonCode:
          RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
        lastWatchdogCheckAtMs: null,
        updatedAtMs: nowMs,
      });
    } else if (projection.status !== "cancelled") {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_stopped_finalization_missing_command_state]",
        {
          dispatchId: input.command.dispatchId,
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
        }
      );
    }
    await updateDispatchResultInboxPublishState(input.db, {
      attemptId: input.command.acceptedResult.attemptId,
      dispatchId: input.command.dispatchId,
      publicationErrorCode: stopReasonCode,
      publishedSignalId: stoppedNoticePublication?.ok
        ? stoppedNoticePublication.publishedSignalId
        : null,
      publishState: "reply_suppressed_stopped",
      updatedAtMs: nowMs,
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_stopped_finalization_inbox_projection_failed]",
        {
          dispatchId: input.command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
        }
      );
    });
    let stoppedNoticePublicationPayload:
      | {
          publishedSignalId: string;
          status: string;
        }
      | {
          reasonCode: string;
          status: string;
        }
      | null = null;
    if (stoppedNoticePublication) {
      stoppedNoticePublicationPayload = stoppedNoticePublication.ok
        ? {
            publishedSignalId: stoppedNoticePublication.publishedSignalId,
            status: stoppedNoticePublication.status,
          }
        : {
            reasonCode: stoppedNoticePublication.reasonCode,
            status: stoppedNoticePublication.status,
          };
    }
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType: "runtime_coordinator_decision_recorded",
      idempotencyKey: `finalization-command:${input.command.finalizationCommandId}:reply_suppressed_stopped`,
      observedAtMs: nowMs,
      payload: {
        attemptId: input.command.acceptedResult.attemptId,
        dispatchId: input.command.dispatchId,
        executionTokenRunId: input.command.executionTokenRunId,
        finalizationCommandId: input.command.finalizationCommandId,
        publishState: "reply_suppressed_stopped",
        resultKey: buildDispatchResultInboxKey({
          attemptId: input.command.acceptedResult.attemptId,
          dispatchId: input.command.dispatchId,
        }),
        stoppedNoticePublication: stoppedNoticePublicationPayload,
      },
      reasonCode: stopReasonCode,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      statusAfter: "cancelled",
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_stopped_finalization_event_failed]",
        {
          dispatchId: input.command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
        }
      );
    });
    await this.closeLocalAgentStreamOrScheduleRetry({
      attemptId: input.command.acceptedResult.attemptId,
      dispatchId: input.command.dispatchId,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      spaceId: input.command.spaceId,
      terminal: buildStoppedLocalAgentStreamTerminal(stopReasonCode),
    });
    if (stoppedNoticePublication?.ok) {
      await this.removeRuntimeCoordinatorFinalizationRetry(
        input.command.finalizationCommandId
      );
    } else {
      throw new Error("runtime_coordinator.stopped_publication_unavailable");
    }
    return true;
  }
  private async prepareRuntimeCoordinatorFinalizationCommand(input: {
    acceptedAtMs: number;
    attemptId: string;
    daemonSessionId: string;
    db: PostgresDatabase;
    dispatchId: string;
    executionTokenFingerprint?: string | null;
    executionTokenRunId: string;
    finalizationRequired?: boolean;
    leaseEpoch: number;
    persistForReplay: boolean;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
    submittedConnectionGeneration: number;
    targetProfileId: string;
    taskId: string;
    taskResult: OpenMeldDaemonTaskResultEnvelope;
  }): Promise<RuntimeCoordinatorFinalizationCommand | null> {
    const commandId = buildRuntimeCoordinatorFinalizationCommandId({
      executionTokenRunId: input.executionTokenRunId,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    });
    const existing =
      await this.readRuntimeCoordinatorFinalizationCommand(commandId);
    if (existing) {
      return this.isRuntimeCoordinatorFinalizationCommandForDispatch(
        existing,
        input
      )
        ? existing
        : null;
    }
    const ownerUserId = normalizeOptionalText(this.state.ownerUserId);
    const executionTokenFingerprint = normalizeOptionalText(
      input.executionTokenFingerprint
    );
    if (!(ownerUserId && executionTokenFingerprint)) {
      return null;
    }
    const dispatchFact = await readAcceptedDispatchFinalizationFact({
      attemptId: input.attemptId,
      db: input.db,
      dispatchId: input.dispatchId,
      spaceId: input.spaceId,
    }).catch(() => null);
    if (!dispatchFact) {
      return null;
    }
    const createdAtMs = Date.now();
    const commandCandidate: RuntimeCoordinatorFinalizationCommand = {
      acceptedResult: {
        acceptedAtMs: input.acceptedAtMs,
        attemptId: input.attemptId,
        daemonSessionId: input.daemonSessionId,
        dispatchId: input.dispatchId,
        executionTokenFingerprint,
        executionTokenRunId: input.executionTokenRunId,
        leaseEpoch: input.leaseEpoch,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        submittedConnectionGeneration: input.submittedConnectionGeneration,
        targetProfileId: input.targetProfileId,
        taskId: input.taskId,
        taskResult: input.taskResult,
      },
      createdAtMs,
      dispatchFact: {
        ...dispatchFact,
        dispatchOwner: dispatchFact.dispatchOwner ?? null,
      },
      dispatchId: input.dispatchId,
      executionTokenRunId: input.executionTokenRunId,
      finalizationCommandId: commandId,
      modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
      publicationIdempotencyKey: `publication:${input.runtimeCoordinatorExecutionId}:${input.executionTokenRunId}`,
      resultIdempotencyKey: buildDispatchResultInboxKey(input),
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      spaceId: input.spaceId,
      targetOwnerUserId: ownerUserId,
      targetProfileId: input.targetProfileId,
      targetProfileMentionLabel: null,
      targetProfileName: null,
    };
    const parsed =
      runtimeCoordinatorFinalizationCommandSchema.safeParse(commandCandidate);
    if (!parsed.success) {
      return null;
    }
    if (!input.persistForReplay) {
      return parsed.data;
    }
    await this.persistRuntimeCoordinatorFinalizationCommand({
      command: parsed.data,
      db: input.db,
    });
    return parsed.data;
  }
  private async persistRuntimeCoordinatorFinalizationCommand(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
  }): Promise<void> {
    await this.ctx.storage.transaction(async (storage) => {
      const key = buildRuntimeCoordinatorFinalizationCommandStorageKey(
        input.command.finalizationCommandId
      );
      const existing = await storage.get(key);
      const retained =
        existing === undefined
          ? input.command
          : runtimeCoordinatorFinalizationCommandSchema.parse(existing);
      if (
        JSON.stringify(retained.acceptedResult.taskResult) !==
        JSON.stringify(input.command.acceptedResult.taskResult)
      ) {
        throw new Error("runtime_coordinator.finalization_result_conflict");
      }
      const payload = retained.acceptedResult.taskResult.payload;
      await recordExecutionContextCompletionInTransaction({
        storage,
        headId: projectTargetWakeLifecycleIdentity({
          clientMessageId: retained.dispatchFact.sourceClientMessageId,
          dispatchId: retained.dispatchId,
          sourceSignalId: retained.dispatchFact.sourceEventId,
          spaceId: retained.spaceId,
          targetProfileId: retained.targetProfileId,
        }).targetWakeLifecycleId,
        dispatchId: retained.dispatchId,
        runtimeCoordinatorExecutionId: retained.runtimeCoordinatorExecutionId,
        contextId:
          "executionContextId" in payload
            ? payload.executionContextId
            : undefined,
        completion:
          "executionContextCompletion" in payload
            ? payload.executionContextCompletion
            : undefined,
      });
      if (existing === undefined) {
        await storage.put(key, retained);
      }
    });
    // Seed the finalization retry entry at command-create time so the retry
    // alarm is a guaranteed backstop even when the inline replay never runs
    // (for example the DO is evicted right after the daemon receipt). Replay
    // success removes the entry; without this seed a stored command with no
    // outcome and no retry entry would never be replayed.
    await this.upsertRuntimeCoordinatorFinalizationRetryEntry(
      await this.buildRuntimeCoordinatorFinalizationRetry({
        command: input.command,
        nowMs: input.command.createdAtMs,
        nextReplayAtMs:
          input.command.createdAtMs +
          RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
      })
    );
    this.queueHousekeepingAlarmSync();
    await this.recordRuntimeCoordinatorFinalizationCommandCreated({
      command: input.command,
      db: input.db,
    });
  }
  private async readRuntimeCoordinatorFinalizationCommandForReplay(input: {
    attemptId: string;
    db: PostgresDatabase;
    dispatchId: string;
    executionTokenRunId: string;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
  }): Promise<RuntimeCoordinatorFinalizationCommand | null> {
    const commandId = buildRuntimeCoordinatorFinalizationCommandId({
      executionTokenRunId: input.executionTokenRunId,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    });
    const command =
      await this.readRuntimeCoordinatorFinalizationCommand(commandId);
    if (
      command &&
      this.isRuntimeCoordinatorFinalizationCommandForDispatch(command, input)
    ) {
      return command;
    }
    await this.recordRuntimeCoordinatorFinalizationCommandMissing({
      ...input,
      commandId,
    });
    return null;
  }
  private isRuntimeCoordinatorFinalizationCommandForDispatch(
    command: RuntimeCoordinatorFinalizationCommand,
    input: {
      attemptId: string;
      dispatchId: string;
      executionTokenRunId: string;
      runtimeCoordinatorExecutionId: string;
      spaceId: string;
    }
  ): boolean {
    return (
      command.acceptedResult.attemptId === input.attemptId &&
      command.dispatchId === input.dispatchId &&
      command.executionTokenRunId === input.executionTokenRunId &&
      command.runtimeCoordinatorExecutionId ===
        input.runtimeCoordinatorExecutionId &&
      command.spaceId === input.spaceId
    );
  }
  private async readRuntimeCoordinatorFinalizationCommand(
    commandId: string
  ): Promise<RuntimeCoordinatorFinalizationCommand | null> {
    return await readRuntimeCoordinatorFinalizationCommandFromStorage(
      this.ctx.storage,
      commandId
    );
  }
  private async readRuntimeCoordinatorFinalizationOutcome(
    commandId: string
  ): Promise<RuntimeCoordinatorFinalizationOutcome | null> {
    return await readRuntimeCoordinatorFinalizationOutcomeFromStorage(
      this.ctx.storage,
      commandId
    );
  }
  private async writeRuntimeCoordinatorFinalizationOutcome(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    keepRetryOnSuccess?: boolean;
    outcome: RuntimeCoordinatorFinalizationOutcome;
    taskOutcomeConfirmed?: boolean;
  }): Promise<RuntimeCoordinatorFinalizationOutcomeWriteResult> {
    const storedOutcome = await this.readRuntimeCoordinatorFinalizationOutcome(
      input.command.finalizationCommandId
    );
    const upgradedStoredOutcome =
      storedOutcome?.ok && input.outcome.ok
        ? upgradeLegacyRuntimeCoordinatorFinalizationOutcomeFromVisibleClaim(
            storedOutcome,
            input.outcome
          )
        : null;
    const outcome = storedOutcome?.ok
      ? (upgradedStoredOutcome ?? storedOutcome)
      : input.outcome;
    if (outcome.status === "review_required") {
      throw new Error(
        "runtime_coordinator.review_required_outcome_is_not_terminal"
      );
    }
    await this.ctx.storage.put(
      buildRuntimeCoordinatorFinalizationOutcomeStorageKey(
        input.command.finalizationCommandId
      ),
      outcome
    );
    if (outcome.ok && input.taskOutcomeConfirmed !== true) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_task_outcome_unconfirmed]",
        {
          dispatchId: input.command.dispatchId,
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
          spaceId: input.command.spaceId,
        }
      );
      return { outcome, recoveryPending: true };
    }
    await updateDispatchResultInboxPublishState(input.db, {
      attemptId: input.command.acceptedResult.attemptId,
      dispatchId: input.command.dispatchId,
      publicationErrorCode: outcome.publicationErrorCode,
      publishedSignalId: outcome.publishedSignalId,
      publishState: outcome.publishState,
      updatedAtMs: Date.now(),
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_inbox_projection_failed]",
        {
          dispatchId: input.command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: input.command.finalizationCommandId,
        }
      );
    });
    const projectionSettled =
      await this.writeRuntimeCoordinatorPublicationProjection({
        command: input.command,
        db: input.db,
        outcome,
      });
    if (outcome.ok) {
      const recoveryPending =
        input.keepRetryOnSuccess === true || !projectionSettled;
      if (recoveryPending) {
        return { outcome, recoveryPending };
      }
      await this.removeRuntimeCoordinatorFinalizationRetry(
        input.command.finalizationCommandId
      );
      return { outcome, recoveryPending: false };
    }
    const nowMs = Date.now();
    const retryEntry = await this.buildRuntimeCoordinatorFinalizationRetry({
      command: input.command,
      nowMs,
      nextReplayAtMs: nowMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
    });
    await this.storeRuntimeCoordinatorFinalizationRetryOrPark({
      db: input.db,
      queueAlarm: true,
      retryEntry,
    });
    return { outcome, recoveryPending: false };
  }
  private async writeRuntimeCoordinatorFinalizationFailure(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    reasonCode: string;
  }): Promise<RuntimeCoordinatorFinalizationOutcome> {
    const outcome = this.buildRuntimeCoordinatorFinalizationFailureOutcome({
      command: input.command,
      reasonCode: input.reasonCode,
    });
    const outcomeWrite = await this.writeRuntimeCoordinatorFinalizationOutcome({
      command: input.command,
      db: input.db,
      outcome,
    });
    return outcomeWrite.outcome;
  }
  private buildRuntimeCoordinatorFinalizationFailureOutcome(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    reasonCode: string;
  }): RuntimeCoordinatorFinalizationOutcome {
    return {
      finalizationCommandId: input.command.finalizationCommandId,
      ok: false,
      publicationErrorCode: input.reasonCode,
      publishedSignalId: null,
      publishState: "reply_publication_failed",
      status: "retry_later",
    };
  }
  private async buildRuntimeCoordinatorFinalizationRetry(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    nowMs: number;
    nextReplayAtMs: number;
  }): Promise<RuntimeCoordinatorFinalizationRetryEntry> {
    const existingEntries =
      await this.readRuntimeCoordinatorFinalizationRetries();
    const existing = existingEntries.find(
      (entry) =>
        entry.finalizationCommandId === input.command.finalizationCommandId
    );
    return {
      attemptCount: (existing?.attemptCount ?? 0) + 1,
      attemptId: input.command.acceptedResult.attemptId,
      dispatchId: input.command.dispatchId,
      executionTokenRunId: input.command.executionTokenRunId,
      finalizationCommandId: input.command.finalizationCommandId,
      firstFailureAtMs: existing?.firstFailureAtMs ?? input.nowMs,
      nextReplayAtMs: input.nextReplayAtMs,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      spaceId: input.command.spaceId,
      targetProfileId: input.command.targetProfileId,
      updatedAtMs: input.nowMs,
    };
  }
  private async upsertRuntimeCoordinatorFinalizationRetryEntry(
    entry: RuntimeCoordinatorFinalizationRetryEntry
  ): Promise<void> {
    await upsertRuntimeCoordinatorFinalizationRetryEntryInStorage(
      this.ctx.storage,
      entry
    );
  }
  private async removeRuntimeCoordinatorFinalizationRetry(
    finalizationCommandId: string
  ): Promise<void> {
    await removeRuntimeCoordinatorFinalizationRetryFromStorage(
      this.ctx.storage,
      finalizationCommandId
    );
  }
  private async storeRuntimeCoordinatorFinalizationRetryOrPark(input: {
    db?: PostgresDatabase | null;
    publicationCannotContinue?: boolean;
    queueAlarm?: boolean;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<void> {
    if (
      !(
        input.publicationCannotContinue ||
        isRuntimeCoordinatorPublicationRetryExhausted(input.retryEntry)
      )
    ) {
      await this.upsertRuntimeCoordinatorFinalizationRetryEntry(
        input.retryEntry
      );
      if (input.queueAlarm) {
        this.queueHousekeepingAlarmSync();
      }
      return;
    }
    // Preserve the recovery obligation before crossing into Space. A crash or
    // failed terminal write must not leave only an accepted result behind.
    await this.upsertRuntimeCoordinatorFinalizationRetryEntry(input.retryEntry);
    if (input.queueAlarm) {
      this.queueHousekeepingAlarmSync();
    }
    await this.writeRuntimeCoordinatorPublicationBlocker({
      blockerId: `finalization:${input.retryEntry.finalizationCommandId}`,
      blockerKind: "publication_unavailable",
      db: input.db,
      dispatchId: input.retryEntry.dispatchId,
      nowMs: input.retryEntry.updatedAtMs,
      publicationKind: "success_reply",
      reasonCode: RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
      runtimeCoordinatorExecutionId:
        input.retryEntry.runtimeCoordinatorExecutionId,
      spaceId: input.retryEntry.spaceId,
      targetProfileId: input.retryEntry.targetProfileId,
      targetWakeLifecycleId: null,
    });
    if (
      input.publicationCannotContinue ||
      isRuntimeCoordinatorFinalizationRetryParkLimitReached({
        firstFailureAtMs: input.retryEntry.firstFailureAtMs,
        nowMs: input.retryEntry.updatedAtMs,
      })
    ) {
      const terminalStatus =
        await this.failRuntimeCoordinatorFinalizationRetryParkExhausted({
          coordinationDb: getPostgresDatabase(this.env),
          evidenceDb: input.db,
          retryEntry: input.retryEntry,
        });
      if (
        terminalStatus === "authority_unavailable" ||
        terminalStatus === "authority_write_failed" ||
        terminalStatus === "db_unavailable" ||
        terminalStatus === "projection_conflict" ||
        terminalStatus === "projection_unavailable" ||
        terminalStatus === "space_claim_read_unavailable" ||
        terminalStatus === "space_claim_recovery_pending" ||
        terminalStatus === "task_outcome_conflict" ||
        terminalStatus === "task_outcome_inspection_failed" ||
        terminalStatus === "task_outcome_unavailable" ||
        terminalStatus === "task_outcome_write_failed" ||
        terminalStatus === "terminal_projection_read_failed" ||
        terminalStatus === "terminal_projection_write_failed"
      ) {
        const parkedRetryEntry = parkRuntimeCoordinatorFinalizationRetryEntry({
          nowMs: input.retryEntry.updatedAtMs,
          retryEntry: input.retryEntry,
        });
        await this.upsertRuntimeCoordinatorFinalizationRetryEntry(
          parkedRetryEntry
        );
        if (input.queueAlarm) {
          this.queueHousekeepingAlarmSync();
        }
        console.warn(
          "[core.runtime_transport.runtime_coordinator_finalization_retry_terminal_recovery_pending]",
          {
            dispatchId: input.retryEntry.dispatchId,
            finalizationCommandId: input.retryEntry.finalizationCommandId,
            nextReplayAtMs: parkedRetryEntry.nextReplayAtMs,
            runtimeCoordinatorExecutionId:
              input.retryEntry.runtimeCoordinatorExecutionId,
            terminalStatus,
          }
        );
        return;
      }
      await this.closeLocalAgentStreamAfterFinalizationRetryParkExhausted(
        input.retryEntry
      );
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_park_exhausted]",
        {
          attemptCount: input.retryEntry.attemptCount,
          dispatchId: input.retryEntry.dispatchId,
          finalizationCommandId: input.retryEntry.finalizationCommandId,
          firstFailureAtMs: input.retryEntry.firstFailureAtMs,
          runtimeCoordinatorExecutionId:
            input.retryEntry.runtimeCoordinatorExecutionId,
          targetProfileId: input.retryEntry.targetProfileId,
          terminalStatus,
        }
      );
      await this.removeRuntimeCoordinatorFinalizationRetry(
        input.retryEntry.finalizationCommandId
      );
      return;
    }
    const parkedRetryEntry = parkRuntimeCoordinatorFinalizationRetryEntry({
      nowMs: input.retryEntry.updatedAtMs,
      retryEntry: input.retryEntry,
    });
    console.warn(
      "[core.runtime_transport.runtime_coordinator_finalization_retry_parked]",
      {
        attemptCount: parkedRetryEntry.attemptCount,
        dispatchId: parkedRetryEntry.dispatchId,
        finalizationCommandId: parkedRetryEntry.finalizationCommandId,
        firstFailureAtMs: parkedRetryEntry.firstFailureAtMs,
        nextReplayAtMs: parkedRetryEntry.nextReplayAtMs,
        parkDelayMs: RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
        runtimeCoordinatorExecutionId:
          parkedRetryEntry.runtimeCoordinatorExecutionId,
        targetProfileId: parkedRetryEntry.targetProfileId,
      }
    );
    await this.upsertRuntimeCoordinatorFinalizationRetryEntry(parkedRetryEntry);
    if (input.queueAlarm) {
      this.queueHousekeepingAlarmSync();
    }
  }
  private async closeLocalAgentStreamAfterFinalizationRetryParkExhausted(
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry
  ): Promise<void> {
    const [storedOutcome, authority] = await Promise.all([
      this.readRuntimeCoordinatorFinalizationOutcome(
        retryEntry.finalizationCommandId
      ).catch(() => null),
      this.readRuntimeCoordinatorTokenAuthority(
        retryEntry.runtimeCoordinatorExecutionId
      ).catch(() => null),
    ]);
    let publishedSignalId: string | null = null;
    if (
      storedOutcome?.ok &&
      storedOutcome.publishState === "reply_published" &&
      storedOutcome.publishedSignalId
    ) {
      publishedSignalId = storedOutcome.publishedSignalId;
    } else if (authority?.terminalOutcome?.status === "reply_published") {
      publishedSignalId = authority.terminalOutcome.replySignalId;
    }
    await this.closeLocalAgentStreamOrScheduleRetry({
      attemptId: retryEntry.attemptId,
      dispatchId: retryEntry.dispatchId,
      runtimeCoordinatorExecutionId: retryEntry.runtimeCoordinatorExecutionId,
      spaceId: retryEntry.spaceId,
      terminal: publishedSignalId
        ? { kind: "final_message", publishedSignalId }
        : buildFailedLocalAgentStreamTerminal(
            RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE
          ),
    });
  }
  private warnFinalizationRetryParkFailure(input: {
    error: unknown;
    event: string;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): void {
    console.warn(input.event, {
      dispatchId: input.retryEntry.dispatchId,
      error:
        input.error instanceof Error
          ? input.error.message
          : String(input.error),
      finalizationCommandId: input.retryEntry.finalizationCommandId,
      runtimeCoordinatorExecutionId:
        input.retryEntry.runtimeCoordinatorExecutionId,
    });
  }
  private async readFinalizationRetryParkState(input: {
    db: PostgresDatabase;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<{
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    projection: RuntimeCoordinatorExecutionRecord | null;
    terminalResult:
      | "already_published"
      | "already_terminal"
      | "authority_unavailable"
      | "projection_unavailable"
      | null;
  }> {
    let projection: RuntimeCoordinatorExecutionRecord | null;
    try {
      projection = await readRuntimeCoordinatorExecutionProjectionById({
        db: input.db,
        runtimeCoordinatorExecutionId:
          input.retryEntry.runtimeCoordinatorExecutionId,
      });
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_projection_read_failed]",
        retryEntry: input.retryEntry,
      });
      return {
        authority: null,
        projection: null,
        terminalResult: "projection_unavailable",
      };
    }
    let authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    try {
      authority = await this.readRuntimeCoordinatorTokenAuthority(
        input.retryEntry.runtimeCoordinatorExecutionId
      );
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_authority_read_failed]",
        retryEntry: input.retryEntry,
      });
      return {
        authority: null,
        projection,
        terminalResult: "authority_unavailable",
      };
    }
    if (authority?.terminalOutcome?.status === "reply_published") {
      return { authority, projection, terminalResult: "already_published" };
    }
    const authorityHasDifferentTerminalOutcome =
      authority?.terminalOutcome &&
      (authority.terminalOutcome.status !== "failed_terminal" ||
        authority.terminalOutcome.reasonCode !==
          RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE);
    return {
      authority,
      projection,
      terminalResult: authorityHasDifferentTerminalOutcome
        ? "already_terminal"
        : null,
    };
  }
  private async readValidatedFinalizationRetryParkCommand(
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry
  ): Promise<RuntimeCoordinatorFinalizationCommand | null> {
    let command: RuntimeCoordinatorFinalizationCommand | null;
    try {
      command = await this.readRuntimeCoordinatorFinalizationCommand(
        retryEntry.finalizationCommandId
      );
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_command_read_failed]",
        retryEntry,
      });
      return null;
    }
    const matchesRetry =
      command &&
      this.isRuntimeCoordinatorFinalizationCommandForDispatch(command, {
        attemptId: retryEntry.attemptId,
        dispatchId: retryEntry.dispatchId,
        executionTokenRunId: retryEntry.executionTokenRunId,
        runtimeCoordinatorExecutionId: retryEntry.runtimeCoordinatorExecutionId,
        spaceId: retryEntry.spaceId,
      });
    return matchesRetry ? command : null;
  }
  private hasFinalizationRetryParkTerminalDecision(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
  }): boolean {
    return (
      input.authority?.terminalOutcome?.status === "failed_terminal" &&
      input.authority.terminalOutcome.reasonCode ===
        RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE
    );
  }
  private hasFinalizationRetryParkProjectionConflict(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    projection: RuntimeCoordinatorExecutionRecord | null;
  }): boolean {
    const projection = input.projection;
    if (
      projection?.status !== "cancelled" &&
      projection?.status !== "failed_terminal" &&
      projection?.status !== "reply_published"
    ) {
      return false;
    }
    return !(
      projection.status === "failed_terminal" &&
      projection.terminalOutcome?.reasonCode ===
        RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE &&
      this.hasFinalizationRetryParkTerminalDecision(input)
    );
  }
  private async ensureFinalizationRetryParkTerminalAuthority(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    nowMs: number;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<
    | {
        authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
        result: "ready";
      }
    | {
        result: "authority_unavailable" | "authority_write_failed";
      }
  > {
    if (!input.authority) {
      return { result: "authority_unavailable" };
    }
    if (input.authority.terminalOutcome) {
      return { authority: input.authority, result: "ready" };
    }
    try {
      const authority = settleRuntimeCoordinatorAuthorityForTerminalDecision({
        authority: input.authority,
        nowMs: input.nowMs,
        plan: {
          action: "terminal_failed",
          eventType: "runtime_coordinator_decision_recorded",
          reasonCode:
            RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
          retiredReasonCode: "execution_token_revoked",
          terminalOutcomeKind: "failed_terminal",
          tokenStatus: "revoked",
        },
      });
      await this.writeRuntimeCoordinatorTokenAuthority(authority);
      return { authority, result: "ready" };
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_terminal_authority_failed]",
        retryEntry: input.retryEntry,
      });
      return { result: "authority_write_failed" };
    }
  }
  private async writeFinalizationRetryParkTerminalProjection(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    nowMs: number;
    projection: RuntimeCoordinatorExecutionRecord | null;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<
    | "projection_conflict"
    | "projection_unavailable"
    | "terminal_projection_read_failed"
    | "terminal_projection_write_failed"
    | "terminal_projection_written"
  > {
    const record =
      input.projection ??
      buildRuntimeCoordinatorExecutionRecordFromFinalizationCommand({
        authority: input.authority,
        command: input.command,
        nowMs: input.nowMs,
      });
    if (!record) {
      return "projection_unavailable";
    }
    const terminalRecord: RuntimeCoordinatorExecutionRecord = {
      ...record,
      status: "failed_terminal",
      terminalOutcome: {
        kind: "failed_terminal",
        observedAtMs: input.nowMs,
        reasonCode: RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
      },
      updatedAtMs: input.nowMs,
    };
    let projectionWrite: "skipped_stale" | "written";
    try {
      projectionWrite = await writeRuntimeCoordinatorExecutionProjection({
        db: input.db,
        record: terminalRecord,
      });
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_terminal_projection_failed]",
        retryEntry: input.retryEntry,
      });
      return "terminal_projection_write_failed";
    }
    if (projectionWrite !== "skipped_stale") {
      return "terminal_projection_written";
    }
    let latestProjection: RuntimeCoordinatorExecutionRecord | null;
    try {
      latestProjection = await readRuntimeCoordinatorExecutionProjectionById({
        db: input.db,
        runtimeCoordinatorExecutionId:
          input.retryEntry.runtimeCoordinatorExecutionId,
      });
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_terminal_projection_reread_failed]",
        retryEntry: input.retryEntry,
      });
      return "terminal_projection_read_failed";
    }
    if (
      latestProjection?.status === "failed_terminal" &&
      latestProjection.terminalOutcome?.reasonCode ===
        RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE
    ) {
      return "terminal_projection_written";
    }
    return latestProjection?.status === "cancelled" ||
      latestProjection?.status === "failed_terminal" ||
      latestProjection?.status === "reply_published"
      ? "projection_conflict"
      : "terminal_projection_write_failed";
  }
  private async recordFinalizationRetryParkTerminalEvent(input: {
    db: PostgresDatabase;
    nowMs: number;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<void> {
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType: "runtime_coordinator_decision_recorded",
      idempotencyKey: `finalization-command:${input.retryEntry.finalizationCommandId}:park-exhausted-terminal`,
      observedAtMs: input.nowMs,
      payload: {
        attemptCount: input.retryEntry.attemptCount,
        attemptId: input.retryEntry.attemptId,
        dispatchId: input.retryEntry.dispatchId,
        executionTokenRunId: input.retryEntry.executionTokenRunId,
        finalizationCommandId: input.retryEntry.finalizationCommandId,
        firstFailureAtMs: input.retryEntry.firstFailureAtMs,
        spaceId: input.retryEntry.spaceId,
        targetProfileId: input.retryEntry.targetProfileId,
      },
      reasonCode: RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
      runtimeCoordinatorExecutionId:
        input.retryEntry.runtimeCoordinatorExecutionId,
      statusAfter: "failed_terminal",
    }).catch((error) => {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_terminal_event_failed]",
        retryEntry: input.retryEntry,
      });
    });
  }
  private async recordFinalizationRetryParkTaskOutcome(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    coordinationDb: PostgresDatabase | undefined;
    publishedSignalId: string;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<
    | "task_outcome_conflict"
    | "task_outcome_write_failed"
    | "task_outcome_written"
  > {
    if (!input.coordinationDb) {
      return "task_outcome_write_failed";
    }
    try {
      const taskOutcomeWrite =
        await recordRuntimeCoordinatorPublicationFailedTaskOutcome({
          command: input.command,
          db: input.coordinationDb,
          env: this.env,
          occurredAtMs: input.retryEntry.firstFailureAtMs,
          publishedSignalId: input.publishedSignalId,
          reasonCode:
            RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
        });
      if (taskOutcomeWrite && !taskOutcomeWrite.matches) {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_publication_exhaustion_task_outcome_conflict]",
          {
            actualEventId: taskOutcomeWrite.storedOutcome.eventId,
            actualStatus: taskOutcomeWrite.storedOutcome.status,
            dispatchId: input.command.dispatchId,
            expectedEventId: taskOutcomeWrite.expectedOutcome.eventId,
            expectedStatus: taskOutcomeWrite.expectedOutcome.status,
            finalizationCommandId: input.command.finalizationCommandId,
            runtimeCoordinatorExecutionId:
              input.command.runtimeCoordinatorExecutionId,
            spaceId: input.command.spaceId,
          }
        );
        return "task_outcome_conflict";
      }
      return "task_outcome_written";
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_task_outcome_failed]",
        retryEntry: input.retryEntry,
      });
      return "task_outcome_write_failed";
    }
  }
  private async inspectFinalizationRetryParkTaskOutcome(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    coordinationDb: PostgresDatabase | undefined;
    publishedSignalId: string;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<
    | "task_outcome_compatible"
    | "task_outcome_conflict"
    | "task_outcome_inspection_failed"
    | "task_outcome_unavailable"
  > {
    if (!input.coordinationDb) {
      return "task_outcome_unavailable";
    }
    try {
      const inspection =
        await inspectRuntimeCoordinatorPublicationFailedTaskOutcome({
          command: input.command,
          db: input.coordinationDb,
          occurredAtMs: input.retryEntry.firstFailureAtMs,
          publishedSignalId: input.publishedSignalId,
          reasonCode:
            RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
        });
      if (inspection && !inspection.matches && inspection.storedOutcome) {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_publication_exhaustion_task_outcome_conflict]",
          {
            actualEventId: inspection.storedOutcome.eventId,
            actualStatus: inspection.storedOutcome.status,
            dispatchId: input.command.dispatchId,
            expectedEventId: inspection.expectedOutcome.eventId,
            expectedStatus: inspection.expectedOutcome.status,
            finalizationCommandId: input.command.finalizationCommandId,
            runtimeCoordinatorExecutionId:
              input.command.runtimeCoordinatorExecutionId,
            spaceId: input.command.spaceId,
          }
        );
        return "task_outcome_conflict";
      }
      return "task_outcome_compatible";
    } catch (error) {
      this.warnFinalizationRetryParkFailure({
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_finalization_retry_park_task_outcome_inspection_failed]",
        retryEntry: input.retryEntry,
      });
      return "task_outcome_inspection_failed";
    }
  }
  private async reconcileFinalizationRetryParkSpaceClaim(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<
    | FinalizationRetryParkExhaustedResult
    | {
        publishedSignalId: string;
        status: "publication_failed_visible";
      }
  > {
    const claimRead = await this.applyRuntimeCoordinatorPublicationExhaustion(
      input.command
    );
    if (!claimRead) {
      return "space_claim_read_unavailable";
    }
    if (claimRead.status === "unresolved") {
      return "space_claim_read_unavailable";
    }
    if (claimRead.status === "publication_failed_visible") {
      return claimRead;
    }
    const recovered =
      await this.recoverRuntimeCoordinatorFinalizationFromSpaceClaim({
        attemptId: input.retryEntry.attemptId,
        dispatchId: input.retryEntry.dispatchId,
        executionTokenRunId: input.retryEntry.executionTokenRunId,
        preloadedClaimRead: claimRead,
        preloadedCommand: input.command,
        runtimeCoordinatorExecutionId:
          input.retryEntry.runtimeCoordinatorExecutionId,
        spaceId: input.retryEntry.spaceId,
      });
    if (!recovered) {
      return "space_claim_recovery_pending";
    }
    return "status" in recovered && recovered.status === "suppressed"
      ? "already_terminal"
      : "already_published";
  }
  private async failRuntimeCoordinatorFinalizationRetryParkExhausted(input: {
    coordinationDb: PostgresDatabase | undefined;
    evidenceDb?: PostgresDatabase | null;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<FinalizationRetryParkExhaustedResult> {
    if (!input.evidenceDb) {
      return "db_unavailable";
    }
    const storedOutcome = await this.readRuntimeCoordinatorFinalizationOutcome(
      input.retryEntry.finalizationCommandId
    );
    const state = await this.readFinalizationRetryParkState({
      db: input.evidenceDb,
      retryEntry: input.retryEntry,
    });
    if (state.terminalResult && state.terminalResult !== "already_published") {
      return state.terminalResult;
    }
    const command = await this.readValidatedFinalizationRetryParkCommand(
      input.retryEntry
    );
    if (!command) {
      return "projection_unavailable";
    }
    if (storedOutcome?.ok) {
      const repaired =
        await this.repairStoredRuntimeCoordinatorFinalizationSuccess({
          command,
          db: input.evidenceDb,
          outcome: storedOutcome,
        });
      return repaired.ok ? "already_published" : "space_claim_recovery_pending";
    }
    if (state.terminalResult === "already_published") {
      return "projection_unavailable";
    }
    const claimReconciliation =
      await this.reconcileFinalizationRetryParkSpaceClaim({
        command,
        retryEntry: input.retryEntry,
      });
    if (typeof claimReconciliation === "string") {
      return claimReconciliation;
    }
    if (this.hasFinalizationRetryParkProjectionConflict(state)) {
      return "projection_conflict";
    }
    const taskOutcomeInspection =
      await this.inspectFinalizationRetryParkTaskOutcome({
        command,
        coordinationDb: input.coordinationDb,
        publishedSignalId: claimReconciliation.publishedSignalId,
        retryEntry: input.retryEntry,
      });
    if (taskOutcomeInspection !== "task_outcome_compatible") {
      return taskOutcomeInspection;
    }
    const nowMs = input.retryEntry.updatedAtMs;
    const terminalAuthority =
      await this.ensureFinalizationRetryParkTerminalAuthority({
        authority: state.authority,
        nowMs,
        retryEntry: input.retryEntry,
      });
    if (terminalAuthority.result !== "ready") {
      return terminalAuthority.result;
    }
    const projectionResult =
      await this.writeFinalizationRetryParkTerminalProjection({
        authority: terminalAuthority.authority,
        command,
        db: input.evidenceDb,
        nowMs,
        projection: state.projection,
        retryEntry: input.retryEntry,
      });
    if (projectionResult !== "terminal_projection_written") {
      return projectionResult;
    }
    await this.recordFinalizationRetryParkTerminalEvent({
      db: input.evidenceDb,
      nowMs,
      retryEntry: input.retryEntry,
    });
    const taskOutcomeResult = await this.recordFinalizationRetryParkTaskOutcome(
      {
        command,
        coordinationDb: input.coordinationDb,
        publishedSignalId: claimReconciliation.publishedSignalId,
        retryEntry: input.retryEntry,
      }
    );
    if (taskOutcomeResult !== "task_outcome_written") {
      return taskOutcomeResult;
    }
    return "terminal_projection_written";
  }
  private async readRuntimeCoordinatorFinalizationRetries(): Promise<
    RuntimeCoordinatorFinalizationRetryEntry[]
  > {
    return await readRuntimeCoordinatorFinalizationRetriesFromStorage(
      this.ctx.storage
    );
  }
  private async recordRuntimeCoordinatorFinalizationCommandMissing(input: {
    attemptId: string;
    commandId: string;
    db: PostgresDatabase;
    dispatchId: string;
    executionTokenRunId: string;
    runtimeCoordinatorExecutionId: string;
    spaceId: string;
  }): Promise<void> {
    console.warn(
      "[core.runtime_transport.runtime_coordinator_finalization_command_missing]",
      {
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        executionTokenRunId: input.executionTokenRunId,
        finalizationCommandId: input.commandId,
        reasonCode: "runtime_coordinator.finalization_command_missing",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        spaceId: input.spaceId,
      }
    );
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType: "runtime_coordinator_decision_recorded",
      idempotencyKey: `finalization-command:${input.commandId}:missing`,
      observedAtMs: Date.now(),
      payload: {
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        executionTokenRunId: input.executionTokenRunId,
        finalizationCommandId: input.commandId,
        spaceId: input.spaceId,
      },
      reasonCode: "runtime_coordinator.finalization_command_missing",
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      statusAfter: "result_accepted",
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_command_missing_event_failed]",
        {
          dispatchId: input.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: input.commandId,
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private async recordRuntimeCoordinatorFinalizationCommandCreated(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
  }): Promise<void> {
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType: "runtime_coordinator_decision_recorded",
      idempotencyKey: `finalization-command:${input.command.finalizationCommandId}:created`,
      observedAtMs: input.command.createdAtMs,
      payload: {
        finalizationCommandId: input.command.finalizationCommandId,
        publicationIdempotencyKey: input.command.publicationIdempotencyKey,
        resultIdempotencyKey: input.command.resultIdempotencyKey,
      },
      reasonCode: "runtime_coordinator.finalization_command_created",
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      statusAfter: "result_accepted",
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_command_event_failed]",
        {
          dispatchId: input.command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private async writeRuntimeCoordinatorPublicationBlocker(input: {
    blockerId: string;
    blockerKind: RuntimeCoordinatorPublicationBlockerRecord["blockerKind"];
    db?: PostgresDatabase | null;
    dispatchId: string;
    nowMs: number;
    publicationKind: RuntimeCoordinatorPublicationBlockerRecord["publicationKind"];
    reasonCode: string;
    runtimeCoordinatorExecutionId: string | null;
    spaceId: string;
    targetProfileId: string | null;
    targetWakeLifecycleId: string | null;
  }): Promise<void> {
    const record: RuntimeCoordinatorPublicationBlockerRecord = {
      blockerId: input.blockerId,
      blockerKind: input.blockerKind,
      createdAtMs: input.nowMs,
      dispatchId: input.dispatchId,
      modelVersion: RUNTIME_COORDINATOR_PUBLICATION_BLOCKER_MODEL_VERSION,
      publicationKind: input.publicationKind,
      reasonCode: input.reasonCode,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      spaceId: input.spaceId,
      status: "unresolved_publication_failure",
      targetProfileId: input.targetProfileId,
      targetWakeLifecycleId: input.targetWakeLifecycleId,
      updatedAtMs: input.nowMs,
    };
    await this.ctx.storage.put(
      buildRuntimeCoordinatorPublicationBlockerStorageKey(input.blockerId),
      record
    );
    if (!(input.db && input.runtimeCoordinatorExecutionId)) {
      return;
    }
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType: "runtime_coordinator_decision_recorded",
      idempotencyKey: `publication-blocker:${input.blockerId}`,
      observedAtMs: input.nowMs,
      payload: {
        blockerId: input.blockerId,
        blockerKind: input.blockerKind,
        dispatchId: input.dispatchId,
        publicationKind: input.publicationKind,
        reasonCode: input.reasonCode,
        spaceId: input.spaceId,
        status: "unresolved_publication_failure",
        targetProfileId: input.targetProfileId,
        targetWakeLifecycleId: input.targetWakeLifecycleId,
      },
      reasonCode: "runtime_coordinator.publication_unresolved",
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      statusAfter: null,
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_publication_blocker_event_failed]",
        {
          blockerId: input.blockerId,
          dispatchId: input.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private async readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
    publicationId: string
  ): Promise<RuntimeCoordinatorWakeStoppedNoticePublicationRecord | null> {
    const record =
      await this.ctx.storage.get<RuntimeCoordinatorWakeStoppedNoticePublicationRecord>(
        buildRuntimeCoordinatorWakeStoppedNoticePublicationStorageKey(
          publicationId
        )
      );
    return record ?? null;
  }
  private async writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
    record: RuntimeCoordinatorWakeStoppedNoticePublicationRecord
  ): Promise<void> {
    const publicationStorageKey =
      buildRuntimeCoordinatorWakeStoppedNoticePublicationStorageKey(
        record.publicationId
      );
    const pending =
      record.status === "published" &&
      Boolean(record.taskOutcomeSourceClientMessageId) &&
      record.taskOutcomeProjectedAtMs === null;
    const nowMs = Date.now();
    await this.ctx.storage.transaction(async (transaction) => {
      const storedIndex = await transaction.get<unknown>(
        RUNTIME_COORDINATOR_STOPPED_TASK_PROJECTION_INDEX_STORAGE_KEY
      );
      const publicationIds = new Set(
        parseRuntimeCoordinatorStoppedTaskProjectionIndex(storedIndex)
      );
      if (pending) {
        publicationIds.add(record.publicationId);
      } else {
        publicationIds.delete(record.publicationId);
      }
      await transaction.put({
        [publicationStorageKey]: record,
        [RUNTIME_COORDINATOR_STOPPED_TASK_PROJECTION_INDEX_STORAGE_KEY]: {
          publicationIds: [...publicationIds].sort(),
        } satisfies RuntimeCoordinatorStoppedTaskProjectionIndex,
      });
      if (pending) {
        await transaction.setAlarm(nowMs);
      }
    });
    if (pending) {
      this.scheduledHousekeepingAlarmAtMs = nowMs;
    }
  }
  private async readRuntimeCoordinatorStoppedTaskProjectionPublicationIds(): Promise<
    string[]
  > {
    return parseRuntimeCoordinatorStoppedTaskProjectionIndex(
      await this.ctx.storage.get<unknown>(
        RUNTIME_COORDINATOR_STOPPED_TASK_PROJECTION_INDEX_STORAGE_KEY
      )
    );
  }
  private async removeRuntimeCoordinatorStoppedTaskProjectionPublicationId(
    publicationId: string
  ): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      const publicationIds = new Set(
        parseRuntimeCoordinatorStoppedTaskProjectionIndex(
          await transaction.get<unknown>(
            RUNTIME_COORDINATOR_STOPPED_TASK_PROJECTION_INDEX_STORAGE_KEY
          )
        )
      );
      publicationIds.delete(publicationId);
      await transaction.put(
        RUNTIME_COORDINATOR_STOPPED_TASK_PROJECTION_INDEX_STORAGE_KEY,
        {
          publicationIds: [...publicationIds].sort(),
        } satisfies RuntimeCoordinatorStoppedTaskProjectionIndex
      );
    });
  }
  private async writeRuntimeCoordinatorPublicationProjection(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    outcome: RuntimeCoordinatorFinalizationOutcome;
  }): Promise<boolean> {
    const nowMs = Date.now();
    const executionSemantic = input.outcome.ok
      ? resolveRuntimeCoordinatorFinalizationSemantic({
          finalMessageKind: input.outcome.finalMessageKind,
          publishState: input.outcome.publishState,
          taskResult: input.command.acceptedResult.taskResult,
        })
      : null;
    const status =
      executionSemantic?.status === "failed"
        ? "failed_terminal"
        : resolveRuntimeCoordinatorPublicationStatus(
            input.outcome.publishState
          );
    const terminalOutcomeKind =
      resolveRuntimeCoordinatorPublicationTerminalOutcomeKind(status);
    const reasonCode =
      executionSemantic?.reasonCode ??
      input.outcome.publicationErrorCode ??
      (input.outcome.publishState === "invalid_space_action"
        ? "invalid_space_action"
        : null);
    const executionProjectionSettled =
      await this.writeRuntimeCoordinatorExecutionPublicationProjection({
        command: input.command,
        db: input.db,
        nowMs,
        reasonCode,
        status,
        terminalOutcomeKind,
      });
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType:
        input.outcome.publishState === "reply_published"
          ? "reply_published"
          : "reply_publication_failed",
      idempotencyKey: `finalization-command:${input.command.finalizationCommandId}:${input.outcome.publishState}`,
      observedAtMs: nowMs,
      payload: {
        finalMessageKind: input.outcome.ok
          ? (input.outcome.finalMessageKind ?? null)
          : null,
        finalizationCommandId: input.command.finalizationCommandId,
        publishedSignalId: input.outcome.publishedSignalId,
        publishState: input.outcome.publishState,
      },
      reasonCode,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      statusAfter: status,
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_publication_event_failed]",
        {
          dispatchId: input.command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: input.command.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            input.command.runtimeCoordinatorExecutionId,
        }
      );
    });
    emitCoreFinalVisibleOutcomeRuntimeEvidence(this.env, {
      clientMessageId: input.command.dispatchFact.sourceClientMessageId,
      dispatchId: input.command.dispatchId,
      latestAttemptId: input.command.dispatchFact.attemptId,
      publishedSignalId: input.outcome.publishedSignalId,
      reasonCode: resolveRuntimeCoordinatorFinalVisibleReasonCode({
        executionSemantic,
        outcome: input.outcome,
        reasonCode,
      }),
      replySignalId: input.outcome.ok ? input.outcome.publishedSignalId : null,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
      runtimeKind: "durable_object",
      sourceSignalId: input.command.dispatchFact.sourceEventId,
      spaceId: input.command.spaceId,
      status:
        input.outcome.ok && executionSemantic?.status !== "failed"
          ? "succeeded"
          : "failed",
      targetProfileId: input.command.targetProfileId,
    });
    if (!(input.outcome.ok && executionSemantic)) {
      return true;
    }
    const authoritySettled =
      await this.setRuntimeCoordinatorFinalizationTerminalOutcome({
        command: input.command,
        executionSemantic,
        nowMs,
        publishedSignalId: input.outcome.publishedSignalId,
      });
    return executionProjectionSettled && authoritySettled;
  }
  private async writeRuntimeCoordinatorExecutionPublicationProjection(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    db: PostgresDatabase;
    nowMs: number;
    reasonCode: string | null;
    status: RuntimeCoordinatorExecutionStatus;
    terminalOutcomeKind: RuntimeCoordinatorTerminalOutcome["kind"];
  }): Promise<boolean> {
    let existing: RuntimeCoordinatorExecutionRecord | null;
    try {
      existing = await readRuntimeCoordinatorExecutionProjectionByDispatch({
        db: input.db,
        dispatchId: input.command.dispatchId,
        spaceId: input.command.spaceId,
        targetProfileId: input.command.targetProfileId,
      });
    } catch (error) {
      this.warnRuntimeCoordinatorPublicationRepairFailure({
        command: input.command,
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_publication_projection_read_failed]",
      });
      return false;
    }
    let authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null =
      null;
    if (!existing) {
      try {
        authority = await this.readRuntimeCoordinatorTokenAuthority(
          input.command.runtimeCoordinatorExecutionId
        );
      } catch (error) {
        this.warnRuntimeCoordinatorPublicationRepairFailure({
          command: input.command,
          error,
          event:
            "[core.runtime_transport.runtime_coordinator_publication_authority_read_failed]",
        });
        return false;
      }
    }
    const record =
      existing ??
      buildRuntimeCoordinatorExecutionRecordFromFinalizationCommand({
        authority,
        command: input.command,
        nowMs: input.nowMs,
      });
    if (!record) {
      return false;
    }
    try {
      const writeResult = await writeRuntimeCoordinatorExecutionProjection({
        db: input.db,
        record: {
          ...record,
          status: input.status,
          terminalOutcome: {
            kind: input.terminalOutcomeKind,
            observedAtMs: input.nowMs,
            reasonCode: input.reasonCode,
          },
          updatedAtMs: input.nowMs,
        },
      });
      return (
        writeResult !== "skipped_stale" || existing?.status === input.status
      );
    } catch (error) {
      this.warnRuntimeCoordinatorPublicationRepairFailure({
        command: input.command,
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_publication_projection_failed]",
      });
      return false;
    }
  }
  private warnRuntimeCoordinatorPublicationRepairFailure(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    error: unknown;
    event: string;
  }): void {
    console.warn(input.event, {
      dispatchId: input.command.dispatchId,
      error:
        input.error instanceof Error
          ? input.error.message
          : String(input.error),
      finalizationCommandId: input.command.finalizationCommandId,
      runtimeCoordinatorExecutionId:
        input.command.runtimeCoordinatorExecutionId,
    });
  }
  private async setRuntimeCoordinatorFinalizationTerminalOutcome(input: {
    command: RuntimeCoordinatorFinalizationCommand;
    executionSemantic: RuntimeCoordinatorFinalizationSemantic;
    nowMs: number;
    publishedSignalId: string | null;
  }): Promise<boolean> {
    let authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    try {
      authority = await this.readRuntimeCoordinatorTokenAuthority(
        input.command.runtimeCoordinatorExecutionId
      );
    } catch (error) {
      this.warnRuntimeCoordinatorPublicationRepairFailure({
        command: input.command,
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_publication_authority_read_failed]",
      });
      return false;
    }
    if (!authority) {
      this.warnRuntimeCoordinatorPublicationRepairFailure({
        command: input.command,
        error: new Error("RuntimeCoordinator authority is unavailable."),
        event:
          "[core.runtime_transport.runtime_coordinator_publication_authority_missing]",
      });
      return false;
    }
    const terminalOutcome = authority.terminalOutcome;
    const expectedStatus =
      input.executionSemantic.status === "failed"
        ? "failed_terminal"
        : "reply_published";
    const repairsLegacyPublicationExhaustion =
      terminalOutcome?.status === "failed_terminal" &&
      terminalOutcome.reasonCode ===
        RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE;
    const repairsMissingVisibleSignal =
      terminalOutcome?.status === expectedStatus &&
      terminalOutcome.replySignalId === null &&
      input.publishedSignalId !== null;
    if (
      terminalOutcome?.status === expectedStatus &&
      !repairsLegacyPublicationExhaustion &&
      !repairsMissingVisibleSignal
    ) {
      return terminalOutcome.replySignalId === input.publishedSignalId;
    }
    if (
      terminalOutcome &&
      !repairsLegacyPublicationExhaustion &&
      !repairsMissingVisibleSignal
    ) {
      return false;
    }
    try {
      await this.writeRuntimeCoordinatorTokenAuthority({
        ...authority,
        terminalOutcome: {
          finalizedAtMs: input.nowMs,
          reasonCode:
            input.executionSemantic.reasonCode ??
            (input.executionSemantic.status === "stayed_silent"
              ? "space.stayed_silent"
              : "space.reply_published"),
          replySignalId: input.publishedSignalId,
          status: expectedStatus,
        },
      });
      if (repairsLegacyPublicationExhaustion) {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_legacy_publication_exhaustion_repaired]",
          {
            dispatchId: input.command.dispatchId,
            finalizationCommandId: input.command.finalizationCommandId,
            publishedSignalId: input.publishedSignalId,
            runtimeCoordinatorExecutionId:
              input.command.runtimeCoordinatorExecutionId,
            spaceId: input.command.spaceId,
          }
        );
      }
      return true;
    } catch (error) {
      this.warnRuntimeCoordinatorPublicationRepairFailure({
        command: input.command,
        error,
        event:
          "[core.runtime_transport.runtime_coordinator_publication_authority_write_failed]",
      });
      return false;
    }
  }
  private readKnownRuntimeCoordinatorResultState(input: {
    attemptId: string;
    dispatchId: string;
  }): CompletedDispatchResultState | PendingDispatchState | null {
    const dispatchAttemptKey = buildDispatchAttemptKey(
      input.dispatchId,
      input.attemptId
    );
    return (
      this.state.pendingDispatches.get(dispatchAttemptKey) ??
      this.state.completedDispatchResults.get(dispatchAttemptKey) ??
      null
    );
  }
  private async resolveRuntimeCoordinatorResultContract(
    request: RuntimeTransportSubmitTaskResultRequest
  ): Promise<
    | {
        ok: true;
        diagnosticRuntimeCoordinatorExecutionId: string | null;
        verifiedRuntimeCoordinatorExecution: RuntimeCoordinatorExecutionRecord | null;
      }
    | {
        ok: false;
        reasonCode:
          | "runtime_coordinator.execution_id_missing"
          | "runtime_coordinator.execution_id_mismatch";
      }
  > {
    const resultAttemptId = resolveSubmitResultAttemptId(request);
    const knownState = resultAttemptId
      ? this.readKnownRuntimeCoordinatorResultState({
          attemptId: resultAttemptId,
          dispatchId: request.dispatchId,
        })
      : null;
    const knownContract = this.validateRuntimeCoordinatorExecutionIdEcho({
      attemptId: resultAttemptId ?? request.attemptId ?? "unknown",
      authoritativeRuntimeCoordinatorExecutionId:
        knownState?.runtimeCoordinatorExecutionId ?? null,
      dispatchId: request.dispatchId,
      frameKind: "result",
      requestRuntimeCoordinatorExecutionId:
        request.runtimeCoordinatorExecutionId ?? null,
    });
    if (!knownContract.ok) {
      return knownContract;
    }
    if (knownState) {
      return {
        ok: true,
        diagnosticRuntimeCoordinatorExecutionId:
          knownState.runtimeCoordinatorExecutionId,
        verifiedRuntimeCoordinatorExecution: null,
      };
    }
    const requestRuntimeCoordinatorExecutionId = normalizeOptionalText(
      request.runtimeCoordinatorExecutionId
    );
    if (!requestRuntimeCoordinatorExecutionId) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.execution_id_missing",
      };
    }
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return {
        ok: true,
        diagnosticRuntimeCoordinatorExecutionId: null,
        verifiedRuntimeCoordinatorExecution: null,
      };
    }
    const projection = await readRuntimeCoordinatorExecutionProjectionById({
      db,
      runtimeCoordinatorExecutionId: requestRuntimeCoordinatorExecutionId,
    }).catch(() => null);
    const requestedTargetProfileId = normalizeOptionalText(
      request.taskResult.payload.agentId
    );
    if (!projection) {
      if (!request.executionTokenEcho) {
        return {
          ok: false,
          reasonCode: "runtime_coordinator.execution_id_mismatch",
        };
      }
      return {
        ok: true,
        diagnosticRuntimeCoordinatorExecutionId:
          requestRuntimeCoordinatorExecutionId,
        verifiedRuntimeCoordinatorExecution: null,
      };
    }
    if (
      projection.dispatchId !== request.dispatchId ||
      projection.targetProfileId !== requestedTargetProfileId
    ) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.execution_id_mismatch",
      };
    }
    return {
      ok: true,
      diagnosticRuntimeCoordinatorExecutionId:
        projection.runtimeCoordinatorExecutionId,
      verifiedRuntimeCoordinatorExecution: projection,
    };
  }
  private resolveRuntimeCoordinatorResultTokenValidationContext(input: {
    request: RuntimeTransportSubmitTaskResultRequest;
    verifiedRuntimeCoordinatorExecution: RuntimeCoordinatorExecutionRecord | null;
  }): RuntimeCoordinatorTokenValidationContext | null {
    const resultAttemptId = resolveSubmitResultAttemptId(input.request);
    const knownState = resultAttemptId
      ? this.readKnownRuntimeCoordinatorResultState({
          attemptId: resultAttemptId,
          dispatchId: input.request.dispatchId,
        })
      : null;
    if (knownState && "profileId" in knownState) {
      return buildRuntimeCoordinatorTokenValidationContextFromPending(
        knownState
      );
    }
    if (knownState && "targetProfileId" in knownState) {
      return buildRuntimeCoordinatorTokenValidationContextFromCompleted(
        knownState
      );
    }
    if (input.verifiedRuntimeCoordinatorExecution) {
      return buildRuntimeCoordinatorTokenValidationContextFromProjection(
        input.verifiedRuntimeCoordinatorExecution
      );
    }
    return null;
  }
  private async resolveRuntimeCoordinatorResultTokenValidationContextForRequest(input: {
    request: RuntimeTransportSubmitTaskResultRequest;
    verifiedRuntimeCoordinatorExecution: RuntimeCoordinatorExecutionRecord | null;
  }): Promise<
    | {
        ok: true;
        context: RuntimeCoordinatorTokenValidationContext | null;
      }
    | {
        ok: false;
        response: RuntimeTransportSubmitTaskResultResponse;
      }
  > {
    const context =
      this.resolveRuntimeCoordinatorResultTokenValidationContext(input);
    if (context) {
      return { context, ok: true };
    }
    let authorityContext:
      | {
          ok: true;
          context: RuntimeCoordinatorTokenValidationContext | null;
        }
      | {
          ok: false;
          reasonCode:
            | "daemon.result.identity_mismatch"
            | "runtime_coordinator.execution_id_mismatch";
        };
    try {
      authorityContext =
        await this.resolveRuntimeCoordinatorResultTokenValidationContextFromAuthority(
          input.request
        );
    } catch (error) {
      const runtimeCoordinatorExecutionId = normalizeOptionalText(
        input.request.runtimeCoordinatorExecutionId
      );
      if (runtimeCoordinatorExecutionId) {
        this.recordRuntimeCoordinatorTokenAuthorityUnavailableEvent({
          error,
          frameKind: "result",
          ignoredEventSummary: `result:${input.request.dispatchId}:${input.request.attemptId ?? "unknown"}`,
          runtimeCoordinatorExecutionId,
        });
      }
      return {
        ok: false,
        response: {
          ok: false,
          reasonCode:
            "runtime_coordinator.execution_token_authority_unavailable",
          status: "retry_later",
        },
      };
    }
    if (!authorityContext.ok) {
      this.recordRuntimeCoordinatorDiagnosticEvent({
        attemptId: input.request.attemptId ?? "unknown",
        eventType: "runtime_coordinator_execution_id_mismatch",
        payload: {
          frameKind: "result",
          requestRuntimeCoordinatorExecutionId:
            input.request.runtimeCoordinatorExecutionId ?? null,
        },
        reasonCode: authorityContext.reasonCode,
        runtimeCoordinatorExecutionId:
          input.request.runtimeCoordinatorExecutionId ?? null,
      });
      return {
        ok: false,
        response: {
          ok: false,
          reasonCode: authorityContext.reasonCode,
          status: "rejected_terminal",
        },
      };
    }
    return {
      context: authorityContext.context,
      ok: true,
    };
  }
  private async resolveRuntimeCoordinatorResultTokenValidationContextFromAuthority(
    request: RuntimeTransportSubmitTaskResultRequest
  ): Promise<
    | {
        ok: true;
        context: RuntimeCoordinatorTokenValidationContext | null;
      }
    | {
        ok: false;
        reasonCode:
          | "daemon.result.identity_mismatch"
          | "runtime_coordinator.execution_id_mismatch";
      }
  > {
    const runtimeCoordinatorExecutionId = normalizeOptionalText(
      request.runtimeCoordinatorExecutionId
    );
    if (!runtimeCoordinatorExecutionId) {
      return { context: null, ok: true };
    }
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      runtimeCoordinatorExecutionId
    );
    if (!authority) {
      return { context: null, ok: true };
    }
    const mismatchReason =
      resolveRuntimeCoordinatorResultAuthorityMismatchReason({
        authority,
        request,
      });
    if (mismatchReason) {
      return {
        ok: false,
        reasonCode: mismatchReason,
      };
    }
    return {
      context:
        buildRuntimeCoordinatorTokenValidationContextFromAuthority(authority),
      ok: true,
    };
  }
  private async validateRuntimeCoordinatorProgressToken(input: {
    context: RuntimeCoordinatorTokenValidationContext;
    executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho | null;
    frameKind: RuntimeCoordinatorTokenValidationFrameKind;
    ignoredEventSummary: string;
  }): Promise<RuntimeCoordinatorExecutionTokenValidationResult> {
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      input.context.runtimeCoordinatorExecutionId
    );
    const validation =
      await validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority,
        executionTokenEcho: input.executionTokenEcho,
        expectedAuthorityScope: input.context.authorityScope,
        expectedExecutionScope: input.context.executionScope,
        nowMs: Date.now(),
      });
    if (!validation.ok) {
      this.recordRuntimeCoordinatorTokenDiagnosticEvent({
        frameKind: input.frameKind,
        ignoredEventSummary: input.ignoredEventSummary,
        reasonCode: validation.reasonCode,
        run: validation.run,
        runtimeCoordinatorExecutionId:
          input.context.runtimeCoordinatorExecutionId,
        tokenFingerprint: validation.tokenFingerprint,
        tokenStatus: validation.tokenStatus,
      });
    }
    return validation;
  }
  private async rejectResultWithoutTokenValidationContext(
    webSocket: WebSocket,
    request: RuntimeTransportSubmitTaskResultRequest
  ): Promise<void> {
    let lateTokenValidation: RuntimeCoordinatorExecutionTokenValidationResult | null;
    try {
      lateTokenValidation =
        await this.validateLateRuntimeCoordinatorProgressToken({
          executionTokenEcho: request.executionTokenEcho ?? null,
          frameKind: "result",
          ignoredEventSummary: `result:${request.dispatchId}:${request.attemptId ?? "unknown"}`,
          runtimeCoordinatorExecutionId:
            request.runtimeCoordinatorExecutionId ?? null,
        });
    } catch (error) {
      const runtimeCoordinatorExecutionId = normalizeOptionalText(
        request.runtimeCoordinatorExecutionId
      );
      if (runtimeCoordinatorExecutionId) {
        this.recordRuntimeCoordinatorTokenAuthorityUnavailableEvent({
          error,
          frameKind: "result",
          ignoredEventSummary: `result:${request.dispatchId}:${request.attemptId ?? "unknown"}`,
          runtimeCoordinatorExecutionId,
        });
      }
      this.sendFrame(webSocket, {
        code: "daemon.dispatch.accepted",
        payload: {
          attemptId: request.attemptId ?? null,
          dispatchId: request.dispatchId,
          ok: false,
          reasonCode:
            "runtime_coordinator.execution_token_authority_unavailable",
          status: "retry_later",
        },
      });
      return;
    }
    if (lateTokenValidation && !lateTokenValidation.ok) {
      await this.closeStoppedLocalAgentStreamAfterTerminalLateResult({
        reasonCode: lateTokenValidation.reasonCode,
        request,
      });
    }
    this.sendFrame(webSocket, {
      code: "daemon.dispatch.accepted",
      payload: {
        attemptId: request.attemptId ?? null,
        dispatchId: request.dispatchId,
        ok: false,
        reasonCode:
          lateTokenValidation && !lateTokenValidation.ok
            ? lateTokenValidation.reasonCode
            : "daemon.session.not_found",
        status: "rejected_terminal",
      },
    });
  }
  private async validateLateRuntimeCoordinatorProgressToken(input: {
    executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho | null;
    frameKind: RuntimeCoordinatorTokenValidationFrameKind;
    ignoredEventSummary: string;
    runtimeCoordinatorExecutionId?: string | null;
  }): Promise<RuntimeCoordinatorExecutionTokenValidationResult | null> {
    const runtimeCoordinatorExecutionId = normalizeOptionalText(
      input.runtimeCoordinatorExecutionId
    );
    if (!runtimeCoordinatorExecutionId) {
      return null;
    }
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      runtimeCoordinatorExecutionId
    );
    const validation =
      await validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority,
        executionTokenEcho: input.executionTokenEcho,
        nowMs: Date.now(),
      });
    if (!validation.ok) {
      this.recordRuntimeCoordinatorTokenDiagnosticEvent({
        frameKind: input.frameKind,
        ignoredEventSummary: input.ignoredEventSummary,
        reasonCode: validation.reasonCode,
        run: validation.run,
        runtimeCoordinatorExecutionId,
        tokenFingerprint: validation.tokenFingerprint,
        tokenStatus: validation.tokenStatus,
      });
    }
    return validation;
  }
  private async retireAcceptedRuntimeCoordinatorTokenRun(input: {
    runId: string;
    runtimeCoordinatorExecutionId: string;
  }): Promise<void> {
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      input.runtimeCoordinatorExecutionId
    );
    const run = authority?.runsById[input.runId] ?? null;
    if (!(authority && run) || run.tokenStatus !== "active") {
      return;
    }
    const nowMs = Date.now();
    await this.writeRuntimeCoordinatorTokenAuthority(
      retireRuntimeCoordinatorTokenRun({
        authority,
        reasonCode: "execution_token_terminal_late",
        retiredAtMs: nowMs,
        retentionExpiresAtMs: nowMs + authority.retention.lateResultWindowMs,
        runId: input.runId,
        tokenStatus: "terminal",
      })
    );
  }
  private validateRuntimeCoordinatorExecutionIdEcho(input: {
    attemptId: string;
    authoritativeRuntimeCoordinatorExecutionId: string | null;
    dispatchId: string;
    frameKind: RuntimeCoordinatorTokenValidationFrameKind;
    requestRuntimeCoordinatorExecutionId?: string | null;
  }):
    | {
        ok: true;
      }
    | {
        ok: false;
        reasonCode:
          | "runtime_coordinator.execution_id_missing"
          | "runtime_coordinator.execution_id_mismatch";
      } {
    const requestRuntimeCoordinatorExecutionId = normalizeOptionalText(
      input.requestRuntimeCoordinatorExecutionId
    );
    if (!requestRuntimeCoordinatorExecutionId) {
      this.recordRuntimeCoordinatorDiagnosticEvent({
        attemptId: input.attemptId,
        eventType: "runtime_coordinator_execution_id_missing",
        payload: {
          dispatchId: input.dispatchId,
          expectedRuntimeCoordinatorExecutionId:
            input.authoritativeRuntimeCoordinatorExecutionId,
          frameKind: input.frameKind,
        },
        reasonCode: "runtime_coordinator.execution_id_missing",
        runtimeCoordinatorExecutionId:
          input.authoritativeRuntimeCoordinatorExecutionId,
      });
      return {
        ok: false,
        reasonCode: "runtime_coordinator.execution_id_missing",
      };
    }
    if (
      input.authoritativeRuntimeCoordinatorExecutionId &&
      requestRuntimeCoordinatorExecutionId !==
        input.authoritativeRuntimeCoordinatorExecutionId
    ) {
      this.recordRuntimeCoordinatorDiagnosticEvent({
        attemptId: input.attemptId,
        eventType: "runtime_coordinator_execution_id_mismatch",
        payload: {
          dispatchId: input.dispatchId,
          expectedRuntimeCoordinatorExecutionId:
            input.authoritativeRuntimeCoordinatorExecutionId,
          frameKind: input.frameKind,
          requestRuntimeCoordinatorExecutionId,
        },
        reasonCode: "runtime_coordinator.execution_id_mismatch",
        runtimeCoordinatorExecutionId:
          input.authoritativeRuntimeCoordinatorExecutionId,
      });
      return {
        ok: false,
        reasonCode: "runtime_coordinator.execution_id_mismatch",
      };
    }
    return { ok: true };
  }
  private async recordRuntimeCoordinatorResultProjection(input: {
    diagnosticRuntimeCoordinatorExecutionId?: string | null;
    request: RuntimeTransportSubmitTaskResultRequest;
    response: Awaited<ReturnType<typeof handleSubmitTaskResult>>;
    verifiedRuntimeCoordinatorExecution?: RuntimeCoordinatorExecutionRecord | null;
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const attemptId = resolveSubmitResultAttemptId(input.request);
    const completed =
      attemptId === null
        ? null
        : (this.state.completedDispatchResults.get(
            buildDispatchAttemptKey(input.request.dispatchId, attemptId)
          ) ?? null);
    const runtimeCoordinatorExecutionId =
      completed?.runtimeCoordinatorExecutionId ??
      input.verifiedRuntimeCoordinatorExecution
        ?.runtimeCoordinatorExecutionId ??
      input.diagnosticRuntimeCoordinatorExecutionId ??
      null;
    if (!runtimeCoordinatorExecutionId) {
      return;
    }
    const nowMs = Date.now();
    try {
      if (input.response.ok && completed) {
        await this.writeRuntimeCoordinatorResultAcceptedProjection({
          db,
          record: buildRuntimeCoordinatorExecutionRecordFromCompleted({
            completed,
            nowMs,
            status: "result_accepted",
          }),
          runtimeCoordinatorExecutionId,
        });
        await this.linkAcceptedAgentActivityExecution({
          db,
          nowMs,
          runtimeCoordinatorExecutionId,
        });
        await writeRuntimeCoordinatorExecutionEventFromParts({
          db,
          eventType: "result_received",
          idempotencyKey: `result:${completed.dispatchId}:${completed.attemptId}:received`,
          observedAtMs: completed.receivedAtMs,
          payload: {
            submittedConnectionGeneration:
              completed.submittedConnectionGeneration,
          },
          runtimeCoordinatorExecutionId,
          statusAfter: "result_received",
        });
        await writeRuntimeCoordinatorExecutionEventFromParts({
          db,
          eventType: "result_accepted",
          idempotencyKey: `result:${completed.dispatchId}:${completed.attemptId}:accepted`,
          observedAtMs: nowMs,
          payload: {
            status: input.response.status,
          },
          runtimeCoordinatorExecutionId,
          statusAfter: "result_accepted",
        });
        const mismatchField = resolveResultIdentityEchoMismatch({
          authoritative: completed.executionIdentity,
          echoed: input.request.executionIdentityEcho,
        });
        if (mismatchField) {
          await writeRuntimeCoordinatorExecutionEventFromParts({
            db,
            eventType: "result_identity_echo_mismatch",
            idempotencyKey: `result:${completed.dispatchId}:${completed.attemptId}:identity_echo:${mismatchField}`,
            observedAtMs: nowMs,
            payload: {
              mismatchField,
            },
            reasonCode: "daemon.result.identity_mismatch",
            runtimeCoordinatorExecutionId,
            statusAfter: "result_accepted",
          });
        }
        return;
      }
      if (input.response.ok && input.verifiedRuntimeCoordinatorExecution) {
        await this.writeRuntimeCoordinatorResultAcceptedProjection({
          db,
          record: {
            ...input.verifiedRuntimeCoordinatorExecution,
            status: "result_accepted",
            updatedAtMs: nowMs,
          },
          runtimeCoordinatorExecutionId,
        });
        await this.linkAcceptedAgentActivityExecution({
          db,
          nowMs,
          runtimeCoordinatorExecutionId,
        });
        await writeRuntimeCoordinatorExecutionEventFromParts({
          db,
          eventType: "result_accepted",
          idempotencyKey: `result:${input.request.dispatchId}:${attemptId ?? "unknown"}:accepted`,
          observedAtMs: nowMs,
          payload: {
            status: input.response.status,
          },
          runtimeCoordinatorExecutionId,
          statusAfter: "result_accepted",
        });
        return;
      }
      if (input.response.ok) {
        await writeRuntimeCoordinatorExecutionEventFromParts({
          db,
          eventType: "result_accepted",
          idempotencyKey: `result:${input.request.dispatchId}:${attemptId ?? "unknown"}:accepted`,
          observedAtMs: nowMs,
          payload: {
            status: input.response.status,
          },
          runtimeCoordinatorExecutionId,
          statusAfter: "result_accepted",
        });
        return;
      }
      await writeRuntimeCoordinatorExecutionEventFromParts({
        db,
        eventType: mapResultRejectionToCoordinatorEventType(input.response),
        idempotencyKey: `result:${input.request.dispatchId}:${attemptId ?? "unknown"}:${input.response.reasonCode}`,
        observedAtMs: nowMs,
        payload: {
          status: input.response.status,
        },
        reasonCode: input.response.reasonCode,
        runtimeCoordinatorExecutionId,
        statusAfter: null,
      });
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_result_failed]",
        {
          attemptId,
          dispatchId: input.request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId,
        }
      );
    }
  }
  private async linkAcceptedAgentActivityExecution(input: {
    db: PostgresDatabase;
    nowMs: number;
    runtimeCoordinatorExecutionId: string;
  }) {
    await linkAcceptedAgentActivityExecutions(input).catch((error) => {
      console.warn("[core.agent_activity.execution_link_failed]", {
        errorMessage: error instanceof Error ? error.message : String(error),
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      });
    });
  }
  private async writeRuntimeCoordinatorResultAcceptedProjection(input: {
    db: PostgresDatabase;
    record: RuntimeCoordinatorExecutionRecord;
    runtimeCoordinatorExecutionId: string;
  }): Promise<void> {
    const existingProjection =
      await readRuntimeCoordinatorExecutionProjectionById({
        db: input.db,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      }).catch(() => null);
    if (isRuntimeCoordinatorPublicationProjectionSettled(existingProjection)) {
      return;
    }
    await writeRuntimeCoordinatorExecutionProjection({
      db: input.db,
      record: input.record,
    });
  }
  private async resolveDurableDispatchResultAcceptance(
    db: PostgresDatabase,
    result: {
      attemptId: string;
      connectionGeneration: number;
      daemonSessionId: string;
      dispatchId: string;
      executionTokenFingerprint: string | null;
      executionTokenRunId: string | null;
      leaseEpoch: number;
      runtimeCoordinatorExecutionId: string | null;
      taskResult: import("@openmeld/schemas/types").OpenMeldDaemonTaskResultEnvelope;
    }
  ) {
    const existingInboxRecord = await readDispatchResultInboxRecord(db, {
      attemptId: result.attemptId,
      dispatchId: result.dispatchId,
    }).catch(() => null);
    if (existingInboxRecord) {
      if (
        existingInboxRecord.daemonSessionId !== result.daemonSessionId ||
        existingInboxRecord.leaseEpoch !== result.leaseEpoch
      ) {
        return {
          ok: false as const,
          reasonCode: "daemon.session.stale_lease" as const,
          status: "rejected_terminal" as const,
        };
      }
      if (
        existingInboxRecord.taskId !== result.taskResult.payload.taskId ||
        existingInboxRecord.targetProfileId !==
          result.taskResult.payload.agentId
      ) {
        return {
          ok: false as const,
          reasonCode: "daemon.result.identity_mismatch" as const,
          status: "rejected_terminal" as const,
        };
      }
      if (
        !hasAcceptedResultRuntimeCoordinatorPointer(result) ||
        existingInboxRecord.runtimeCoordinatorExecutionId !==
          result.runtimeCoordinatorExecutionId ||
        existingInboxRecord.executionTokenRunId !==
          result.executionTokenRunId ||
        existingInboxRecord.executionTokenFingerprint !==
          result.executionTokenFingerprint
      ) {
        return {
          ok: false as const,
          reasonCode: "daemon.result.identity_mismatch" as const,
          status: "rejected_terminal" as const,
        };
      }
      if (existingInboxRecord.publishState !== "result_accepted") {
        return {
          ok: true as const,
          result: {
            acceptedAtMs: existingInboxRecord.acceptedAtMs,
            attemptId: existingInboxRecord.attemptId,
            daemonSessionId: existingInboxRecord.daemonSessionId,
            dispatchId: existingInboxRecord.dispatchId,
            executionTokenFingerprint:
              existingInboxRecord.executionTokenFingerprint,
            executionTokenRunId: existingInboxRecord.executionTokenRunId,
            finalizationRequired: false,
            leaseEpoch: existingInboxRecord.leaseEpoch,
            runtimeCoordinatorExecutionId:
              existingInboxRecord.runtimeCoordinatorExecutionId,
            spaceId: null,
            submittedConnectionGeneration:
              existingInboxRecord.submittedConnectionGeneration,
            targetProfileId: existingInboxRecord.targetProfileId,
            taskId: existingInboxRecord.taskId,
            taskResult: result.taskResult,
          },
        };
      }
      return {
        ok: true as const,
        result: {
          acceptedAtMs: existingInboxRecord.acceptedAtMs,
          attemptId: existingInboxRecord.attemptId,
          daemonSessionId: existingInboxRecord.daemonSessionId,
          dispatchId: existingInboxRecord.dispatchId,
          executionTokenFingerprint:
            existingInboxRecord.executionTokenFingerprint,
          executionTokenRunId: existingInboxRecord.executionTokenRunId,
          finalizationRequired: true,
          leaseEpoch: existingInboxRecord.leaseEpoch,
          runtimeCoordinatorExecutionId:
            existingInboxRecord.runtimeCoordinatorExecutionId,
          spaceId: await this.readDispatchSpaceId(db, result.dispatchId),
          submittedConnectionGeneration:
            existingInboxRecord.submittedConnectionGeneration,
          targetProfileId: existingInboxRecord.targetProfileId,
          taskId: existingInboxRecord.taskId,
          taskResult: result.taskResult,
        },
      };
    }
    if (!hasAcceptedResultRuntimeCoordinatorPointer(result)) {
      return {
        ok: false as const,
        reasonCode: "daemon.result.identity_mismatch" as const,
        status: "rejected_terminal" as const,
      };
    }
    let attemptFact: Awaited<
      ReturnType<typeof readDispatchAttemptResultAcceptanceFact>
    >;
    try {
      attemptFact = await readDispatchAttemptResultAcceptanceFact({
        attemptId: result.attemptId,
        db,
        dispatchId: result.dispatchId,
      });
    } catch {
      return {
        ok: false as const,
        reasonCode: "daemon.result.inbox_unavailable" as const,
        status: "retry_later" as const,
      };
    }
    if (attemptFact.status === "missing") {
      return {
        ok: false as const,
        reasonCode: "daemon.result.identity_mismatch" as const,
        status: "rejected_terminal" as const,
      };
    }
    if (attemptFact.status === "invalid") {
      return {
        ok: false as const,
        reasonCode: attemptFact.reasonCode,
        status: "rejected_terminal" as const,
      };
    }
    if (
      attemptFact.daemonSessionId !== result.daemonSessionId ||
      attemptFact.leaseEpoch !== result.leaseEpoch
    ) {
      return {
        ok: false as const,
        reasonCode: "daemon.session.stale_lease" as const,
        status: "rejected_terminal" as const,
      };
    }
    if (
      attemptFact.taskId !== result.taskResult.payload.taskId ||
      attemptFact.targetProfileId !== result.taskResult.payload.agentId
    ) {
      return {
        ok: false as const,
        reasonCode: "daemon.result.identity_mismatch" as const,
        status: "rejected_terminal" as const,
      };
    }
    return {
      ok: true as const,
      result: {
        acceptedAtMs: Date.now(),
        attemptId: attemptFact.attemptId,
        daemonSessionId: attemptFact.daemonSessionId,
        dispatchId: attemptFact.dispatchId,
        executionTokenFingerprint: result.executionTokenFingerprint,
        executionTokenRunId: result.executionTokenRunId,
        finalizationRequired: true,
        leaseEpoch: attemptFact.leaseEpoch,
        runtimeCoordinatorExecutionId: result.runtimeCoordinatorExecutionId,
        spaceId: attemptFact.spaceId,
        submittedConnectionGeneration: result.connectionGeneration,
        targetProfileId: attemptFact.targetProfileId,
        taskId: attemptFact.taskId,
        taskResult: result.taskResult,
      },
    };
  }
  private async readDispatchSpaceId(
    db: PostgresDatabase,
    dispatchId: string
  ): Promise<string | null> {
    try {
      const row = await db
        .query<{
          spaceId?: unknown;
        }>({
          text: `
            SELECT space_id AS "spaceId"
            FROM "openmeld"."openMeldDaemon_dispatch_ledger"
            WHERE dispatch_id = $1
            LIMIT 1
          `,
          values: [dispatchId],
        })
        .then((result) => result.rows[0] ?? null);
      return normalizeOptionalText(row?.spaceId);
    } catch (error) {
      console.warn("[core.runtime_transport.dispatch_space_read_failed]", {
        dispatchId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  private async handleDispatchLifecycleFrame(
    webSocket: WebSocket,
    payload: unknown
  ): Promise<void> {
    const parsed =
      runtimeTransportDispatchLifecycleRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid lifecycle payload",
      });
      return;
    }
    const acknowledge = async (
      initiallyAccepted: boolean,
      initialReasonCode: string | null
    ) => {
      if (!parsed.data.acknowledgementId) {
        return;
      }
      let accepted = initiallyAccepted;
      let reasonCode = initialReasonCode;
      let validForMs = 0;
      if (accepted) {
        // Re-read after projection I/O. Neither a prior validation nor a
        // delayed reply is an indefinitely valid permission to start work.
        const latest = await this.readRuntimeCoordinatorRunCommandState(
          parsed.data.runtimeCoordinatorExecutionId ?? ""
        );
        const validation =
          await this.validateLateRuntimeCoordinatorProgressToken({
            executionTokenEcho: parsed.data.executionTokenEcho ?? null,
            frameKind: "lifecycle",
            ignoredEventSummary: `admission:${parsed.data.dispatchId}:${parsed.data.attemptId}`,
            runtimeCoordinatorExecutionId:
              parsed.data.runtimeCoordinatorExecutionId ?? null,
          });
        if (validation?.ok && latest) {
          validForMs = resolveRuntimeCoordinatorExecutionAdmissionValidityMs({
            commandState: latest,
            tokenExpiresAtMs: validation.run.expiresAtMs,
            nowMs: Date.now(),
          });
        } else {
          accepted = false;
          reasonCode =
            validation && !validation.ok
              ? validation.reasonCode
              : "runtime_coordinator.execution_token_authority_unavailable";
        }
      }
      this.sendFrame(webSocket, {
        code: "daemon.dispatch.lifecycle_acknowledged",
        payload: runtimeTransportDispatchLifecycleAcknowledgementSchema.parse({
          acknowledgementId: parsed.data.acknowledgementId,
          dispatchId: parsed.data.dispatchId,
          attemptId: parsed.data.attemptId,
          connectionGeneration: parsed.data.connectionGeneration,
          accepted,
          validForMs,
          reasonCode,
        }),
      });
    };
    const pending = this.state.pendingDispatches.get(
      buildDispatchAttemptKey(parsed.data.dispatchId, parsed.data.attemptId)
    );
    const coordinatorContract = this.validateRuntimeCoordinatorExecutionIdEcho({
      attemptId: parsed.data.attemptId,
      authoritativeRuntimeCoordinatorExecutionId:
        pending?.runtimeCoordinatorExecutionId ?? null,
      dispatchId: parsed.data.dispatchId,
      frameKind: "lifecycle",
      requestRuntimeCoordinatorExecutionId:
        parsed.data.runtimeCoordinatorExecutionId ?? null,
    });
    if (!coordinatorContract.ok) {
      await acknowledge(false, coordinatorContract.reasonCode);
      this.sendErrorFrame(webSocket, {
        code: coordinatorContract.reasonCode,
        message: "dispatch lifecycle rejected",
      });
      return;
    }
    const commandState =
      await this.readRuntimeCoordinatorRunCommandStateForProgress({
        request: parsed.data,
      });
    const tokenValidationContext =
      this.resolveRuntimeCoordinatorLifecycleTokenContext({
        commandState,
        pending,
      });
    if (!tokenValidationContext) {
      const reasonCode = await this.rejectDispatchLifecycleWithoutTokenContext(
        webSocket,
        parsed.data
      );
      await acknowledge(false, reasonCode);
      return;
    }
    const tokenValidation = await this.validateRuntimeCoordinatorProgressToken({
      context: tokenValidationContext,
      executionTokenEcho: parsed.data.executionTokenEcho ?? null,
      frameKind: "lifecycle",
      ignoredEventSummary: `lifecycle:${parsed.data.dispatchId}:${parsed.data.attemptId}:${parsed.data.phase}`,
    });
    if (!tokenValidation.ok) {
      await acknowledge(false, tokenValidation.reasonCode);
      this.sendErrorFrame(webSocket, {
        code: tokenValidation.reasonCode,
        message: "dispatch lifecycle rejected",
      });
      return;
    }
    const routeReasonCode =
      this.resolveRuntimeCoordinatorLifecycleRouteRejection({
        commandState,
        request: parsed.data,
        webSocket,
      });
    if (routeReasonCode) {
      await acknowledge(false, routeReasonCode);
      this.sendErrorFrame(webSocket, {
        code: routeReasonCode,
        message: "dispatch lifecycle rejected",
      });
      return;
    }
    // Same-run keepalives still pass connection validation and acknowledgement,
    // but cannot move the occupied wait's progress or watchdog baseline.
    const { isOccupiedKeepalive } =
      await this.syncAgentProfileWorkControllerConversationOccupancy({
        currentPhase: pending?.phase ?? commandState?.localProgress.phase,
        request: parsed.data,
        tokenValidationContext,
      });
    if (pending) {
      const response = handleDispatchLifecycle(this.state, parsed.data, {
        recordProgress: !isOccupiedKeepalive,
      });
      if (!response.ok) {
        await acknowledge(
          false,
          response.reasonCode ?? "daemon.session.not_found"
        );
        this.recordRuntimeCoordinatorDiagnosticEvent({
          attemptId: parsed.data.attemptId,
          eventType: "coordinator_pending_state_missing",
          reasonCode: response.reasonCode ?? "daemon.session.not_found",
          runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
        });
        this.sendErrorFrame(webSocket, {
          code: response.reasonCode ?? "daemon.session.not_found",
          message: "dispatch lifecycle rejected",
        });
        return;
      }
    }
    const updatedPending = this.state.pendingDispatches.get(
      buildDispatchAttemptKey(parsed.data.dispatchId, parsed.data.attemptId)
    );
    const rejected =
      await this.updateRuntimeCoordinatorRunCommandStateFromLifecycle({
        activeRunId: tokenValidation.run.runId,
        pending: updatedPending ?? null,
        recordProgress: !isOccupiedKeepalive,
        request: parsed.data,
        webSocket,
      });
    if (rejected) {
      await acknowledge(false, rejected);
      return;
    }
    if (!pending && commandState) {
      this.recordRuntimeCoordinatorLifecycleProjectionFromCommandState({
        commandState,
        request: parsed.data,
      });
    } else {
      this.recordRuntimeCoordinatorLifecycleProjection(parsed.data);
    }
    await this.clearReadinessImpactFromRunningLifecycle({
      executionAuthorizedAtMs: tokenValidation.run.issuedAtMs,
      request: parsed.data,
      tokenValidationContext,
    });
    this.queueHousekeepingAlarmSync();
    await acknowledge(true, null);
  }
  private async clearReadinessImpactFromRunningLifecycle(input: {
    executionAuthorizedAtMs: number;
    request: RuntimeTransportDispatchLifecycleRequest;
    tokenValidationContext: RuntimeCoordinatorTokenValidationContext;
  }): Promise<void> {
    if (input.request.phase !== "running") {
      return;
    }
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    let clearResult: AgentExecutionReadinessImpactClearResult;
    try {
      clearResult = await clearAgentExecutionReadinessImpactForExecutionRunning(
        {
          agentProfileId:
            input.tokenValidationContext.executionScope.targetProfileId,
          clearedAtMs: Date.now(),
          db,
          executionAuthorizedAtMs: input.executionAuthorizedAtMs,
          executionIdentity: {
            bindingId: input.tokenValidationContext.authorityScope.bindingId,
            agentControllerRef:
              input.tokenValidationContext.authorityScope.agentControllerRef,
            openMeldServiceRuntimeId:
              input.tokenValidationContext.authorityScope
                .openMeldServiceRuntimeId,
          },
          sourceDispatchId: input.request.dispatchId,
        }
      );
    } catch (error) {
      console.warn(
        "[core.runtime_transport.running_readiness_impact_clear_failed]",
        {
          agentProfileId:
            input.tokenValidationContext.executionScope.targetProfileId,
          attemptId: input.request.attemptId,
          dispatchId: input.request.dispatchId,
          errorMessage: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId:
            input.request.runtimeCoordinatorExecutionId ?? null,
        }
      );
      return;
    }
    // Running lifecycle frames repeat for the whole run (progress and
    // keepalive). Only a frame that actually cleared a readiness impact
    // changes the readiness projection; re-broadcasting the rest makes every
    // Space client refetch an unchanged verdict.
    if (clearResult !== "cleared") {
      return;
    }
    this.publishAgentReadinessInvalidated({
      profileIds: [input.tokenValidationContext.executionScope.targetProfileId],
      reason: "matching_execution_running",
    });
  }
  private async syncAgentProfileWorkControllerConversationOccupancy(input: {
    currentPhase: RuntimeCoordinatorRunLocalProgressState["phase"] | undefined;
    request: RuntimeTransportDispatchLifecycleRequest;
    tokenValidationContext: RuntimeCoordinatorTokenValidationContext;
  }): Promise<{
    isOccupiedKeepalive: boolean;
  }> {
    const advancesPhase =
      input.currentPhase !== undefined &&
      resolveNextRuntimeCoordinatorRunProgressPhase({
        currentPhase: input.currentPhase,
        requestedPhase: input.request.phase,
      }) !== input.currentPhase;
    const wasOccupied =
      await readRuntimeCoordinatorAgentProfileWorkControllerConversationOccupied(
        {
          dispatchId: input.request.dispatchId,
          storage: this.ctx.storage,
          targetProfileId:
            input.tokenValidationContext.executionScope.targetProfileId,
        }
      );
    const occupancy =
      input.request.agentControllerConversationOccupancy ?? null;
    const isOccupiedKeepalive =
      wasOccupied && !advancesPhase && occupancy?.state !== "available";
    const providerTurnStarted =
      wasOccupied && advancesPhase && input.request.phase === "running";
    const state =
      occupancy?.state ?? (providerTurnStarted ? "available" : null);
    if (!state) {
      return { isOccupiedKeepalive };
    }
    try {
      await markRuntimeCoordinatorAgentProfileWorkControllerConversationOccupancy(
        {
          dispatchId: input.request.dispatchId,
          nowMs: Date.now(),
          state,
          storage: this.ctx.storage,
          targetProfileId:
            input.tokenValidationContext.executionScope.targetProfileId,
        }
      );
    } catch (error) {
      console.warn(
        "[core.runtime_transport.agent_controller_conversation_occupancy_sync_failed]",
        {
          dispatchId: input.request.dispatchId,
          errorMessage: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId:
            input.tokenValidationContext.runtimeCoordinatorExecutionId,
          state,
          targetProfileId:
            input.tokenValidationContext.executionScope.targetProfileId,
        }
      );
    }
    return { isOccupiedKeepalive };
  }
  private async readRuntimeCoordinatorRunCommandStateForProgress(input: {
    request: Pick<
      RuntimeTransportDispatchLifecycleRequest,
      "attemptId" | "dispatchId" | "runtimeCoordinatorExecutionId"
    >;
  }): Promise<RuntimeCoordinatorRunCommandState | null> {
    const runtimeCoordinatorExecutionId = normalizeOptionalText(
      input.request.runtimeCoordinatorExecutionId
    );
    if (!runtimeCoordinatorExecutionId) {
      return null;
    }
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      runtimeCoordinatorExecutionId
    );
    if (
      !commandState ||
      commandState.dispatchId !== input.request.dispatchId ||
      commandState.attemptId !== input.request.attemptId
    ) {
      return null;
    }
    return commandState;
  }
  private async readDispatchProgressProjection(
    request: Pick<
      RuntimeTransportDispatchLifecycleRequest,
      "attemptId" | "dispatchId" | "runtimeCoordinatorExecutionId"
    >
  ): Promise<PendingDispatchState | null> {
    const pending = this.state.pendingDispatches.get(
      buildDispatchAttemptKey(request.dispatchId, request.attemptId)
    );
    if (pending) {
      return pending;
    }
    const commandState =
      await this.readRuntimeCoordinatorRunCommandStateForProgress({
        request,
      });
    if (!commandState) {
      return null;
    }
    // Hibernation drops the transport cache, not the accepted execution.
    // Project its durable owner without creating another in-flight writer.
    return {
      ...buildPendingDispatchStateFromAcceptedRequest({
        acceptedRequest: commandState.sanitizedDeliveryRequest,
        nowMs: commandState.createdAtMs,
      }),
      ...commandState.lastDeliveryProvenance,
      ...commandState.localProgress,
      executionTokenRunId: commandState.activeRunId,
      lastLifecycleAtMs:
        commandState.localProgress.lastLifecycleAtMs ??
        commandState.createdAtMs,
    };
  }
  private resolveRuntimeCoordinatorLifecycleTokenContext(input: {
    commandState: RuntimeCoordinatorRunCommandState | null;
    pending: PendingDispatchState | undefined;
  }): RuntimeCoordinatorTokenValidationContext | null {
    if (input.pending) {
      return buildRuntimeCoordinatorTokenValidationContextFromPending(
        input.pending
      );
    }
    if (input.commandState) {
      return buildRuntimeCoordinatorTokenValidationContextFromCommandState(
        input.commandState
      );
    }
    return null;
  }
  private async rejectDispatchLifecycleWithoutTokenContext(
    webSocket: WebSocket,
    request: RuntimeTransportDispatchLifecycleRequest
  ): Promise<string> {
    const lateTokenValidation =
      await this.validateLateRuntimeCoordinatorProgressToken({
        executionTokenEcho: request.executionTokenEcho ?? null,
        frameKind: "lifecycle",
        ignoredEventSummary: `lifecycle:${request.dispatchId}:${request.attemptId}:${request.phase}`,
        runtimeCoordinatorExecutionId:
          request.runtimeCoordinatorExecutionId ?? null,
      });
    if (lateTokenValidation && !lateTokenValidation.ok) {
      this.sendErrorFrame(webSocket, {
        code: lateTokenValidation.reasonCode,
        message: "dispatch lifecycle rejected",
      });
      return lateTokenValidation.reasonCode;
    }
    this.recordRuntimeCoordinatorDiagnosticEvent({
      attemptId: request.attemptId,
      eventType: "coordinator_pending_state_missing",
      reasonCode: "daemon.session.not_found",
      runtimeCoordinatorExecutionId:
        request.runtimeCoordinatorExecutionId ?? null,
    });
    this.sendErrorFrame(webSocket, {
      code: "daemon.session.not_found",
      message: "dispatch lifecycle rejected",
    });
    return "daemon.session.not_found";
  }
  private async handleDispatchRuntimeEvidenceFrame(
    webSocket: WebSocket,
    payload: unknown
  ): Promise<void> {
    const parsed =
      runtimeTransportDispatchRuntimeEvidenceRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid runtime evidence payload",
      });
      return;
    }
    const pending = await this.readDispatchProgressProjection(parsed.data);
    const coordinatorContract = this.validateRuntimeCoordinatorExecutionIdEcho({
      attemptId: parsed.data.attemptId,
      authoritativeRuntimeCoordinatorExecutionId:
        pending?.runtimeCoordinatorExecutionId ?? null,
      dispatchId: parsed.data.dispatchId,
      frameKind: "runtime_evidence",
      requestRuntimeCoordinatorExecutionId:
        parsed.data.runtimeCoordinatorExecutionId ?? null,
    });
    if (!coordinatorContract.ok) {
      this.sendErrorFrame(webSocket, {
        code: coordinatorContract.reasonCode,
        message: "dispatch runtime evidence rejected",
      });
      return;
    }
    const tokenValidationContext = pending
      ? buildRuntimeCoordinatorTokenValidationContextFromPending(pending)
      : null;
    if (!tokenValidationContext) {
      const lateTokenValidation =
        await this.validateLateRuntimeCoordinatorProgressToken({
          executionTokenEcho: parsed.data.executionTokenEcho ?? null,
          frameKind: "runtime_evidence",
          ignoredEventSummary: `runtime_evidence:${parsed.data.dispatchId}:${parsed.data.attemptId}:${parsed.data.phase}`,
          runtimeCoordinatorExecutionId:
            parsed.data.runtimeCoordinatorExecutionId ?? null,
        });
      if (lateTokenValidation && !lateTokenValidation.ok) {
        this.sendErrorFrame(webSocket, {
          code: lateTokenValidation.reasonCode,
          message: "dispatch runtime evidence rejected",
        });
        return;
      }
      this.recordRuntimeCoordinatorDiagnosticEvent({
        attemptId: parsed.data.attemptId,
        eventType: "coordinator_pending_state_missing",
        reasonCode: "daemon.session.not_found",
        runtimeCoordinatorExecutionId:
          parsed.data.runtimeCoordinatorExecutionId ?? null,
      });
      this.sendErrorFrame(webSocket, {
        code: "daemon.session.not_found",
        message: "dispatch runtime evidence rejected",
      });
      return;
    }
    const tokenValidation = await this.validateRuntimeCoordinatorProgressToken({
      context: tokenValidationContext,
      executionTokenEcho: parsed.data.executionTokenEcho ?? null,
      frameKind: "runtime_evidence",
      ignoredEventSummary: `runtime_evidence:${parsed.data.dispatchId}:${parsed.data.attemptId}:${parsed.data.phase}`,
    });
    if (!tokenValidation.ok) {
      this.sendErrorFrame(webSocket, {
        code: tokenValidation.reasonCode,
        message: "dispatch runtime evidence rejected",
      });
      return;
    }
    const validation = validateDaemonDispatchRuntimeEvidence({
      evidence: parsed.data,
      pending,
    });
    if (!validation.ok) {
      this.recordRuntimeCoordinatorDiagnosticEvent({
        attemptId: parsed.data.attemptId,
        eventType:
          validation.reasonCode === "schema.invalid"
            ? "runtime_evidence_identity_echo_mismatch"
            : "coordinator_pending_state_missing",
        reasonCode: validation.reasonCode ?? "daemon.session.not_found",
        runtimeCoordinatorExecutionId:
          pending?.runtimeCoordinatorExecutionId ?? null,
      });
      this.sendErrorFrame(webSocket, {
        code: validation.reasonCode ?? "daemon.session.not_found",
        message: "dispatch runtime evidence rejected",
      });
      return;
    }
    emitDaemonDispatchRuntimeEvidence({
      env: this.env,
      evidence: parsed.data,
    });
    this.recordRuntimeCoordinatorRuntimeEvidenceEvent(parsed.data, pending);
  }
  private async handleDispatchToolActivityFrame(
    webSocket: WebSocket,
    payload: unknown,
    kind: "progress" | "reasoning" | "reply" | "tool" = "tool"
  ): Promise<void> {
    const activity = parseRuntimeTransportDispatchLiveActivity(payload, kind);
    if (!activity) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid dispatch tool activity payload",
      });
      return;
    }
    const pending = await this.readDispatchProgressProjection(activity);
    const coordinatorContract = this.validateRuntimeCoordinatorExecutionIdEcho({
      attemptId: activity.attemptId,
      authoritativeRuntimeCoordinatorExecutionId:
        pending?.runtimeCoordinatorExecutionId ?? null,
      dispatchId: activity.dispatchId,
      frameKind: "tool_activity",
      requestRuntimeCoordinatorExecutionId:
        activity.runtimeCoordinatorExecutionId ?? null,
    });
    if (!coordinatorContract.ok) {
      this.sendErrorFrame(webSocket, {
        code: coordinatorContract.reasonCode,
        message: "dispatch tool activity rejected",
      });
      return;
    }
    const tokenValidationContext = pending
      ? buildRuntimeCoordinatorTokenValidationContextFromPending(pending)
      : null;
    if (!(tokenValidationContext && pending)) {
      const lateTokenValidation =
        await this.validateLateRuntimeCoordinatorProgressToken({
          executionTokenEcho: activity.executionTokenEcho ?? null,
          frameKind: "tool_activity",
          ignoredEventSummary: `tool_activity:${activity.dispatchId}:${activity.attemptId}:${activity.sequence}`,
          runtimeCoordinatorExecutionId:
            activity.runtimeCoordinatorExecutionId ?? null,
        });
      if (lateTokenValidation && !lateTokenValidation.ok) {
        this.sendErrorFrame(webSocket, {
          code: lateTokenValidation.reasonCode,
          message: "dispatch tool activity rejected",
        });
        return;
      }
      this.sendErrorFrame(webSocket, {
        code: "daemon.session.not_found",
        message: "dispatch tool activity rejected",
      });
      return;
    }
    const tokenValidation = await this.validateRuntimeCoordinatorProgressToken({
      context: tokenValidationContext,
      executionTokenEcho: activity.executionTokenEcho ?? null,
      frameKind: "tool_activity",
      ignoredEventSummary: `tool_activity:${activity.dispatchId}:${activity.attemptId}:${activity.sequence}`,
    });
    if (!tokenValidation.ok) {
      this.sendErrorFrame(webSocket, {
        code: tokenValidation.reasonCode,
        message: "dispatch tool activity rejected",
      });
      return;
    }
    const identityValidation = validateDaemonDispatchToolActivityIdentity({
      activity,
      pending,
      state: this.state,
      webSocket,
    });
    if (!identityValidation.ok) {
      console.warn("[core.runtime_transport.tool_activity_rejected]", {
        attemptId: activity.attemptId,
        dispatchId: activity.dispatchId,
        reasonCode: identityValidation.reasonCode ?? "daemon.session.not_found",
        runtimeCoordinatorExecutionId:
          activity.runtimeCoordinatorExecutionId ?? null,
        sequence: activity.sequence,
      });
      this.sendErrorFrame(webSocket, {
        code: identityValidation.reasonCode ?? "daemon.session.not_found",
        message: "dispatch tool activity rejected",
      });
      return;
    }
    await this.publishDispatchLiveActivity(webSocket, pending, activity);
  }
  private async publishDispatchLiveActivity(
    webSocket: WebSocket,
    pending: PendingDispatchState,
    activity:
      | RuntimeTransportDispatchToolActivityRequest
      | RuntimeTransportDispatchProgressRequest
      | RuntimeTransportDispatchReplyRequest
      | RuntimeTransportDispatchReasoningRequest
  ): Promise<void> {
    const spaceStub = resolveSpaceStub(
      this.env.OPENMELD_SPACES,
      pending.spaceId
    );
    if (!spaceStub) {
      console.warn("[core.runtime_transport.tool_activity_rejected]", {
        attemptId: activity.attemptId,
        dispatchId: activity.dispatchId,
        reasonCode: "agent_stream.space_not_found",
        runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
        sequence: activity.sequence,
      });
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "dispatch tool activity rejected",
      });
      return;
    }
    const streamIdentity = {
      v: 1,
      dispatchId: pending.dispatchId,
      profileId: pending.profileId,
      sequence: activity.sequence,
      spaceId: pending.spaceId,
      streamId: buildLocalAgentStreamId({
        attemptId: pending.attemptId,
        dispatchId: pending.dispatchId,
      }),
      triggerMessageId: pending.sourceSignalId,
    } as const;
    // Authorization above awaits other owners; a privacy change can interleave.
    if ("thinkingSnapshot" in activity && !this.reasoningStreamEnabled) {
      activity.thinkingSnapshot = "";
      activity.reasoningState = { status: "disabled" };
    }
    if (
      "thinkingSnapshot" in activity &&
      activity.reasoningState.status !== "streaming"
    ) {
      activity.thinkingSnapshot = "";
    }
    let result: Awaited<ReturnType<typeof spaceStub.rpcApplyAgentStreamDelta>>;
    if ("textSnapshot" in activity) {
      // A retraction clears an existing draft; it must not create a destination.
      if (activity.textSnapshot) {
        await spaceStub.rpcResolveNativeReplyPlacement({
          spaceId: pending.spaceId,
          dispatchId: pending.dispatchId,
          sourceSignalId: pending.sourceSignalId,
          profileId: pending.profileId,
          defaultToThread: true,
          lock: false,
          ...(activity.placement ? { placement: activity.placement } : {}),
        });
      }
      result = await spaceStub.rpcApplyAgentStreamDelta({
        ...streamIdentity,
        textSnapshot: activity.textSnapshot,
      });
    } else if ("thinkingSnapshot" in activity) {
      result = await spaceStub.rpcApplyAgentStreamDelta({
        ...streamIdentity,
        kind: "thinking",
        thinkingSnapshot: activity.thinkingSnapshot,
        reasoningState: activity.reasoningState,
      });
    } else if ("progressSnapshot" in activity) {
      result = await spaceStub.rpcApplyAgentStreamDelta({
        ...streamIdentity,
        kind: "progress",
        progressSnapshot: activity.progressSnapshot,
      });
    } else {
      result = await spaceStub.rpcApplyAgentStreamPart({
        ...streamIdentity,
        part: activity.part,
      });
    }
    if (result.status === "rejected") {
      console.warn("[core.runtime_transport.tool_activity_rejected]", {
        attemptId: activity.attemptId,
        dispatchId: activity.dispatchId,
        reasonCode: result.reasonCode,
        runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
        sequence: activity.sequence,
      });
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "dispatch tool activity rejected",
      });
      return;
    }
    if (
      "textSnapshot" in activity ||
      "thinkingSnapshot" in activity ||
      "progressSnapshot" in activity
    ) {
      return;
    }
    console.info("[core.runtime_transport.tool_activity_applied]", {
      attemptId: activity.attemptId,
      dispatchId: activity.dispatchId,
      lastSequence: result.lastSequence,
      runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
      sequence: activity.sequence,
      state: activity.part.state,
      status: result.status,
      toolName: activity.part.toolName,
    });
  }
  private async handleDispatchInteractionRequestFrame(
    webSocket: WebSocket,
    payload: unknown
  ): Promise<void> {
    const parsed =
      runtimeTransportDispatchInteractionRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid dispatch interaction request",
      });
      return;
    }
    const authority = await this.resolveDispatchInteractionFrameAuthority({
      frameKind: "interaction_request",
      request: parsed.data,
      webSocket,
    });
    if (!authority) {
      return;
    }
    const nowMs = Date.now();
    if (parsed.data.interaction.expiresAtMs <= nowMs) {
      this.sendRuntimeCoordinatorInteractionResponse({
        commandState: authority.commandState,
        interactionId: parsed.data.interaction.interactionId,
        respondedAtMs: nowMs,
        response: { kind: "cancel" },
        webSocket,
      });
      return;
    }
    const existing = authority.commandState.pendingInteraction ?? null;
    if (
      isCompletedInteractionReplay(
        authority.commandState,
        parsed.data.interaction.interactionId
      )
    ) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message:
          "This interaction was already handled. A new request needs a new interaction ID.",
      });
      return;
    }
    if (existing) {
      await this.handleReplayedDispatchInteractionRequest({
        commandState: authority.commandState,
        existing,
        nowMs,
        request: parsed.data,
        webSocket,
      });
      return;
    }
    const interaction = {
      ...parsed.data.interaction,
      expiresAtMs: Math.min(
        parsed.data.interaction.expiresAtMs,
        nowMs + AGENT_INTERACTION_DEFAULT_TIMEOUT_MS
      ),
      requestedAtMs: Math.min(
        nowMs,
        Math.max(
          parsed.data.interaction.requestedAtMs,
          nowMs - AGENT_INTERACTION_DEFAULT_TIMEOUT_MS
        )
      ),
    };
    const nextCommandState: RuntimeCoordinatorRunCommandState = {
      ...authority.commandState,
      lastCommandReasonCode: "runtime_coordinator.interaction_waiting",
      lastDeliveryProvenance: {
        ...authority.commandState.lastDeliveryProvenance,
        connectionGeneration: parsed.data.connectionGeneration,
        daemonSessionId: parsed.data.daemonSessionId,
        leaseEpoch: parsed.data.leaseEpoch,
      },
      lastWatchdogCheckAtMs: null,
      pendingInteraction: {
        request: interaction,
        requestConnection: {
          connectionGeneration: parsed.data.connectionGeneration,
          daemonSessionId: parsed.data.daemonSessionId,
        },
        requestReceivedAtMs: nowMs,
        respondedAtMs: null,
        response: null,
      },
      updatedAtMs: nowMs,
    };
    const agentTaskObservation =
      this.buildRuntimeCoordinatorInteractionAgentTaskObservationDelivery({
        commandState: nextCommandState,
        interaction,
      });
    let delivery: RuntimeCoordinatorAgentTaskObservationDeliveryRecord | null =
      null;
    if (agentTaskObservation) {
      await this.ctx.storage.transaction(async (transaction) => {
        await writeRuntimeCoordinatorRunCommandStateInTransaction(
          transaction,
          nextCommandState
        );
        delivery =
          await upsertRuntimeCoordinatorAgentTaskObservationDeliveryInTransaction(
            transaction,
            {
              nowMs,
              ...agentTaskObservation,
            }
          );
      });
    } else {
      await this.writeRuntimeCoordinatorRunCommandState(nextCommandState);
    }
    // An open Space must show the new request now, not on its next poll.
    this.publishWakeProgressChanged({
      agentProfileId: nextCommandState.targetProfileId,
      clientMessageId: nextCommandState.sourceClientMessageId,
      spaceId: nextCommandState.sanitizedDeliveryRequest.payload.spaceId,
    });
    if (delivery) {
      await this.tryProjectRuntimeCoordinatorInteractionInboxItem({
        commandState: nextCommandState,
        interaction,
        nowMs,
      });
      await this.enqueueRuntimeCoordinatorAgentTaskObservationRedrive({
        delivery,
        ownerUserId: nextCommandState.ownerUserId,
      });
      const projected =
        await this.tryProjectRuntimeCoordinatorAgentTaskObservationDelivery(
          delivery
        );
      if (projected) {
        this.queueHousekeepingAlarmSync();
      } else {
        await this.syncHousekeepingAlarm();
      }
    } else {
      await this.tryProjectRuntimeCoordinatorInteractionInboxItem({
        commandState: nextCommandState,
        interaction,
        nowMs,
      });
      this.queueHousekeepingAlarmSync();
    }
  }
  // The Service replays an unanswered request on every heartbeat. Only a
  // replay on a new connection re-announces it, so an open Space that missed
  // the first notice recovers without refetching on every heartbeat.
  private async handleReplayedDispatchInteractionRequest(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    existing: RuntimeCoordinatorPendingAgentInteractionState;
    nowMs: number;
    request: RuntimeTransportDispatchInteractionRequest;
    webSocket: WebSocket;
  }): Promise<void> {
    const incomingWithAuthoritativeTimestamps = {
      ...input.request.interaction,
      expiresAtMs: input.existing.request.expiresAtMs,
      requestedAtMs: input.existing.request.requestedAtMs,
    };
    if (
      input.existing.request.interactionId !==
        input.request.interaction.interactionId ||
      !hasSameSerializedValue(
        input.existing.request,
        incomingWithAuthoritativeTimestamps
      )
    ) {
      this.sendErrorFrame(input.webSocket, {
        code: "schema.invalid",
        message: "another local agent interaction is already pending",
      });
      return;
    }
    if (input.existing.response && input.existing.respondedAtMs !== null) {
      await this.tryResolveRuntimeCoordinatorInteractionInboxItem({
        commandState: input.commandState,
        interaction: input.existing.request,
        resolvedAtMs: input.existing.respondedAtMs,
      });
      this.sendRuntimeCoordinatorInteractionResponse({
        commandState: input.commandState,
        interactionId: input.existing.request.interactionId,
        respondedAtMs: input.existing.respondedAtMs,
        response: input.existing.response,
        webSocket: input.webSocket,
      });
    } else {
      const replay =
        await this.announceRuntimeCoordinatorInteractionReplayOnNewConnection({
          commandState: input.commandState,
          pending: input.existing,
          request: input.request,
        });
      // An answer saved during validation already resolved the Inbox item;
      // projecting the earlier snapshot would reopen it.
      if (replay !== "answered") {
        await this.tryProjectRuntimeCoordinatorInteractionInboxItem({
          commandState: input.commandState,
          interaction: input.existing.request,
          nowMs: input.nowMs,
        });
      }
    }
  }
  private async announceRuntimeCoordinatorInteractionReplayOnNewConnection(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    pending: RuntimeCoordinatorPendingAgentInteractionState;
    request: RuntimeTransportDispatchInteractionRequest;
  }): Promise<"announced" | "answered" | "unchanged"> {
    const previous = input.pending.requestConnection;
    if (
      previous?.daemonSessionId === input.request.daemonSessionId &&
      previous.connectionGeneration === input.request.connectionGeneration
    ) {
      return "unchanged";
    }
    // Frame authority was read before async token validation, and an owner
    // answer can land in between. Re-read inside the write so a replay only
    // adds its connection to the same still-unanswered request and never
    // replaces a saved answer with the earlier snapshot.
    const outcome = await this.ctx.storage.transaction(
      async (transaction): Promise<"announced" | "answered" | "unchanged"> => {
        const current = await readRuntimeCoordinatorRunCommandStateFromStorage(
          transaction,
          input.commandState.runtimeCoordinatorExecutionId
        );
        const currentPending = current?.pendingInteraction ?? null;
        if (
          !(current && currentPending) ||
          current.activeRunId !== input.commandState.activeRunId ||
          currentPending.request.interactionId !==
            input.pending.request.interactionId ||
          currentPending.response !== null
        ) {
          return "answered";
        }
        // A replay validated while the Service reconnected belongs to a
        // superseded connection; it must not move the marker backward.
        const liveSession = this.state.sessionsById.get(
          input.request.daemonSessionId
        );
        const recorded = currentPending?.requestConnection;
        if (
          liveSession?.connectionGeneration !==
            input.request.connectionGeneration ||
          (recorded?.daemonSessionId === input.request.daemonSessionId &&
            recorded.connectionGeneration >
              input.request.connectionGeneration) ||
          (recorded?.daemonSessionId === input.request.daemonSessionId &&
            recorded.connectionGeneration ===
              input.request.connectionGeneration)
        ) {
          return "unchanged";
        }
        await writeRuntimeCoordinatorRunCommandStateInTransaction(transaction, {
          ...current,
          pendingInteraction: {
            ...currentPending,
            requestConnection: {
              connectionGeneration: input.request.connectionGeneration,
              daemonSessionId: input.request.daemonSessionId,
            },
          },
        });
        return "announced";
      }
    );
    if (outcome === "announced") {
      this.publishWakeProgressChanged({
        agentProfileId: input.commandState.targetProfileId,
        clientMessageId: input.commandState.sourceClientMessageId,
        spaceId: input.commandState.sanitizedDeliveryRequest.payload.spaceId,
      });
    }
    return outcome;
  }
  private async handleDispatchInteractionDeliveredFrame(
    webSocket: WebSocket,
    payload: unknown
  ): Promise<void> {
    const parsed =
      runtimeTransportDispatchInteractionDeliveredRequestSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid dispatch interaction delivery",
      });
      return;
    }
    const authority = await this.resolveDispatchInteractionFrameAuthority({
      frameKind: "interaction_delivered",
      request: parsed.data,
      webSocket,
    });
    if (!authority) {
      return;
    }
    const pendingInteraction =
      authority.commandState.pendingInteraction ?? null;
    if (!pendingInteraction) {
      return;
    }
    if (
      pendingInteraction.request.interactionId !== parsed.data.interactionId ||
      !pendingInteraction.response
    ) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "dispatch interaction delivery does not match",
      });
      return;
    }
    const deliveredAtMs = Date.now();
    const responseFingerprint = await interactionResponseFingerprint(
      pendingInteraction.response
    );
    const nextCommandState = await this.ctx.storage.transaction(
      async (transaction) => {
        const current = await readRuntimeCoordinatorRunCommandStateFromStorage(
          transaction,
          parsed.data.runtimeCoordinatorExecutionId
        );
        if (
          !current ||
          current.activeRunId !== authority.commandState.activeRunId ||
          current.pendingInteraction?.request.interactionId !==
            pendingInteraction.request.interactionId ||
          !hasSameSerializedValue(
            current.pendingInteraction.response,
            pendingInteraction.response
          )
        ) {
          return null;
        }
        const next: RuntimeCoordinatorRunCommandState = {
          ...current,
          // A cancelled waiter can finish before the native Stop frame arrives.
          // Its acknowledgement must not erase the durable Stop intent.
          lastCommandReasonCode:
            current.lastCommandReasonCode ===
              RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE ||
            current.lastCommandReasonCode ===
              "runtime_coordinator.wake_stop_delivery_pending"
              ? current.lastCommandReasonCode
              : "runtime_coordinator.interaction_delivered",
          interactionResponseReceipts: {
            ...current.interactionResponseReceipts,
            [pendingInteraction.request.interactionId]: {
              responseFingerprint,
              respondedAtMs: pendingInteraction.respondedAtMs ?? deliveredAtMs,
            },
          },
          lastDeliveryProvenance: {
            ...current.lastDeliveryProvenance,
            connectionGeneration: parsed.data.connectionGeneration,
            daemonSessionId: parsed.data.daemonSessionId,
            leaseEpoch: parsed.data.leaseEpoch,
          },
          lastWatchdogCheckAtMs: null,
          localProgress: {
            ...current.localProgress,
            lastLifecycleAtMs: Math.max(
              current.localProgress.lastLifecycleAtMs ?? 0,
              deliveredAtMs
            ),
          },
          pendingInteraction: null,
          updatedAtMs: deliveredAtMs,
        };
        await writeRuntimeCoordinatorRunCommandStateInTransaction(
          transaction,
          next
        );
        return next;
      }
    );
    if (!nextCommandState) {
      return;
    }
    this.publishWakeProgressChanged({
      agentProfileId: nextCommandState.targetProfileId,
      clientMessageId: nextCommandState.sourceClientMessageId,
      spaceId: nextCommandState.sanitizedDeliveryRequest.payload.spaceId,
    });
    await this.tryResolveRuntimeCoordinatorInteractionInboxItem({
      commandState: nextCommandState,
      interaction: pendingInteraction.request,
      resolvedAtMs: deliveredAtMs,
    });
    this.queueHousekeepingAlarmSync();
  }
  private async resolveDispatchInteractionFrameAuthority(input: {
    frameKind: "interaction_delivered" | "interaction_request";
    request:
      | RuntimeTransportDispatchInteractionDeliveredRequest
      | RuntimeTransportDispatchInteractionRequest;
    webSocket: WebSocket;
  }): Promise<{
    commandState: RuntimeCoordinatorRunCommandState;
    session: RuntimeTransportSessionState & {
      socket: WebSocket;
    };
  } | null> {
    const verifiedOwnerUserId = this.requireVerifiedOwnerUserId(
      input.webSocket
    );
    if (!verifiedOwnerUserId) {
      return null;
    }
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      input.request.runtimeCoordinatorExecutionId
    );
    const session = this.state.sessionsById.get(input.request.daemonSessionId);
    if (
      !(commandState && session?.socket) ||
      session.socket !== input.webSocket ||
      session.ownerUserId !== verifiedOwnerUserId ||
      session.connectionGeneration !== input.request.connectionGeneration ||
      session.capabilities.localAgentInteraction !== true ||
      commandState.ownerUserId !== verifiedOwnerUserId ||
      commandState.dispatchId !== input.request.dispatchId ||
      commandState.attemptId !== input.request.attemptId ||
      commandState.sanitizedDeliveryRequest.payload.taskId !==
        ("taskId" in input.request
          ? input.request.taskId
          : commandState.sanitizedDeliveryRequest.payload.taskId) ||
      resolveResultIdentityEchoMismatch({
        authoritative:
          commandState.sanitizedDeliveryRequest.payload.executionIdentity,
        echoed: input.request.executionIdentityEcho,
      }) !== null
    ) {
      this.sendErrorFrame(input.webSocket, {
        code: "daemon.session.not_found",
        message: "dispatch interaction authority not found",
      });
      return null;
    }
    const lease = this.state.profileLeasesByProfileId.get(
      commandState.profileId
    );
    if (
      !lease ||
      lease.daemonSessionId !== session.daemonSessionId ||
      lease.deviceId !== session.deviceId ||
      lease.lane !== session.lane ||
      lease.leaseEpoch !== input.request.leaseEpoch
    ) {
      this.sendErrorFrame(input.webSocket, {
        code: "daemon.session.stale_lease",
        message: "dispatch interaction lease is stale",
      });
      return null;
    }
    const tokenValidation = await this.validateRuntimeCoordinatorProgressToken({
      context:
        buildRuntimeCoordinatorTokenValidationContextFromCommandState(
          commandState
        ),
      executionTokenEcho: input.request.executionTokenEcho,
      frameKind: input.frameKind,
      ignoredEventSummary: `${input.frameKind}:${input.request.dispatchId}:${input.request.attemptId}`,
    });
    if (!tokenValidation.ok) {
      this.sendErrorFrame(input.webSocket, {
        code: tokenValidation.reasonCode,
        message: "dispatch interaction rejected",
      });
      return null;
    }
    return {
      commandState,
      session: session as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private recordRuntimeCoordinatorLifecycleProjection(
    request: RuntimeTransportDispatchLifecycleRequest
  ): void {
    const pending = this.state.pendingDispatches.get(
      buildDispatchAttemptKey(request.dispatchId, request.attemptId)
    );
    if (!pending) {
      this.recordRuntimeCoordinatorDiagnosticEvent({
        attemptId: request.attemptId,
        eventType: "coordinator_pending_state_missing",
        reasonCode: "daemon.session.not_found",
        runtimeCoordinatorExecutionId: null,
      });
      return;
    }
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const nowMs = Date.now();
    const eventType = resolveCoordinatorLifecycleEventType(request.phase);
    const record = buildRuntimeCoordinatorExecutionRecordFromPending({
      nowMs,
      pending,
      status: request.phase,
    });
    const projectionWrite = Promise.all([
      writeRuntimeCoordinatorExecutionProjection({ db, record }),
      writeRuntimeCoordinatorExecutionEventFromParts({
        db,
        eventType,
        idempotencyKey: buildCoordinatorLifecycleEventIdempotencyKey(request),
        observedAtMs: nowMs,
        payload: {
          agentControllerConversationOccupancy:
            request.agentControllerConversationOccupancy ?? null,
          lifecycleAtMs: request.lifecycleAtMs,
          runningAtMs: pending.runningAtMs,
          localQueue: request.localQueue ?? null,
          phase: request.phase,
        },
        replaceCurrentState: Boolean(
          request.agentControllerConversationOccupancy
        ),
        runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
        statusAfter: request.phase,
      }),
    ]);
    projectionWrite.catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_lifecycle_failed]",
        {
          attemptId: request.attemptId,
          dispatchId: request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private recordRuntimeCoordinatorRuntimeEvidenceEvent(
    request: RuntimeTransportDispatchRuntimeEvidenceRequest,
    pending: PendingDispatchState | null
  ): void {
    const runtimeCoordinatorExecutionId =
      pending?.runtimeCoordinatorExecutionId ?? null;
    const db = getPostgresDatabase(this.env);
    if (!(runtimeCoordinatorExecutionId && db)) {
      return;
    }
    const nowMs = Date.now();
    const eventWrite = writeRuntimeCoordinatorExecutionEventFromParts({
      db,
      eventType:
        request.phase === "failed"
          ? "result_late_diagnostic"
          : "runtime_evidence_observed",
      idempotencyKey: `runtime_evidence:${request.dispatchId}:${request.attemptId}:${request.phase}`,
      observedAtMs: nowMs,
      payload: {
        evidenceAtMs: request.evidenceAtMs,
        phase: request.phase,
      },
      reasonCode: request.reasonCode ?? null,
      runtimeCoordinatorExecutionId,
      statusAfter:
        pending?.phase === "result_received" ? "result_received" : null,
    });
    eventWrite.catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_runtime_evidence_failed]",
        {
          attemptId: request.attemptId,
          dispatchId: request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private recordRuntimeCoordinatorDiagnosticEvent(input: {
    attemptId: string;
    eventType:
      | "coordinator_pending_state_missing"
      | "runtime_coordinator_execution_id_missing"
      | "runtime_coordinator_execution_id_mismatch"
      | "runtime_evidence_identity_echo_mismatch";
    reasonCode: string;
    runtimeCoordinatorExecutionId: string | null;
    payload?: Record<string, unknown>;
  }): void {
    const db = getPostgresDatabase(this.env);
    const runtimeCoordinatorExecutionId = input.runtimeCoordinatorExecutionId;
    if (!(db && runtimeCoordinatorExecutionId)) {
      return;
    }
    const nowMs = Date.now();
    const eventWrite = writeRuntimeCoordinatorExecutionEventFromParts({
      db,
      eventType: input.eventType,
      idempotencyKey: `diagnostic:${runtimeCoordinatorExecutionId}:${input.eventType}:${input.attemptId}:${input.reasonCode}`,
      observedAtMs: nowMs,
      payload: {
        attemptId: input.attemptId,
        ...(input.payload ?? {}),
      },
      reasonCode: input.reasonCode,
      runtimeCoordinatorExecutionId,
      statusAfter: null,
    });
    eventWrite.catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_diagnostic_failed]",
        {
          attemptId: input.attemptId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private recordRuntimeCoordinatorTokenDiagnosticEvent(input: {
    frameKind: RuntimeCoordinatorTokenValidationFrameKind;
    ignoredEventSummary: string;
    reasonCode: RuntimeCoordinatorTokenReasonCode;
    run: RuntimeCoordinatorTokenRunAuthority | null;
    runtimeCoordinatorExecutionId: string;
    tokenFingerprint: string | null;
    tokenStatus: RuntimeCoordinatorTokenStatus | null;
  }): void {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const nowMs = Date.now();
    const eventWrite = writeRuntimeCoordinatorExecutionEventFromParts({
      db,
      eventType: mapTokenValidationReasonToCoordinatorEventType(
        input.reasonCode
      ),
      idempotencyKey: `token_validation:${input.runtimeCoordinatorExecutionId}:${input.frameKind}:${input.ignoredEventSummary}:${input.reasonCode}`,
      observedAtMs: nowMs,
      payload: {
        frameKind: input.frameKind,
        ignoredEventSummary: input.ignoredEventSummary,
        modelVersion: RUNTIME_COORDINATOR_TOKEN_DIAGNOSTIC_MODEL_VERSION,
        reasonCode: input.reasonCode,
        runId: input.run?.runId ?? null,
        tokenFingerprint:
          input.run?.tokenFingerprint ?? input.tokenFingerprint ?? null,
        tokenStatus: input.run?.tokenStatus ?? input.tokenStatus ?? null,
      },
      reasonCode: input.reasonCode,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      statusAfter: null,
    });
    eventWrite.catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_token_diagnostic_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          frameKind: input.frameKind,
          reasonCode: input.reasonCode,
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private recordRuntimeCoordinatorTokenAuthorityUnavailableEvent(input: {
    error: unknown;
    frameKind: RuntimeCoordinatorTokenValidationFrameKind;
    ignoredEventSummary: string;
    runtimeCoordinatorExecutionId: string;
  }): void {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const reasonCode =
      "runtime_coordinator.execution_token_authority_unavailable";
    const eventWrite = writeRuntimeCoordinatorExecutionEventFromParts({
      db,
      eventType: "runtime_coordinator_decision_recorded",
      idempotencyKey: `token_authority_unavailable:${input.runtimeCoordinatorExecutionId}:${input.frameKind}:${input.ignoredEventSummary}`,
      observedAtMs: Date.now(),
      payload: {
        frameKind: input.frameKind,
        ignoredEventSummary: input.ignoredEventSummary,
        reasonCode,
      },
      reasonCode,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      statusAfter: null,
    });
    this.ctx.waitUntil(
      eventWrite.catch((eventError) => {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_token_authority_unavailable_event_failed]",
          {
            error:
              eventError instanceof Error
                ? eventError.message
                : String(eventError),
            originalError:
              input.error instanceof Error
                ? input.error.message
                : String(input.error),
            runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
          }
        );
      })
    );
  }
  private recordRuntimeCoordinatorOwnerConflictWithoutValidationContext(input: {
    enabled: boolean;
    request: RuntimeTransportSubmitTaskResultRequest;
    runtimeCoordinatorExecutionId: string | null;
  }): void {
    if (!input.enabled) {
      return;
    }
    this.recordRuntimeCoordinatorOwnerConflictDiagnostic({
      attemptId: input.request.attemptId ?? null,
      dispatchId: input.request.dispatchId,
      ignoredEventSummary: buildOwnerConflictIgnoredEventSummary(input.request),
      request: input.request,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      sourceClientMessageId: null,
      spaceId: input.request.executionIdentityEcho.core.spaceId,
      targetProfileId: input.request.executionIdentityEcho.core.targetProfileId,
      tokenClass: "missing",
    });
  }
  private recordRuntimeCoordinatorOwnerConflictForRejectedToken(input: {
    enabled: boolean;
    request: RuntimeTransportSubmitTaskResultRequest;
    runtimeCoordinatorExecutionId: string;
    sourceClientMessageId: string | null;
    tokenValidation: Extract<
      RuntimeCoordinatorExecutionTokenValidationResult,
      {
        ok: false;
      }
    >;
  }): void {
    if (!input.enabled) {
      return;
    }
    this.recordRuntimeCoordinatorOwnerConflictDiagnostic({
      attemptId: input.request.attemptId ?? null,
      dispatchId: input.request.dispatchId,
      ignoredEventSummary: buildOwnerConflictIgnoredEventSummary(input.request),
      request: input.request,
      reasonCode:
        input.tokenValidation.reasonCode === "execution_token_missing"
          ? "runtime_coordinator.owner_conflict_token_missing"
          : input.tokenValidation.reasonCode,
      run: input.tokenValidation.run,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      sourceClientMessageId: input.sourceClientMessageId,
      spaceId: input.request.executionIdentityEcho.core.spaceId,
      targetProfileId: input.request.executionIdentityEcho.core.targetProfileId,
      tokenClass:
        input.tokenValidation.reasonCode === "execution_token_missing"
          ? "missing"
          : "stale",
    });
  }
  private recordRuntimeCoordinatorOwnerConflictForAcceptedToken(input: {
    enabled: boolean;
    request: RuntimeTransportSubmitTaskResultRequest;
    runtimeCoordinatorExecutionId: string;
    sourceClientMessageId: string | null;
    tokenValidation: Extract<
      RuntimeCoordinatorExecutionTokenValidationResult,
      {
        ok: true;
      }
    >;
  }): void {
    if (!input.enabled) {
      return;
    }
    this.recordRuntimeCoordinatorOwnerConflictDiagnostic({
      attemptId: input.request.attemptId ?? null,
      dispatchId: input.request.dispatchId,
      ignoredEventSummary: buildOwnerConflictIgnoredEventSummary(input.request),
      request: input.request,
      run: input.tokenValidation.run,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      sourceClientMessageId: input.sourceClientMessageId,
      spaceId: input.request.executionIdentityEcho.core.spaceId,
      targetProfileId: input.request.executionIdentityEcho.core.targetProfileId,
      tokenClass: "current",
    });
  }
  private recordRuntimeCoordinatorOwnerConflictDiagnostic(input: {
    attemptId: string | null;
    dispatchId: string;
    ignoredEventSummary: string;
    reasonCode?: string | null;
    request: RuntimeTransportSubmitTaskResultRequest;
    run?: RuntimeCoordinatorTokenRunAuthority | null;
    runtimeCoordinatorExecutionId: string | null;
    sourceClientMessageId: string | null;
    spaceId: string;
    targetProfileId: string;
    tokenClass: "current" | "missing" | "stale";
  }): void {
    const db = getPostgresDatabase(this.env);
    const runtimeCoordinatorExecutionId = input.runtimeCoordinatorExecutionId;
    if (!(db && runtimeCoordinatorExecutionId)) {
      return;
    }
    const decision = resolveRuntimeCoordinatorTokenAwareExecutionDecision({
      authority: null,
      eventKind: "owner_conflict",
      observedRun: input.run ?? null,
      ownerConflictTokenClass: input.tokenClass,
      trigger: "daemon",
    });
    const reasonCode = input.reasonCode ?? decision.reasonCode;
    const nowMs = Date.now();
    const eventWrite = writeRuntimeCoordinatorExecutionEventFromParts({
      db,
      eventType: mapOwnerConflictTokenClassToCoordinatorEventType(
        input.tokenClass
      ),
      idempotencyKey: `owner_conflict:${runtimeCoordinatorExecutionId}:${input.dispatchId}:${input.attemptId ?? "unknown"}:${input.tokenClass}:${reasonCode}`,
      observedAtMs: nowMs,
      payload: {
        attemptId: input.attemptId,
        coordinatorAction: decision.coordinatorAction,
        decisionKind: decision.kind,
        dispatchId: input.dispatchId,
        ignoredEventSummary: input.ignoredEventSummary,
        localOwnerConflict:
          extractRuntimeCoordinatorLocalOwnerConflictEvidence(input),
        mayPublishSpaceReply: decision.mayPublishSpaceReply,
        mayReconstructTokenFromFingerprintOrHash:
          decision.mayReconstructTokenFromFingerprintOrHash,
        mayUseD1TokenProjection: decision.mayUseD1TokenProjection,
        ownerConflictTokenClass: input.tokenClass,
        queueOrAlarmRole: decision.queueOrAlarmRole,
        reasonCode,
        runId: input.run?.runId ?? decision.runId,
        tokenFingerprint: input.run?.tokenFingerprint ?? null,
        tokenStatus: input.run?.tokenStatus ?? decision.tokenStatus,
        usesFinalClaimAuthority: decision.usesFinalClaimAuthority,
        usesLegacyClaimLeaseAuthority: decision.usesLegacyClaimLeaseAuthority,
      },
      reasonCode,
      runtimeCoordinatorExecutionId,
      statusAfter: null,
    });
    eventWrite.catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_owner_conflict_diagnostic_failed]",
        {
          dispatchId: input.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode,
          runtimeCoordinatorExecutionId,
          tokenClass: input.tokenClass,
        }
      );
    });
    if (input.tokenClass === "current") {
      this.ctx.waitUntil(
        this.decideRuntimeCoordinatorExecutionProgress({
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          attemptId: input.attemptId,
          dispatchId: input.dispatchId,
          eventKind: "owner_conflict",
          idempotencyKey: `daemon:${runtimeCoordinatorExecutionId}:${input.dispatchId}:${input.attemptId ?? "unknown"}:owner_conflict_current`,
          observedRunId: input.run?.runId ?? null,
          reasonCode,
          runtimeCoordinatorExecutionId,
          sourceClientMessageId: input.sourceClientMessageId,
          spaceId: input.spaceId,
          targetProfileId: input.targetProfileId,
          trigger: "daemon",
        }).catch((error) => {
          console.warn(
            "[core.runtime_transport.runtime_coordinator_owner_conflict_decision_failed]",
            {
              dispatchId: input.dispatchId,
              error: error instanceof Error ? error.message : String(error),
              reasonCode,
              runtimeCoordinatorExecutionId,
            }
          );
        })
      );
    }
  }
  private handleDispatchPreviewFrame(
    webSocket: WebSocket,
    payload: unknown
  ): void {
    const parsed =
      runtimeTransportDispatchPreviewRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid preview payload",
      });
      return;
    }
    this.emitPreviewSignal(parsed.data).catch(() => undefined);
  }
  private handleDispatchPreviewEndFrame(
    webSocket: WebSocket,
    payload: unknown
  ): void {
    const parsed =
      runtimeTransportDispatchPreviewEndRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid preview end payload",
      });
      return;
    }
    this.emitPreviewEndSignal(parsed.data).catch(() => undefined);
  }
  webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): void {
    this.logSocketDisconnectObservation(webSocket, {
      closeCode: code,
      closeReason: reason,
      event: "core.runtime_transport.socket_closed",
      wasClean,
    });
    safeCloseSocket(webSocket, code, reason);
    this.failCurrentDeviceOperationWaitersForSocket(webSocket);
    const daemonSessionId = this.state.sessionIdBySocket.get(webSocket);
    const readinessProfileIds = collectReadinessProfileIdsForSession(
      daemonSessionId ? this.state.sessionsById.get(daemonSessionId) : null
    );
    detachSocket(this.state, webSocket, {
      persistRuntimeRecords: this.persistRuntimeRecords,
      failPendingDispatchResultWaitersForConnectionGeneration:
        this.failPendingDispatchResultWaitersForConnectionGeneration,
    });
    if (daemonSessionId) {
      this.ctx.waitUntil(
        this.reconcileRuntimeCoordinatorExecutionsAfterSessionDisconnect({
          daemonSessionId,
        }).catch((error) => {
          console.warn(
            "[core.runtime_transport.runtime_coordinator_disconnected_session_reconcile_failed]",
            {
              daemonSessionId,
              error: error instanceof Error ? error.message : String(error),
              trigger: "socket_closed",
            }
          );
        })
      );
    }
    this.publishAgentReadinessInvalidated({
      profileIds: readinessProfileIds,
      reason: "daemon.session.socket_detached",
    });
    this.queueHousekeepingAlarmSync();
  }
  webSocketError(webSocket: WebSocket, _error: unknown): void {
    this.logSocketDisconnectObservation(webSocket, {
      closeCode: 1011,
      closeReason: "socket_error",
      event: "core.runtime_transport.socket_error",
      wasClean: false,
    });
    safeCloseSocket(webSocket, 1011, "socket_error");
    this.failCurrentDeviceOperationWaitersForSocket(webSocket);
    const daemonSessionId = this.state.sessionIdBySocket.get(webSocket);
    const readinessProfileIds = collectReadinessProfileIdsForSession(
      daemonSessionId ? this.state.sessionsById.get(daemonSessionId) : null
    );
    detachSocket(this.state, webSocket, {
      persistRuntimeRecords: this.persistRuntimeRecords,
      failPendingDispatchResultWaitersForConnectionGeneration:
        this.failPendingDispatchResultWaitersForConnectionGeneration,
    });
    if (daemonSessionId) {
      this.ctx.waitUntil(
        this.reconcileRuntimeCoordinatorExecutionsAfterSessionDisconnect({
          daemonSessionId,
        }).catch((error) => {
          console.warn(
            "[core.runtime_transport.runtime_coordinator_disconnected_session_reconcile_failed]",
            {
              daemonSessionId,
              error: error instanceof Error ? error.message : String(error),
              trigger: "socket_error",
            }
          );
        })
      );
    }
    this.publishAgentReadinessInvalidated({
      profileIds: readinessProfileIds,
      reason: "daemon.session.socket_detached",
    });
    this.queueHousekeepingAlarmSync();
  }
  private logSocketDisconnectObservation(
    webSocket: WebSocket,
    input: {
      closeCode: number;
      closeReason: string;
      event:
        | "core.runtime_transport.socket_closed"
        | "core.runtime_transport.socket_error";
      wasClean: boolean;
    }
  ): void {
    const daemonSessionId = this.state.sessionIdBySocket.get(webSocket) ?? null;
    const session = daemonSessionId
      ? (this.state.sessionsById.get(daemonSessionId) ?? null)
      : null;
    const observedAtMs = Date.now();
    const closeReason = normalizeOptionalText(input.closeReason) ?? "closed";
    const disconnectClass = classifyRuntimeTransportSocketDisconnect({
      closeCode: input.closeCode,
      closeReason,
    });
    const deployAdjacentReason =
      disconnectClass === "possible_deploy_or_edge_restart"
        ? "websocket_1006_abnormal_close"
        : null;
    this.recordSocketDisconnectRate({
      deployAdjacentReason,
      disconnectClass,
      observedAtMs,
    });
    if (session) {
      if (!session.stopCause) {
        session.acceptingDispatches = false;
        session.stopCause = "network_disconnect";
      }
      const profileIds = collectReadinessProfileIdsForSession(session).sort(
        (left, right) => left.localeCompare(right)
      );
      const serviceVersion = normalizeOptionalText(session.serviceVersion);
      this.recordSocketDisconnectSession({
        closeCode: input.closeCode,
        closeReasonCode: resolveRuntimeTransportSocketCloseReasonCode({
          closeCode: input.closeCode,
          event: input.event,
        }),
        connectedAtMs: session.connectedAtMs,
        connectionGeneration: session.connectionGeneration,
        daemonSessionId: session.daemonSessionId,
        deployAdjacentReason,
        deviceId: session.deviceId,
        disconnectedAtMs: observedAtMs,
        disconnectClass,
        durationMs: Math.max(0, observedAtMs - session.connectedAtMs),
        heartbeatAgeMs: Math.max(0, observedAtMs - session.lastHeartbeatMs),
        lane: session.lane,
        lastHeartbeatMs: session.lastHeartbeatMs,
        profileCount: profileIds.length,
        profileIds: profileIds.slice(
          0,
          SOCKET_DISCONNECT_SESSION_PROFILE_ID_LIMIT
        ),
        serviceVersion: serviceVersion?.slice(0, 64) ?? null,
        wasClean: input.wasClean,
      });
    }
    console.info(`[${input.event}]`, {
      connectionDiagnosticId:
        readRuntimeTransportSocketAttachment(webSocket)
          .connectionDiagnosticId ?? null,
      abnormalClosure: input.closeCode !== 1000 && input.closeCode !== 1001,
      closeCode: input.closeCode,
      closeReason,
      connectionGeneration: session?.connectionGeneration ?? null,
      daemonSessionId,
      deployAdjacentReason,
      deviceId: session?.deviceId ?? null,
      disconnectClass,
      durationMs: session
        ? Math.max(0, observedAtMs - session.connectedAtMs)
        : null,
      event: input.event,
      lane: session?.lane ?? null,
      observedAtMs,
      ownerUserId: session?.ownerUserId ?? null,
      wasClean: input.wasClean,
    });
  }
  private async handleDisconnectRatesDiagnosticRequest(): Promise<Response> {
    const nowMs = Date.now();
    await this.restoreSocketDisconnectRateBucketsFromStorage();
    this.pruneSocketDisconnectRateBuckets(nowMs);
    const parsedResponse =
      runtimeTransportDisconnectRatesResponseSchema.safeParse({
        ok: true,
        ownerUserId: this.state.ownerUserId,
        windowMs: SOCKET_DISCONNECT_RATE_RETENTION_MS,
        buckets: this.listSocketDisconnectRateBuckets(),
        recentSessions: await this.readRecentSocketDisconnectSessions(nowMs),
      });
    if (!parsedResponse.success) {
      console.error(
        "[core.runtime_transport.disconnect_diagnostics_response_rejected]",
        {
          event:
            "core.runtime_transport.disconnect_diagnostics_response_rejected",
          ownerUserId: this.state.ownerUserId,
          reasonCode: "schema_invalid",
        }
      );
      return Response.json(
        {
          ok: false,
          reasonCode: "runtime_transport.disconnect_rates_invalid_response",
          buckets: [],
          recentSessions: [],
        },
        { status: 500 }
      );
    }
    return Response.json(parsedResponse.data);
  }
  private recordSocketDisconnectSession(
    diagnostic: RuntimeTransportSessionDisconnectDiagnostic
  ): void {
    const parsed =
      runtimeTransportSessionDisconnectDiagnosticSchema.safeParse(diagnostic);
    if (!parsed.success) {
      console.warn(
        "[core.runtime_transport.disconnect_session_diagnostic_rejected]",
        {
          closeCode: diagnostic.closeCode,
          connectionGeneration: diagnostic.connectionGeneration,
          event:
            "core.runtime_transport.disconnect_session_diagnostic_rejected",
          reasonCode: "schema_invalid",
        }
      );
      return;
    }
    this.ctx.waitUntil(
      this.ctx.storage.transaction(async (transaction) => {
        const storedCursor = await transaction.get<unknown>(
          SOCKET_DISCONNECT_SESSION_STORAGE_CURSOR_KEY
        );
        const nextSequence =
          readSocketDisconnectSessionStorageSequence(storedCursor);
        const slot = nextSequence % SOCKET_DISCONNECT_SESSION_LIMIT;
        await transaction.put({
          [SOCKET_DISCONNECT_SESSION_STORAGE_CURSOR_KEY]: {
            nextSequence:
              nextSequence >= Number.MAX_SAFE_INTEGER ? 0 : nextSequence + 1,
          } satisfies SocketDisconnectSessionStorageCursor,
          [buildSocketDisconnectSessionStorageSlotKey(slot)]: parsed.data,
        });
      })
    );
  }
  private async readRecentSocketDisconnectSessions(
    nowMs: number
  ): Promise<RuntimeTransportSessionDisconnectDiagnostic[]> {
    const stored = await this.ctx.storage.list<unknown>({
      prefix: SOCKET_DISCONNECT_SESSION_STORAGE_SLOT_PREFIX,
    });
    const oldestRetainedAtMs = nowMs - SOCKET_DISCONNECT_RATE_RETENTION_MS;
    const diagnostics: RuntimeTransportSessionDisconnectDiagnostic[] = [];
    for (const value of stored.values()) {
      const parsed =
        runtimeTransportSessionDisconnectDiagnosticSchema.safeParse(value);
      if (
        parsed.success &&
        parsed.data.disconnectedAtMs >= oldestRetainedAtMs &&
        parsed.data.disconnectedAtMs <= nowMs
      ) {
        diagnostics.push(parsed.data);
      }
    }
    return diagnostics
      .sort((left, right) => {
        if (left.disconnectedAtMs !== right.disconnectedAtMs) {
          return right.disconnectedAtMs - left.disconnectedAtMs;
        }
        return right.connectionGeneration - left.connectionGeneration;
      })
      .slice(0, SOCKET_DISCONNECT_SESSION_LIMIT);
  }
  private recordSocketDisconnectRate(input: {
    deployAdjacentReason: string | null;
    disconnectClass: RuntimeTransportSocketDisconnectClass;
    observedAtMs: number;
  }): void {
    const hourStartMs =
      Math.floor(input.observedAtMs / SOCKET_DISCONNECT_RATE_BUCKET_MS) *
      SOCKET_DISCONNECT_RATE_BUCKET_MS;
    const bucketKey = buildSocketDisconnectRateBucketKey({
      deployAdjacentReason: input.deployAdjacentReason,
      disconnectClass: input.disconnectClass,
      hourStartMs,
    });
    const existing = this.state.socketDisconnectRateBucketsByKey.get(bucketKey);
    if (existing) {
      existing.count += 1;
      existing.lastObservedAtMs = Math.max(
        existing.lastObservedAtMs,
        input.observedAtMs
      );
    } else {
      this.state.socketDisconnectRateBucketsByKey.set(bucketKey, {
        count: 1,
        deployAdjacentReason: input.deployAdjacentReason,
        disconnectClass: input.disconnectClass,
        firstObservedAtMs: input.observedAtMs,
        hourStartMs,
        lastObservedAtMs: input.observedAtMs,
      });
    }
    const bucket =
      this.state.socketDisconnectRateBucketsByKey.get(bucketKey) ?? null;
    if (bucket) {
      this.ctx.waitUntil(this.ctx.storage.put(bucketKey, bucket));
    }
    this.pruneSocketDisconnectRateBuckets(input.observedAtMs);
  }
  private pruneSocketDisconnectRateBuckets(nowMs: number): void {
    const oldestRetainedHourStartMs =
      Math.floor(
        (nowMs - SOCKET_DISCONNECT_RATE_RETENTION_MS) /
          SOCKET_DISCONNECT_RATE_BUCKET_MS
      ) * SOCKET_DISCONNECT_RATE_BUCKET_MS;
    for (const [bucketKey, bucket] of this.state
      .socketDisconnectRateBucketsByKey) {
      if (bucket.hourStartMs < oldestRetainedHourStartMs) {
        this.state.socketDisconnectRateBucketsByKey.delete(bucketKey);
        this.ctx.waitUntil(this.ctx.storage.delete(bucketKey));
      }
    }
  }
  private async restoreSocketDisconnectRateBucketsFromStorage(): Promise<void> {
    const storedBuckets =
      await this.ctx.storage.list<RuntimeTransportSocketDisconnectRateBucket>({
        prefix: SOCKET_DISCONNECT_RATE_STORAGE_PREFIX,
      });
    for (const [bucketKey, bucket] of storedBuckets) {
      const parsed =
        runtimeTransportSocketDisconnectRateBucketSchema.safeParse(bucket);
      if (parsed.success) {
        this.state.socketDisconnectRateBucketsByKey.set(bucketKey, parsed.data);
      }
    }
  }
  private listSocketDisconnectRateBuckets(): RuntimeTransportSocketDisconnectRateBucket[] {
    return [...this.state.socketDisconnectRateBucketsByKey.values()].sort(
      compareSocketDisconnectRateBuckets
    );
  }
  private async emitPreviewSignal(
    request: RuntimeTransportDispatchPreviewRequest
  ): Promise<void> {
    const pending = this.resolvePendingPreviewState({
      attemptId: request.attemptId,
      connectionGeneration: request.connectionGeneration,
      daemonSessionId: request.daemonSessionId,
      dispatchId: request.dispatchId,
      leaseEpoch: request.leaseEpoch,
    });
    if (!pending) {
      return;
    }
    await emitSpaceTextSignal({
      env: this.env,
      spaceId: pending.spaceId,
      profile: {
        kind: "system",
        profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
        profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
      },
      text: request.previewText,
      authoringPolicy: "system_emitted",
      transient: true,
      spaceAccess: pending.spaceAccess,
      meta: {
        transient: true,
        purpose: AGENT_REPLY_PREVIEW_PURPOSE,
        dispatchId: pending.dispatchId,
        targetProfileId: pending.profileId,
        ...(pending.targetProfileName
          ? { targetProfileName: pending.targetProfileName }
          : {}),
      },
    });
  }
  private async emitPreviewEndSignal(
    request: RuntimeTransportDispatchPreviewEndRequest
  ): Promise<void> {
    const pending = this.resolvePendingPreviewState({
      attemptId: request.attemptId,
      connectionGeneration: request.connectionGeneration,
      daemonSessionId: request.daemonSessionId,
      dispatchId: request.dispatchId,
      leaseEpoch: request.leaseEpoch,
    });
    if (!pending) {
      return;
    }
    const targetProfileLabel =
      pending.targetProfileName ??
      request.targetProfileName ??
      pending.profileId;
    await emitSpaceTextSignal({
      env: this.env,
      spaceId: pending.spaceId,
      profile: {
        kind: "system",
        profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
        profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
      },
      text: `${targetProfileLabel} preview ended`,
      authoringPolicy: "system_emitted",
      transient: true,
      spaceAccess: pending.spaceAccess,
      meta: {
        transient: true,
        purpose: AGENT_REPLY_PREVIEW_END_PURPOSE,
        dispatchId: pending.dispatchId,
        targetProfileId: pending.profileId,
        ...(pending.targetProfileName
          ? { targetProfileName: pending.targetProfileName }
          : {}),
      },
    });
  }
  private resolvePendingPreviewState(input: {
    attemptId: string;
    connectionGeneration: number;
    daemonSessionId: string;
    dispatchId: string;
    leaseEpoch: number;
  }) {
    const dispatchAttemptKey = `${input.dispatchId}::${input.attemptId}`;
    const pending =
      this.state.pendingDispatches.get(dispatchAttemptKey) ?? null;
    if (!pending) {
      return null;
    }
    if (pending.daemonSessionId !== input.daemonSessionId) {
      return null;
    }
    if (pending.connectionGeneration !== input.connectionGeneration) {
      return null;
    }
    if (pending.leaseEpoch !== input.leaseEpoch) {
      return null;
    }
    return pending;
  }
  private handleFetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/stream") {
      return this.handleStreamUpgrade(request);
    }
    if (request.method !== "POST") {
      return Response.json(
        {
          ok: false,
          code: "method_not_allowed",
          message: "expected POST",
        },
        { status: 405 }
      );
    }
    if (url.pathname === "/lookup-route") {
      return this.handleLookupRouteRequest(request);
    }
    if (url.pathname === "/lookup-routes-batch") {
      return this.handleLookupRoutesBatchRequest(request);
    }
    if (url.pathname === "/lookup-owner-service") {
      return this.handleLookupOwnerServiceRequest(request);
    }
    if (url.pathname === "/diagnostics/disconnect-rates") {
      return this.handleDisconnectRatesDiagnosticRequest();
    }
    const localAgentControlHandler:
      | ((request: Request) => Promise<Response>)
      | undefined = {
      "/openmeld-tools-control": (input: Request) =>
        this.handleOpenMeldToolsControlRequest(input),
      "/local-agent-control/set-enabled": (input: Request) =>
        this.handleSetLocalAgentEnabledRequest(input),
      "/local-agent-control/fork-session": (input: Request) =>
        this.handleForkAgentSessionRequest(input),
      "/local-agent-control/installations": (input: Request) =>
        this.handleManageLocalAgentInstallationRequest(input),
      "/local-agent-control/refresh-catalog": (input: Request) =>
        this.handleRefreshLocalAgentCatalogRequest(input),
      "/local-agent-control/set-profile-workspace": (input: Request) =>
        this.handleSetProfileWorkspaceRequest(input),
      "/local-agent-control/read-profile-workspace": (input: Request) =>
        this.handleReadProfileWorkspaceRequest(input),
      "/local-agent-control/manage-profile-folders": (input: Request) =>
        this.handleManageProfileFoldersRequest(input),
      "/local-agent-control/read-profile-folder-projection": (input: Request) =>
        this.handleReadProfileFolderProjectionRequest(input),
    }[url.pathname];
    if (localAgentControlHandler) {
      return localAgentControlHandler(request);
    }
    const currentComputerControlResponse =
      this.handleCurrentComputerControlRequest(request, url.pathname);
    if (currentComputerControlResponse) {
      return currentComputerControlResponse;
    }
    if (url.pathname === "/deliver-dispatch") {
      return this.handleDeliverDispatchRequest(request);
    }
    if (url.pathname === "/wait-dispatch-result") {
      return this.handleWaitDispatchResultRequest(request);
    }
    if (url.pathname === "/route-catalog-changed") {
      return this.handleRouteCatalogChangedRequest(request);
    }
    if (url.pathname === "/runtime-coordinator/decide") {
      return this.handleRuntimeCoordinatorDecisionRequest(request);
    }
    if (url.pathname === "/runtime-coordinator/head/accept") {
      return this.handleRuntimeCoordinatorHeadAcceptRequest(request);
    }
    if (url.pathname === "/runtime-coordinator/head/no-execution") {
      return this.handleRuntimeCoordinatorHeadNoExecutionRequest(request);
    }
    if (url.pathname === "/runtime-coordinator/head/pre-agent-stop") {
      return this.handleRuntimeCoordinatorHeadPreAgentStopRequest(request);
    }
    if (url.pathname === "/runtime-coordinator/head/waiting") {
      return this.handleRuntimeCoordinatorHeadWaitingRequest(request);
    }
    if (url.pathname === "/runtime-coordinator/head/trace") {
      return this.handleRuntimeCoordinatorHeadLifecycleTraceRequest(request);
    }
    if (url.pathname === "/runtime-coordinator/pre-execution-handoff") {
      return this.handleRuntimeCoordinatorPreExecutionHandoffRequest(request);
    }
    const runtimeCoordinatorRequestHandler:
      | ((input: Request) => Promise<Response>)
      | undefined = {
      "/runtime-coordinator/interaction/read": (input: Request) =>
        this.handleRuntimeCoordinatorReadInteractionRequest(input, {
          includeRevision: false,
        }),
      "/runtime-coordinator/interaction/read-revision": (input: Request) =>
        this.handleRuntimeCoordinatorReadInteractionRequest(input, {
          includeRevision: true,
        }),
      "/runtime-coordinator/execution-input/resolve": (input: Request) =>
        this.handleExecutionInput(input, true),
      "/runtime-coordinator/execution-input": (input: Request) =>
        this.handleExecutionInput(input, false),
      "/runtime-coordinator/interaction/respond": (input: Request) =>
        this.handleRuntimeCoordinatorRespondInteractionRequest(input),
      "/runtime-coordinator/wake-stop/publication-eligibility": (
        input: Request
      ) =>
        this.handleRuntimeCoordinatorPublicationWakeStopEligibilityRequest(
          input
        ),
    }[url.pathname];
    if (runtimeCoordinatorRequestHandler) {
      return runtimeCoordinatorRequestHandler(request);
    }
    if (url.pathname === "/runtime-coordinator/wake-stop") {
      return this.handleRuntimeCoordinatorWakeStopRequest(request);
    }
    return Response.json(
      {
        ok: false,
        code: "not_found",
        message: "runtime transport path not found",
      },
      { status: 404 }
    );
  }
  private handleStreamUpgrade(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", {
        status: 400,
      });
    }
    const verifiedOwnerUserId = normalizeOptionalText(
      request.headers.get(RUNTIME_TRANSPORT_VERIFIED_OWNER_HEADER)
    );
    if (!verifiedOwnerUserId) {
      return new Response("missing verified owner user id", {
        status: 401,
      });
    }
    const [client, server] = createWebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.state.sessionIdBySocket.set(server, null);
    writeRuntimeTransportSocketAttachment(server, {
      computerPower:
        request.headers.get(COMPUTER_POWER_CAPABILITY_HEADER) === "1",
      sessionHistory:
        request.headers.get(SESSION_HISTORY_CAPABILITY_HEADER) ===
        SESSION_HISTORY_RUNTIME_CAPABILITY,
      executionAdmissionConfirmation:
        request.headers.get(OPENMELD_EXECUTION_ADMISSION_HEADER) === "1",
      admissionEvidence:
        request.headers.get(OPENMELD_ADMISSION_EVIDENCE_HEADER) === "1",
      computerCare: request.headers.get(OPENMELD_COMPUTER_CARE_HEADER) === "1",
      spaceWorkHandoff:
        request.headers.get(SPACE_WORK_HANDOFF_CAPABILITY_HEADER) === "1",
      localExecutionInput:
        request.headers.get(LOCAL_EXECUTION_INPUT_CAPABILITY_HEADER) === "1",
      connectionDiagnosticId: serviceConnectionDiagnosticIdSchema.safeParse(
        new URL(request.url).searchParams.get(
          SERVICE_CONNECTION_ID_QUERY_PARAMETER
        )
      ).data,
      reasoningStream:
        request.headers.get(OPENMELD_REASONING_STREAM_HEADER) === "1",
      computerFileAccessCapability:
        request.headers.get(OPENMELD_RUNTIME_CAPABILITIES_HEADER) ===
        COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
          ? COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
          : null,
      localFolderPickerCapability:
        request.headers.get(OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER) ===
        LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
          ? LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
          : null,
      verifiedOwnerUserId,
    });
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  private resolveVerifiedOwnerUserId(webSocket: WebSocket): string | null {
    const attachment = readRuntimeTransportSocketAttachment(webSocket);
    return attachment.verifiedOwnerUserId;
  }
  private requireVerifiedOwnerUserId(webSocket: WebSocket): string | null {
    const verifiedOwnerUserId = this.resolveVerifiedOwnerUserId(webSocket);
    if (verifiedOwnerUserId) {
      return verifiedOwnerUserId;
    }
    this.sendErrorFrame(webSocket, {
      code: "daemon.session.reject_conflict",
      message: "socket owner is not verified",
    });
    safeCloseSocket(webSocket, 1008, "session_owner_unverified");
    return null;
  }
  private async handleLookupRouteRequest(request: Request): Promise<Response> {
    const parsed = runtimeTransportLookupRouteRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          online: false,
          reasonCode: "daemon.session.not_found",
        },
        { status: 400 }
      );
    }
    const { manifest } = await this.refreshLocalComponentsRelease();
    const response = lookupRoute(this.state, parsed.data, {
      persistRuntimeRecords: this.persistRuntimeRecords,
      cleanupExpiredPendingDispatches: this.cleanupExpiredPendingDispatches,
      recordReapedReadinessProfiles: this.publishReapedReadinessProfiles,
      localComponentsManifest: manifest,
    });
    const status = response.online ? 200 : 404;
    return Response.json(response, { status });
  }
  private async handleLookupRoutesBatchRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportLookupRoutesBatchRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json({ routes: {} }, { status: 400 });
    }
    const { manifest } = await this.refreshLocalComponentsRelease();
    const response = lookupRoutesBatch(this.state, parsed.data, {
      persistRuntimeRecords: this.persistRuntimeRecords,
      cleanupExpiredPendingDispatches: this.cleanupExpiredPendingDispatches,
      recordReapedReadinessProfiles: this.publishReapedReadinessProfiles,
      localComponentsManifest: manifest,
    });
    return Response.json(response, { status: 200 });
  }
  private async handleLookupOwnerServiceRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportLookupOwnerServiceRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          online: false,
          reasonCode: "daemon.session.not_found",
        },
        { status: 400 }
      );
    }
    const { manifest } = await this.refreshLocalComponentsRelease();
    const response = lookupOwnerService(this.state, parsed.data, {
      persistRuntimeRecords: this.persistRuntimeRecords,
      cleanupExpiredPendingDispatches: this.cleanupExpiredPendingDispatches,
      recordReapedReadinessProfiles: this.publishReapedReadinessProfiles,
      localComponentsManifest: manifest,
    });
    const validated =
      runtimeTransportLookupOwnerServiceResponseSchema.safeParse(response);
    if (!validated.success) {
      return Response.json(
        {
          online: false,
          reasonCode: "daemon.session.not_found",
        },
        { status: 500 }
      );
    }
    const status = validated.data.online ? 200 : 404;
    return Response.json(validated.data, { status });
  }
  private async handleSetLocalAgentEnabledRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportSetLocalAgentEnabledRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_request",
          message:
            parsed.error.issues[0]?.message ??
            "invalid local agent control request",
        } satisfies RuntimeTransportSetLocalAgentEnabledResponse,
        { status: 400 }
      );
    }
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalAgentControlSession({
      ...parsed.data,
      capability: "setEnabled",
      unsupportedMessage:
        "The current local OpenMeld Service does not support local agent changes from OpenMeld Web.",
      updateRequiredMessage:
        "The current local OpenMeld Service must be updated before local agents can be changed from OpenMeld Web.",
    });
    if (!session.ok) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: session.reasonCode,
          message: session.message,
        } satisfies RuntimeTransportSetLocalAgentEnabledResponse,
        { status: 409 }
      );
    }
    const requestId = crypto.randomUUID();
    const framePayload =
      runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema.safeParse({
        requestId,
        payload: {
          agentId: parsed.data.agentId,
          enabled: parsed.data.enabled,
        },
      });
    if (!framePayload.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_frame",
          message:
            framePayload.error.issues[0]?.message ??
            "invalid local agent control frame",
        } satisfies RuntimeTransportSetLocalAgentEnabledResponse,
        { status: 500 }
      );
    }
    try {
      const payload = await this.sendLocalAgentControlSetEnabledAndWait({
        requestId,
        session: session.session,
        payload: framePayload.data,
      });
      if (!payload.accepted) {
        return Response.json(
          {
            status: "rejected",
            reasonCode:
              payload.reasonCode ?? "local_agent_control.rejected_by_daemon",
            message:
              payload.message ??
              "The local OpenMeld Service rejected the local agent change.",
          } satisfies RuntimeTransportSetLocalAgentEnabledResponse,
          { status: 409 }
        );
      }
      const response: RuntimeTransportSetLocalAgentEnabledResponse = {
        status: "accepted",
        payload,
      };
      const validated =
        runtimeTransportSetLocalAgentEnabledResponseSchema.safeParse(response);
      return Response.json(validated.success ? validated.data : response, {
        status: 200,
      });
    } catch (error) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.timeout",
          message:
            error instanceof Error
              ? error.message
              : "Timed out waiting for the local OpenMeld Service.",
        } satisfies RuntimeTransportSetLocalAgentEnabledResponse,
        { status: 504 }
      );
    }
  }
  private async handleForkAgentSessionRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportForkAgentSessionRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          message:
            parsed.error.issues[0]?.message ??
            "The Agent Session Fork request is invalid.",
          reasonCode: "agent_session_fork.invalid_request",
          status: "rejected",
        },
        { status: 400 }
      );
    }
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalAgentControlSession({
      ...parsed.data,
      capability: "forkSession",
      unsupportedMessage:
        "Update OpenMeld Service before forking a local Agent Session.",
      updateRequiredMessage:
        "Update OpenMeld Service before forking a local Agent Session.",
    });
    if (!session.ok) {
      return Response.json({
        agentControllerRef: parsed.data.agentControllerRef,
        message: session.message,
        operationId: parsed.data.operationId,
        organizationId: parsed.data.organizationId,
        profileName: parsed.data.profileName,
        projectId: parsed.data.projectId,
        reasonCode: session.reasonCode,
        sourceNativeSessionId: parsed.data.sourceNativeSessionId,
        status: "rejected",
      } satisfies RuntimeTransportForkAgentSessionResult);
    }
    const requestId = crypto.randomUUID();
    const frame =
      runtimeTransportLocalAgentControlForkSessionFramePayloadSchema.parse({
        requestId,
        request: {
          agentControllerRef: parsed.data.agentControllerRef,
          operationId: parsed.data.operationId,
          organizationId: parsed.data.organizationId,
          profileName: parsed.data.profileName,
          projectId: parsed.data.projectId,
          sourceNativeSessionId: parsed.data.sourceNativeSessionId,
        },
      });
    try {
      const result = await this.sendLocalAgentControlForkSessionAndWait({
        payload: frame,
        requestId,
        session: session.session,
      });
      if (
        result.operationId !== parsed.data.operationId ||
        result.agentControllerRef !== parsed.data.agentControllerRef ||
        result.sourceNativeSessionId !== parsed.data.sourceNativeSessionId
      ) {
        throw new Error("Agent Session Fork result identity does not match.");
      }
      return Response.json(result);
    } catch (error) {
      return Response.json(
        {
          agentControllerRef: parsed.data.agentControllerRef,
          message: error instanceof Error ? error.message : String(error),
          operationId: parsed.data.operationId,
          organizationId: parsed.data.organizationId,
          profileName: parsed.data.profileName,
          projectId: parsed.data.projectId,
          reasonCode: "agent_session_fork.transport_outcome_unknown",
          sourceNativeSessionId: parsed.data.sourceNativeSessionId,
          status: "outcome_unknown",
        } satisfies RuntimeTransportForkAgentSessionResult,
        { status: 504 }
      );
    }
  }
  private async handleManageLocalAgentInstallationRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportManageLocalAgentInstallationRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_request",
          message:
            parsed.error.issues[0]?.message ??
            "invalid local agent installation request",
        } satisfies RuntimeTransportManageLocalAgentInstallationResponse,
        { status: 400 }
      );
    }
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalAgentControlSession({
      ...parsed.data,
      capability: (
        {
          setup: "setupInstallations",
          read_setup: "setupInstallations",
          update: "updateInstallations",
          read_update: "updateInstallations",
          list: "manageInstallationsSafely",
          select: "manageInstallationsSafely",
        } as const
      )[parsed.data.request.operation],
      unsupportedMessage:
        "Update OpenMeld Service before choosing a local agent installation from OpenMeld Web.",
      updateRequiredMessage:
        "Update OpenMeld Service before choosing a local agent installation from OpenMeld Web.",
    });
    if (!session.ok) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: session.reasonCode,
          message: session.message,
        } satisfies RuntimeTransportManageLocalAgentInstallationResponse,
        { status: 409 }
      );
    }
    const requestId = crypto.randomUUID();
    const framePayload =
      runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema.safeParse(
        {
          requestId,
          payload: parsed.data.request,
        }
      );
    if (!framePayload.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_frame",
          message:
            framePayload.error.issues[0]?.message ??
            "invalid local agent installation frame",
        } satisfies RuntimeTransportManageLocalAgentInstallationResponse,
        { status: 500 }
      );
    }
    try {
      const payload = await this.sendLocalAgentControlManageInstallationAndWait(
        {
          requestId,
          session: session.session,
          payload: framePayload.data,
        }
      );
      if (!payload.accepted) {
        return Response.json(
          {
            status: "rejected",
            reasonCode:
              payload.reasonCode ?? "local_agent_control.rejected_by_daemon",
            message:
              payload.message ??
              "OpenMeld Service could not manage this local agent installation.",
          } satisfies RuntimeTransportManageLocalAgentInstallationResponse,
          { status: 409 }
        );
      }
      const response: RuntimeTransportManageLocalAgentInstallationResponse = {
        status: "accepted",
        payload,
      };
      const validated =
        runtimeTransportManageLocalAgentInstallationResponseSchema.safeParse(
          response
        );
      return Response.json(validated.success ? validated.data : response, {
        status: 200,
      });
    } catch (error) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.timeout",
          message:
            error instanceof Error
              ? error.message
              : "Timed out waiting for OpenMeld Service.",
        } satisfies RuntimeTransportManageLocalAgentInstallationResponse,
        { status: 504 }
      );
    }
  }
  private async handleReadProfileWorkspaceRequest(
    request: Request
  ): Promise<Response> {
    const reject = (status: number, reasonCode: string, message: string) =>
      Response.json(
        {
          status: "rejected",
          reasonCode,
          message,
        } satisfies import("@openmeld/schemas/types").RuntimeTransportReadProfileWorkspaceResponse,
        { status }
      );
    const parsed = runtimeTransportReadProfileWorkspaceRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return reject(
        400,
        "local_agent_control.invalid_request",
        "Invalid working-folder read request."
      );
    }
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalAgentControlSession({
      ...parsed.data,
      capability: "readProfileWorkspace",
      unsupportedMessage:
        "Update OpenMeld Service to read saved working-folder settings.",
      updateRequiredMessage:
        "Update OpenMeld Service to read saved working-folder settings.",
    });
    if (!session.ok) {
      return reject(409, session.reasonCode, session.message);
    }
    const requestId = crypto.randomUUID();
    const payload =
      runtimeTransportLocalAgentControlReadProfileWorkspaceFramePayloadSchema.parse(
        { requestId, payload: { targetProfileId: parsed.data.targetProfileId } }
      );
    try {
      const result = await this.sendCurrentDeviceOperationAndWait<
        import("@openmeld/schemas/types").OpenMeldDaemonReadProfileWorkspacePayload
      >({
        code: "daemon.local_agent_control.read_profile_workspace",
        expectedResponseCode: "daemon.local_agent_control.result",
        isExpectedPayload: (value) =>
          openMeldDaemonReadProfileWorkspacePayloadSchema.safeParse(value)
            .success,
        payload: payload as unknown as Record<string, unknown>,
        requestId,
        session: session.session,
        timeoutMs: resolveLocalAgentControlResponseTimeoutMs(
          "read_profile_workspace"
        ),
      });
      if (!result.accepted) {
        return reject(409, result.reasonCode, result.message);
      }
      if (result.targetProfileId !== parsed.data.targetProfileId) {
        return reject(
          502,
          "local_agent_control.invalid_response",
          "OpenMeld Service returned settings for a different Agent."
        );
      }
      return Response.json(
        runtimeTransportReadProfileWorkspaceResponseSchema.parse({
          status: "accepted",
          payload: result,
        })
      );
    } catch (error) {
      return reject(
        504,
        error instanceof CurrentDeviceOperationError &&
          error.kind === "invalid_response"
          ? "local_agent_control.invalid_response"
          : "local_agent_control.timeout",
        "OpenMeld could not confirm the saved working-folder settings. Try again."
      );
    }
  }

  private async handleManageProfileFoldersRequest(
    request: Request
  ): Promise<Response> {
    const reject = (status: number, reasonCode: string, message: string) =>
      Response.json(
        {
          status: "rejected",
          reasonCode,
          message,
        } satisfies import("@openmeld/schemas/types").RuntimeTransportManageProfileFoldersResponse,
        { status }
      );
    const parsed = runtimeTransportManageProfileFoldersRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return reject(
        400,
        "local_agent_control.invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid folder request."
      );
    }
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalAgentControlSession({
      ...parsed.data,
      // Older Services ignore an operation they can't parse, so a repair
      // needs its own capability instead of timing out.
      capability:
        parsed.data.operation.operation === "repair"
          ? "repairProfileFolders"
          : "manageProfileFolders",
      unsupportedMessage:
        parsed.data.operation.operation === "repair"
          ? "Update OpenMeld Service to repair this Agent’s folder settings."
          : "Update OpenMeld Service to manage this Agent’s folders.",
      updateRequiredMessage:
        "Update OpenMeld Service to manage this Agent’s folders.",
    });
    if (!session.ok) {
      return reject(409, session.reasonCode, session.message);
    }
    const requestId = crypto.randomUUID();
    const framePayload =
      runtimeTransportLocalAgentControlManageProfileFoldersFramePayloadSchema.parse(
        {
          requestId,
          payload: {
            targetProfileId: parsed.data.targetProfileId,
            operation: parsed.data.operation,
          },
        }
      );
    let result: import("@openmeld/schemas/types").OpenMeldDaemonManageProfileFoldersPayload;
    try {
      result = await this.sendCurrentDeviceOperationAndWait({
        code: "daemon.local_agent_control.manage_profile_folders",
        expectedResponseCode: "daemon.local_agent_control.result",
        isExpectedPayload: (value) =>
          openMeldDaemonManageProfileFoldersPayloadSchema.safeParse(value)
            .success,
        payload: framePayload as unknown as Record<string, unknown>,
        requestId,
        session: session.session,
        timeoutMs: resolveLocalAgentControlResponseTimeoutMs(
          "manage_profile_folders"
        ),
      });
    } catch (error) {
      return reject(
        504,
        error instanceof CurrentDeviceOperationError &&
          error.kind === "invalid_response"
          ? "local_agent_control.invalid_response"
          : "local_agent_control.timeout",
        "OpenMeld could not confirm this Agent’s folders. Try again."
      );
    }
    if (result.targetProfileId !== parsed.data.targetProfileId) {
      return reject(
        502,
        "local_agent_control.invalid_response",
        "OpenMeld Service returned folders for a different Agent."
      );
    }
    if (!result.accepted) {
      return reject(409, result.reasonCode, result.message);
    }
    const record = await writeProfileFolderProjectionRecord({
      observedAtMs: Date.now(),
      projection: result.projection,
      replaces: parsed.data.operation.operation === "repair",
      storage: this.ctx.storage,
      target: parsed.data,
    });
    return Response.json(
      runtimeTransportManageProfileFoldersResponseSchema.parse({
        status: "accepted",
        payload: result,
        record,
      })
    );
  }

  private async handleReadProfileFolderProjectionRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportReadProfileFolderProjectionRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_request",
          message: "Invalid folder projection read.",
        } satisfies import("@openmeld/schemas/types").RuntimeTransportReadProfileFolderProjectionResponse,
        { status: 400 }
      );
    }
    const record = await readProfileFolderProjectionRecord({
      storage: this.ctx.storage,
      target: parsed.data,
    });
    return Response.json(
      runtimeTransportReadProfileFolderProjectionResponseSchema.parse(
        record ? { status: "found", record } : { status: "not_recorded" }
      )
    );
  }

  private async handleSetProfileWorkspaceRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportSetProfileWorkspaceRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_request",
          message:
            parsed.error.issues[0]?.message ??
            "invalid profile workspace control request",
        } satisfies RuntimeTransportSetProfileWorkspaceResponse,
        { status: 400 }
      );
    }
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalAgentControlSession({
      ...parsed.data,
      capability: parsed.data.onlyIfUnconfigured
        ? "initializeProfileWorkspace"
        : "setProfileWorkspace",
      unsupportedMessage:
        "The current local OpenMeld Service does not support Project folder changes from OpenMeld Web.",
      updateRequiredMessage:
        "The current local OpenMeld Service must be updated before Project folders can be changed from OpenMeld Web.",
    });
    if (!session.ok) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: session.reasonCode,
          message: session.message,
        } satisfies RuntimeTransportSetProfileWorkspaceResponse,
        { status: 409 }
      );
    }
    const requestId = crypto.randomUUID();
    const framePayload =
      runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema.safeParse(
        {
          requestId,
          payload: {
            targetProfileId: parsed.data.targetProfileId,
            workspaceMode: parsed.data.workspaceMode,
            ...(parsed.data.onlyIfUnconfigured
              ? { onlyIfUnconfigured: true }
              : {}),
            ...(parsed.data.workspacePath === undefined
              ? {}
              : { workspacePath: parsed.data.workspacePath }),
          },
        }
      );
    if (!framePayload.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_frame",
          message:
            framePayload.error.issues[0]?.message ??
            "invalid profile workspace control frame",
        } satisfies RuntimeTransportSetProfileWorkspaceResponse,
        { status: 500 }
      );
    }
    try {
      const payload =
        await this.sendLocalAgentControlSetProfileWorkspaceAndWait({
          requestId,
          session: session.session,
          payload: framePayload.data,
        });
      if (!payload.accepted) {
        return Response.json(
          {
            status: "rejected",
            reasonCode:
              payload.reasonCode ?? "local_agent_control.rejected_by_daemon",
            message:
              payload.message ??
              "The local OpenMeld Service rejected the Project folder change.",
          } satisfies RuntimeTransportSetProfileWorkspaceResponse,
          { status: 409 }
        );
      }
      const response: RuntimeTransportSetProfileWorkspaceResponse = {
        status: "accepted",
        payload,
      };
      const validated =
        runtimeTransportSetProfileWorkspaceResponseSchema.safeParse(response);
      return Response.json(validated.success ? validated.data : response, {
        status: 200,
      });
    } catch (error) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.timeout",
          message:
            error instanceof Error
              ? error.message
              : "Timed out waiting for the local OpenMeld Service.",
        } satisfies RuntimeTransportSetProfileWorkspaceResponse,
        { status: 504 }
      );
    }
  }
  private async handleRefreshLocalAgentCatalogRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRefreshLocalAgentCatalogRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_request",
          message:
            parsed.error.issues[0]?.message ??
            "invalid local agent catalog refresh request",
        } satisfies RuntimeTransportRefreshLocalAgentCatalogResponse,
        { status: 400 }
      );
    }
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalAgentControlSession({
      ...parsed.data,
      capability: "refreshCatalog",
      unsupportedMessage:
        "The current local OpenMeld Service does not support checking local agents from OpenMeld Web.",
      updateRequiredMessage:
        "The current local OpenMeld Service must be updated before OpenMeld Web can check local agents.",
    });
    if (!session.ok) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: session.reasonCode,
          message: session.message,
        } satisfies RuntimeTransportRefreshLocalAgentCatalogResponse,
        { status: 409 }
      );
    }
    const requestId = crypto.randomUUID();
    const framePayload =
      runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema.safeParse(
        {
          requestId,
          payload: {
            reason: parsed.data.reason,
          },
        }
      );
    if (!framePayload.success) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.invalid_frame",
          message:
            framePayload.error.issues[0]?.message ??
            "invalid local agent catalog refresh frame",
        } satisfies RuntimeTransportRefreshLocalAgentCatalogResponse,
        { status: 500 }
      );
    }
    try {
      const payload = await this.sendLocalAgentControlRefreshCatalogAndWait({
        requestId,
        session: session.session,
        payload: framePayload.data,
      });
      if (!payload.accepted) {
        return Response.json(
          {
            status: "rejected",
            reasonCode:
              payload.note ?? "local_agent_control.refresh_rejected_by_daemon",
            message:
              payload.errorMessage ??
              "The local OpenMeld Service could not check local agents.",
          } satisfies RuntimeTransportRefreshLocalAgentCatalogResponse,
          { status: 409 }
        );
      }
      const response: RuntimeTransportRefreshLocalAgentCatalogResponse = {
        status: "accepted",
        payload,
      };
      const validated =
        runtimeTransportRefreshLocalAgentCatalogResponseSchema.safeParse(
          response
        );
      return Response.json(validated.success ? validated.data : response, {
        status: 200,
      });
    } catch (error) {
      return Response.json(
        {
          status: "rejected",
          reasonCode: "local_agent_control.timeout",
          message:
            error instanceof Error
              ? error.message
              : "Timed out waiting for the local OpenMeld Service.",
        } satisfies RuntimeTransportRefreshLocalAgentCatalogResponse,
        { status: 504 }
      );
    }
  }
  private async handleDeliverDispatchRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportDeliverDispatchRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      const response: RuntimeTransportDeliverDispatchResponse = {
        accepted: false,
        status: "rejected",
        reasonCode: "daemon.session.not_found",
      };
      return Response.json(response, { status: 400 });
    }
    const existingPreExecutionHandoff =
      await this.readRuntimeCoordinatorPreExecutionHandoffRecord(
        parsed.data.dispatchId
      );
    if (existingPreExecutionHandoff?.publicationStatus === "published") {
      const response: RuntimeTransportDeliverDispatchResponse = {
        accepted: false,
        reasonCode: "daemon.profile.offline",
        status: "rejected",
      };
      return Response.json(response, { status: 409 });
    }
    let preparedDeliveryRequest: RuntimeTransportDeliverDispatchRequest | null =
      null;
    const acceptedDeliveryRequests: RuntimeTransportDeliverDispatchRequest[] =
      [];
    const deliveryRouteAssessment: {
      current: {
        evidence: RuntimeCoordinatorDeliveryRouteEvidence;
        observedAtMs: number;
        request: RuntimeTransportDeliverDispatchRequest;
        response: RuntimeTransportDeliverDispatchResponse;
      } | null;
    } = { current: null };
    const response = await deliverDispatch(this.state, parsed.data, {
      onAcceptedDeliverySent: (request) => {
        acceptedDeliveryRequests.push(request);
      },
      onDeliveryRouteAssessed: (assessment) => {
        deliveryRouteAssessment.current = assessment;
      },
      prepareAcceptedDelivery: async (request) => {
        const prepared =
          await this.prepareRuntimeCoordinatorAcceptedDelivery(request);
        if (prepared.ok) {
          preparedDeliveryRequest = prepared.request;
        }
        return prepared;
      },
      reapExpiredLeases: this.reapExpiredLeases,
      sendFrame: this.sendFrame,
      resolvePendingResultWaiters: this.resolvePendingResultWaiters,
      cleanupCompletedResults: this.cleanupCompletedResults,
    });
    if (!response.accepted && deliveryRouteAssessment.current) {
      console.info("[core.runtime_transport.delivery_route_assessed]", {
        event: CORE_LOG_EVENTS.runtimeTransportDeliveryRouteAssessed,
        attemptId: parsed.data.attemptId,
        dispatchId: parsed.data.dispatchId,
        observedAtMs: deliveryRouteAssessment.current.observedAtMs,
        runtimeCoordinatorExecutionId:
          parsed.data.payload.runtimeCoordinatorExecutionId,
        reasonCode: response.reasonCode,
        ...deliveryRouteAssessment.current.evidence,
      });
    }
    const acceptedDeliveryRequest = acceptedDeliveryRequests[0] ?? null;
    if (!response.accepted && preparedDeliveryRequest) {
      await this.rollbackRuntimeCoordinatorUnsentDelivery(
        preparedDeliveryRequest
      );
    }
    if (response.accepted) {
      await this.markRuntimeCoordinatorPreExecutionHandoffRecovered(
        parsed.data.dispatchId
      );
    }
    await this.recordRuntimeCoordinatorDeliveryProjection({
      deliveryRouteAssessment: deliveryRouteAssessment.current,
      request: acceptedDeliveryRequest ?? parsed.data,
      response,
    });
    const validated =
      runtimeTransportDeliverDispatchResponseSchema.safeParse(response);
    if (!validated.success) {
      return Response.json(
        {
          accepted: false,
          status: "rejected",
          reasonCode: "daemon.session.not_found",
        } satisfies RuntimeTransportDeliverDispatchResponse,
        { status: 500 }
      );
    }
    await this.syncHousekeepingAlarm();
    return Response.json(validated.data, {
      status: validated.data.accepted ? 200 : 409,
    });
  }
  private async prepareRuntimeCoordinatorAcceptedDelivery(
    request: RuntimeTransportDeliverDispatchRequest
  ): Promise<
    | {
        ok: true;
        request: RuntimeTransportDeliverDispatchRequest;
      }
    | {
        ok: false;
        reasonCode:
          | "runtime_coordinator.head_execution_link_unavailable"
          | "runtime_coordinator.pre_agent_stop_requested"
          | "runtime_coordinator.execution_token_scope_mismatch"
          | "runtime_coordinator.execution_token_unavailable";
      }
  > {
    const runtimeCoordinatorExecutionId =
      request.payload.runtimeCoordinatorExecutionId;
    try {
      const nowMs = Date.now();
      const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
        clientMessageId: request.payload.sourceClientMessageId ?? null,
        dispatchId: request.dispatchId,
        sourceSignalId: request.payload.sourceEventId,
        spaceId: request.payload.spaceId,
        targetProfileId: request.payload.targetProfileId,
      });
      const existingAuthority = await this.readRuntimeCoordinatorTokenAuthority(
        runtimeCoordinatorExecutionId
      );
      const issued = await issueRuntimeCoordinatorExecutionToken({
        authorityScope: {
          bindingId: request.payload.executionIdentity.core.bindingId,
          agentControllerRef:
            request.payload.executionIdentity.core.agentControllerRef,
          openMeldServiceRuntimeId:
            request.payload.executionIdentity.core.openMeldServiceRuntimeId
              .value,
        },
        deliveryProvenance: {
          connectionGeneration: request.connectionGeneration,
          daemonSessionId: request.daemonSessionId,
          leaseEpoch: request.leaseEpoch,
        },
        existingAuthority,
        executionScope: {
          dispatchId: request.dispatchId,
          runtimeCoordinatorExecutionId,
          sourceClientMessageId: request.payload.sourceClientMessageId ?? null,
          spaceId: request.payload.spaceId,
          targetProfileId: request.payload.targetProfileId,
        },
        nowMs,
      });
      const acceptedRequest = {
        ...request,
        payload: {
          ...request.payload,
          executionToken: issued.envelope,
        },
      };
      const commandState =
        await this.buildRuntimeCoordinatorRunCommandStateFromDelivery({
          nowMs,
          reasonCode: "runtime_coordinator.delivery_command_stored",
          request: acceptedRequest,
        });
      const watchdogAtMs =
        resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs(commandState);
      if (watchdogAtMs === null) {
        throw new Error("runtime_coordinator.delivery_watchdog_unavailable");
      }
      const existingAlarmAtMs = await this.ctx.storage.getAlarm();
      const alarmAtMs =
        minNullableTimestamp(existingAlarmAtMs, watchdogAtMs) ?? watchdogAtMs;
      const preparation =
        await prepareRuntimeCoordinatorAcceptedDeliveryWithAdmission({
          alarmAtMs,
          authority: issued.authority,
          commandState,
          nowMs,
          storage: this.ctx.storage,
          targetWakeLifecycleId:
            targetWakeLifecycleIdentity.targetWakeLifecycleId,
        });
      if (!preparation.ok) {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_head_link_unavailable]",
          {
            dispatchId: request.dispatchId,
            reasonCode: preparation.reasonCode,
            runtimeCoordinatorExecutionId,
            targetProfileId: request.payload.targetProfileId,
          }
        );
        return {
          ok: false,
          reasonCode:
            preparation.reasonCode ===
            "runtime_coordinator.pre_agent_stop_requested"
              ? "runtime_coordinator.pre_agent_stop_requested"
              : "runtime_coordinator.head_execution_link_unavailable",
        };
      }
      this.scheduledHousekeepingAlarmAtMs = alarmAtMs;
      this.publishAgentReadinessInvalidated({
        profileIds: [request.payload.targetProfileId],
        reason: "agent_profile_work_coordinator.changed",
      });
      return {
        ok: true,
        request: acceptedRequest,
      };
    } catch (error) {
      const reasonCode =
        error instanceof Error &&
        error.message === "runtime_coordinator.execution_token_scope_mismatch"
          ? "runtime_coordinator.execution_token_scope_mismatch"
          : "runtime_coordinator.execution_token_unavailable";
      console.warn("[core.runtime_transport.execution_token_issue_failed]", {
        dispatchId: request.dispatchId,
        error: error instanceof Error ? error.message : String(error),
        reasonCode,
        runtimeCoordinatorExecutionId,
      });
      return {
        ok: false,
        reasonCode,
      };
    }
  }
  private async readRuntimeCoordinatorTokenAuthority(
    runtimeCoordinatorExecutionId: string
  ): Promise<RuntimeCoordinatorExecutionTokenAuthorityRecord | null> {
    return await readRuntimeCoordinatorTokenAuthorityFromStorage(
      this.ctx.storage,
      runtimeCoordinatorExecutionId
    );
  }
  private async readMatchingRuntimeCoordinatorTerminalAuthorityForHead(
    request: RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest
  ): Promise<RuntimeCoordinatorExecutionTokenAuthorityRecord | null> {
    const identity = request.targetWakeLifecycleIdentity;
    const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: request.dispatchId,
      spaceId: identity.spaceId,
      targetProfileId: identity.targetProfileId,
    });
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      runtimeCoordinatorExecutionId
    );
    if (
      !authority?.terminalOutcome ||
      authority.executionScope.dispatchId !== request.dispatchId ||
      authority.executionScope.runtimeCoordinatorExecutionId !==
        runtimeCoordinatorExecutionId ||
      authority.executionScope.sourceClientMessageId !==
        identity.clientMessageId ||
      authority.executionScope.spaceId !== identity.spaceId ||
      authority.executionScope.targetProfileId !== identity.targetProfileId
    ) {
      return null;
    }
    return authority;
  }
  private async readRuntimeCoordinatorTokenAuthorityForDecision(
    runtimeCoordinatorExecutionId: string
  ): Promise<RuntimeCoordinatorDecisionAuthorityRead> {
    try {
      const authority = await this.readRuntimeCoordinatorTokenAuthority(
        runtimeCoordinatorExecutionId
      );
      return authority
        ? {
            authority,
            status: "found",
          }
        : {
            authority: null,
            status: "missing",
          };
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_authority_read_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId,
        }
      );
      return {
        authority: null,
        reasonCode: "runtime_coordinator.execution_token_authority_unavailable",
        status: "unavailable",
      };
    }
  }
  private async writeRuntimeCoordinatorTokenAuthority(
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
  ): Promise<void> {
    const pendingPromotion =
      await writeRuntimeCoordinatorTokenAuthorityToStorage(
        this.ctx.storage,
        authority
      );
    if (authority.terminalOutcome || pendingPromotion) {
      this.publishAgentReadinessInvalidated({
        profileIds: [authority.executionScope.targetProfileId],
        reason: "agent_profile_work_coordinator.changed",
      });
    }
    if (authority.terminalOutcome) {
      this.scheduledHousekeepingAlarmAtMs = undefined;
    }
    if (pendingPromotion) {
      await this.requestSpaceDispatchOutboxRedriveForPromotion(
        pendingPromotion,
        "terminal_transaction"
      );
    }
  }
  private async processAgentProfileWorkRecoveryInboxAlarm(
    run: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    const intents =
      await readPendingAgentProfileWorkRecoveryInboxProjectionIntents(
        this.ctx.storage,
        AGENT_PROFILE_WORK_RECOVERY_INBOX_HOUSEKEEPING_BATCH_SIZE,
        Date.now()
      );
    for (const intent of intents) {
      if (
        !this.reserveHousekeepingAlarmWorkUnit(
          run,
          "runtime_coordinator_agent_profile_work_recovery_inbox"
        )
      ) {
        return;
      }
      await this.tryApplyAgentProfileWorkRecoveryInboxProjection(intent);
    }
  }
  private async tryApplyAgentProfileWorkRecoveryInboxProjection(
    intent: AgentProfileWorkRecoveryInboxProjectionIntent
  ): Promise<void> {
    try {
      const targetInboxDb = getPostgresDatabase(this.env);
      if (!targetInboxDb) {
        throw new Error(
          "runtime_coordinator.agent_profile_work_recovery_inbox.db_unavailable"
        );
      }
      const [profileScopeResult, interruptedHead] = await Promise.all([
        resolveAgentProfileWorkRecoveryAuthScope({
          agentProfileId: intent.targetProfileId,
          authWorker: this.env.OPENMELD_AUTH_WORKER,
        }),
        this.ctx.storage.get<unknown>(
          buildRuntimeCoordinatorHeadLifecycleStorageKey(
            intent.targetWakeLifecycleId
          )
        ),
      ]);
      if (
        profileScopeResult.status !== "valid" ||
        !isRuntimeCoordinatorHeadLifecycleRecord(interruptedHead) ||
        interruptedHead.ownerUserId !== profileScopeResult.scope.ownerUserId ||
        interruptedHead.targetWakeLifecycleIdentity.targetProfileId !==
          intent.targetProfileId ||
        !interruptedHead.targetWakeLifecycleIdentity.clientMessageId
      ) {
        throw new Error(
          "runtime_coordinator.agent_profile_work_recovery_inbox.context_unavailable"
        );
      }
      const profile = profileScopeResult.scope;
      const interruptedClientMessageId =
        interruptedHead.targetWakeLifecycleIdentity.clientMessageId;
      for (const supersededStage of intent.supersededStages) {
        // The decision the owner was asked to make has moved to another stage.
        // Closing the stage it left has to happen here, because only one intent
        // exists per profile and the source key digests the stage.
        await resolveAgentProfileWorkRecoveryInboxItem({
          db: targetInboxDb,
          interruptedClientMessageId,
          organizationId: profile.organizationId,
          profileId: intent.targetProfileId,
          resolvedAtMs: intent.updatedAtMs,
          stage: supersededStage,
        });
      }
      if (intent.desiredStatus === "open") {
        await projectAgentProfileWorkRecoveryInboxItem({
          db: targetInboxDb,
          interruptedClientMessageId,
          nowMs: intent.updatedAtMs,
          occurredAtMs: intent.occurredAtMs,
          organizationId: profile.organizationId,
          ownerUserId: profile.ownerUserId,
          profileId: intent.targetProfileId,
          profileName: profile.profileName,
          sourceTarget:
            intent.stage === "review_interrupted_work" ||
            intent.stage === "resolve_occupied_conversation"
              ? {
                  kind: "space",
                  signalId:
                    interruptedHead.targetWakeLifecycleIdentity.sourceSignalId,
                  spaceId: interruptedHead.targetWakeLifecycleIdentity.spaceId,
                }
              : {
                  kind: "agent_profile",
                  profileId: intent.targetProfileId,
                },
          stage: intent.stage,
        });
      } else {
        await resolveAgentProfileWorkRecoveryInboxItem({
          db: targetInboxDb,
          interruptedClientMessageId,
          organizationId: profile.organizationId,
          profileId: intent.targetProfileId,
          resolvedAtMs: intent.updatedAtMs,
          stage: intent.stage,
        });
      }
      const completed =
        await completeRuntimeCoordinatorAgentProfileWorkRecoveryInboxProjection(
          {
            intent,
            nowMs: intent.updatedAtMs,
            record: interruptedHead,
            storage: this.ctx.storage,
          }
        );
      if (!completed) {
        throw new Error(
          "runtime_coordinator.agent_profile_work_recovery_inbox_projection_state_changed"
        );
      }
    } catch (error) {
      const failureOutcome =
        await recordAgentProfileWorkRecoveryInboxProjectionFailure({
          intent,
          nowMs: Date.now(),
          storage: this.ctx.storage,
        });
      console.warn(
        failureOutcome === "parked"
          ? "[core.runtime_transport.agent_profile_work_recovery_inbox_projection_parked]"
          : "[core.runtime_transport.agent_profile_work_recovery_inbox_projection_deferred]",
        {
          error: error instanceof Error ? error.message : String(error),
          failureCount: intent.failureCount + 1,
          failureOutcome,
          targetProfileId: intent.targetProfileId,
        }
      );
    }
  }
  private async readRuntimeCoordinatorRunCommandState(
    runtimeCoordinatorExecutionId: string
  ): Promise<RuntimeCoordinatorRunCommandState | null> {
    return await readRuntimeCoordinatorRunCommandStateFromStorage(
      this.ctx.storage,
      runtimeCoordinatorExecutionId
    );
  }
  private async writeRuntimeCoordinatorRunCommandState(
    state: RuntimeCoordinatorRunCommandState
  ): Promise<void> {
    await writeRuntimeCoordinatorRunCommandStateToStorage(
      this.ctx.storage,
      state
    );
    this.publishWakeProgressChanged({
      agentProfileId: state.targetProfileId,
      clientMessageId: state.sourceClientMessageId,
      spaceId: state.sanitizedDeliveryRequest.payload.spaceId,
    });
  }
  private async rollbackRuntimeCoordinatorUnsentDelivery(
    request: RuntimeTransportDeliverDispatchRequest
  ): Promise<void> {
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: request.payload.sourceClientMessageId ?? null,
      dispatchId: request.dispatchId,
      sourceSignalId: request.payload.sourceEventId,
      spaceId: request.payload.spaceId,
      targetProfileId: request.payload.targetProfileId,
    });
    const rollback =
      await rollbackRuntimeCoordinatorUnsentDeliveryWithAdmission({
        attemptId: request.attemptId,
        dispatchId: request.dispatchId,
        nowMs: Date.now(),
        runtimeCoordinatorExecutionId:
          request.payload.runtimeCoordinatorExecutionId,
        storage: this.ctx.storage,
        targetProfileId: request.payload.targetProfileId,
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
      });
    if (rollback === "rolled_back") {
      this.publishAgentReadinessInvalidated({
        profileIds: [request.payload.targetProfileId],
        reason: "agent_profile_work_coordinator.changed",
      });
    }
  }
  private async handleRuntimeCoordinatorHeadAcceptRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      const response: RuntimeTransportRuntimeCoordinatorHeadAcceptResponse = {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.head_accept_request_invalid",
        status: "retry_later",
        targetWakeLifecycleId: "unknown",
      };
      return Response.json(response, { status: 400 });
    }
    const response = await this.acceptRuntimeCoordinatorHeadLifecycle(
      parsed.data
    ).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_accept_failed]",
        {
          dispatchId: parsed.data.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          targetProfileId:
            parsed.data.targetWakeLifecycleIdentity.targetProfileId,
        }
      );
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.head_accept_unavailable",
        status: "retry_later",
        targetWakeLifecycleId:
          parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      } satisfies RuntimeTransportRuntimeCoordinatorHeadAcceptResponse;
    });
    const validated =
      runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        {
          ok: false,
          primaryDispatchId: null,
          reasonCode: "runtime_coordinator.head_accept_response_invalid",
          status: "retry_later",
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        } satisfies RuntimeTransportRuntimeCoordinatorHeadAcceptResponse,
        { status: 500 }
      );
    }
    let statusCode = 503;
    if (validated.data.ok) {
      statusCode = 200;
      await this.syncHousekeepingAlarm();
    } else if (validated.data.status === "conflict") {
      statusCode = 409;
    }
    return Response.json(validated.data, { status: statusCode });
  }
  private async handleRuntimeCoordinatorHeadNoExecutionRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      const response: RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse =
        {
          ok: false,
          primaryDispatchId: null,
          publicationIntentId: null,
          reasonCode: "runtime_coordinator.head_no_execution_request_invalid",
          runtimeCoordinatorExecutionId: null,
          status: "retry_later",
          targetWakeLifecycleId: "unknown",
        };
      return Response.json(response, { status: 400 });
    }
    const response = await this.recordRuntimeCoordinatorHeadNoExecution(
      parsed.data
    ).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_no_execution_failed]",
        {
          dispatchId: parsed.data.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode: parsed.data.reasonCode,
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          targetProfileId:
            parsed.data.targetWakeLifecycleIdentity.targetProfileId,
        }
      );
      return {
        ok: false,
        primaryDispatchId: null,
        publicationIntentId: null,
        reasonCode: "runtime_coordinator.head_no_execution_unavailable",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId:
          parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      } satisfies RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse;
    });
    const validated =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        {
          ok: false,
          primaryDispatchId: null,
          publicationIntentId: null,
          reasonCode: "runtime_coordinator.head_no_execution_response_invalid",
          runtimeCoordinatorExecutionId: null,
          status: "retry_later",
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        } satisfies RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse,
        { status: 500 }
      );
    }
    let statusCode = 503;
    if (validated.data.ok) {
      statusCode = 200;
    } else if (validated.data.status === "conflict") {
      statusCode = 409;
    }
    return Response.json(validated.data, { status: statusCode });
  }
  private async handleRuntimeCoordinatorHeadPreAgentStopRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      const response: RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse =
        {
          ok: false,
          primaryDispatchId: null,
          publicationIntentId: null,
          reasonCode: "runtime_coordinator.pre_agent_stop_request_invalid",
          runtimeCoordinatorExecutionId: null,
          status: "retry_later",
          targetWakeLifecycleId: "unknown",
        };
      return Response.json(response, { status: 400 });
    }
    const response = await this.recordRuntimeCoordinatorHeadPreAgentStop(
      parsed.data
    ).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_pre_agent_stop_failed]",
        {
          dispatchId: parsed.data.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          targetProfileId:
            parsed.data.targetWakeLifecycleIdentity.targetProfileId,
        }
      );
      return {
        ok: false,
        primaryDispatchId: null,
        publicationIntentId: null,
        reasonCode: "runtime_coordinator.pre_agent_stop_unavailable",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId:
          parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      } satisfies RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse;
    });
    const validated =
      runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        {
          ok: false,
          primaryDispatchId: null,
          publicationIntentId: null,
          reasonCode: "runtime_coordinator.pre_agent_stop_response_invalid",
          runtimeCoordinatorExecutionId: null,
          status: "retry_later",
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        } satisfies RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse,
        { status: 500 }
      );
    }
    let statusCode = 503;
    if (validated.data.ok) {
      statusCode = 200;
    } else if (
      validated.data.status === "conflict" ||
      validated.data.status === "execution_linked"
    ) {
      statusCode = 409;
    }
    return Response.json(validated.data, { status: statusCode });
  }
  private async handleRuntimeCoordinatorHeadWaitingRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      const response: RuntimeTransportRuntimeCoordinatorHeadWaitingResponse = {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.head_waiting_request_invalid",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId: "unknown",
      };
      return Response.json(response, { status: 400 });
    }
    const response = await this.recordRuntimeCoordinatorHeadWaiting(
      parsed.data
    ).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_waiting_failed]",
        {
          dispatchId: parsed.data.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode: parsed.data.reasonCode,
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          targetProfileId:
            parsed.data.targetWakeLifecycleIdentity.targetProfileId,
        }
      );
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.head_waiting_unavailable",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId:
          parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      } satisfies RuntimeTransportRuntimeCoordinatorHeadWaitingResponse;
    });
    const validated =
      runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        {
          ok: false,
          primaryDispatchId: null,
          reasonCode: "runtime_coordinator.head_waiting_response_invalid",
          runtimeCoordinatorExecutionId: null,
          status: "retry_later",
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        } satisfies RuntimeTransportRuntimeCoordinatorHeadWaitingResponse,
        { status: 500 }
      );
    }
    let statusCode = 503;
    if (validated.data.ok) {
      statusCode = 200;
    } else if (validated.data.status === "conflict") {
      statusCode = 409;
    }
    return Response.json(validated.data, { status: statusCode });
  }
  private async handleRuntimeCoordinatorHeadLifecycleTraceRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      const response: RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse =
        {
          ok: false,
          readStatus: "authority_unavailable",
          reasonCode:
            "runtime_coordinator.head_lifecycle_trace_request_invalid",
          targetWakeLifecycleId: "unknown",
        };
      return Response.json(response, { status: 400 });
    }
    let response = await this.readRuntimeCoordinatorHeadLifecycleTrace(
      parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId
    ).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_lifecycle_trace_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
          targetProfileId:
            parsed.data.targetWakeLifecycleIdentity.targetProfileId,
        }
      );
      return {
        ok: false,
        readStatus: "authority_unavailable",
        reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
        targetWakeLifecycleId:
          parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      } satisfies RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse;
    });
    // Old callers retain their exact response shape. Old shards ignore this
    // opt-in query and return the existing trace, without the new projection.
    if (new URL(request.url).searchParams.get("executionContext") === "1") {
      const identity = parsed.data.targetWakeLifecycleIdentity;
      const executionContext = await readWakeExecutionContextDiagnostics({
        storage: this.ctx.storage,
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
        spaceId: identity.spaceId,
        targetProfileId: identity.targetProfileId,
      }).catch((error) => ({
        readStatus: "authority_unavailable" as const,
        reasonCode:
          error instanceof ExecutionContextSelectionError
            ? error.reasonCode
            : "execution_context.diagnostics_unavailable",
      }));
      response = { ...response, executionContext };
    }
    const validated =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        {
          ok: false,
          readStatus: "authority_unavailable",
          reasonCode: "runtime_coordinator.head_lifecycle_trace_invalid",
          targetWakeLifecycleId:
            parsed.data.targetWakeLifecycleIdentity.targetWakeLifecycleId,
        } satisfies RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse,
        { status: 500 }
      );
    }
    return Response.json(validated.data, {
      status: validated.data.ok ? 200 : 503,
    });
  }
  private async acceptRuntimeCoordinatorHeadLifecycle(
    request: RuntimeTransportRuntimeCoordinatorHeadAcceptRequest
  ): Promise<RuntimeTransportRuntimeCoordinatorHeadAcceptResponse> {
    // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT wake-execution-head
    // RuntimeCoordinator owns the in-flight Wake execution decision before the
    // local service executes anything.
    const nowMs = Date.now();
    const identity = request.targetWakeLifecycleIdentity;
    const nextRecord: RuntimeCoordinatorHeadLifecycleRecord = {
      ...(request.acceptedDispatchSnapshot
        ? { acceptedDispatchSnapshot: request.acceptedDispatchSnapshot }
        : {}),
      acceptedAtMs: nowMs,
      createdAtMs: nowMs,
      duplicateDispatches: [],
      executionLinkedAtMs: null,
      modelVersion: RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
      ownerUserId: request.ownerUserId,
      primaryDispatchId: request.dispatchId,
      primaryIdempotencyKey: request.idempotencyKey,
      runtimeCoordinatorExecutionId: null,
      status: "accepted",
      targetWakeLifecycleIdentity: identity,
      targetWakeLifecycleId: identity.targetWakeLifecycleId,
      targetDisplay: resolveRuntimeCoordinatorHeadTargetDisplay(request),
      updatedAtMs: nowMs,
    };
    let admission = await writeRuntimeCoordinatorHeadLifecycleWithAdmission({
      resolveContextMigrationCapability: (record) =>
        this.resolveContextMigrationCapability({
          allowPendingRoute: true,
          ownerUserId: record.ownerUserId,
          targetProfileId: record.targetWakeLifecycleIdentity.targetProfileId,
          agentControllerRef:
            record.acceptedDispatchSnapshot?.controllerSnapshot
              .agentControllerRef ?? "",
          requiredContextVersion: requiredExecutionContextVersion(record),
          requirePermissionInheritance:
            record.acceptedDispatchSnapshot?.executionContext
              ?.permissionSource === "agent_settings",
        }),
      blockForExecutionTargetMutation: true,
      nowMs,
      record: nextRecord,
      storage: this.ctx.storage,
    });
    let migrationActivated = false;
    if (
      admission.status === "queued" &&
      (await this.attemptAgentProfileContextMigration({
        ownerUserId: request.ownerUserId,
        targetProfileId: identity.targetProfileId,
      }))
    ) {
      migrationActivated = true;
      admission = await writeRuntimeCoordinatorHeadLifecycleWithAdmission({
        blockForExecutionTargetMutation: true,
        nowMs: Date.now(),
        record: nextRecord,
        storage: this.ctx.storage,
      });
    }
    if (
      admission.status === "existing" &&
      admission.compatibilityDiagnosticReasonCode
    ) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_legacy_terminal_replay_deduped]",
        {
          dispatchId: request.dispatchId,
          reasonCode: admission.compatibilityDiagnosticReasonCode,
          runtimeCoordinatorExecutionId:
            admission.effectiveRecord.runtimeCoordinatorExecutionId,
          targetProfileId: identity.targetProfileId,
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
        }
      );
    }
    if (
      admission.status === "queued" ||
      admission.status === "started" ||
      admission.status === "continuation_needs_attention"
    ) {
      this.publishAgentReadinessInvalidated({
        profileIds: [identity.targetProfileId],
        reason: "agent_profile_work_coordinator.changed",
      });
    }
    // Retiring work this Profile could never run again can free the slot a
    // waiting Wake was queued behind. That promotion takes the same exact
    // redrive as a terminal transition instead of waiting for the alarm.
    if (admission.pendingPromotion) {
      await this.requestSpaceDispatchOutboxRedriveForPromotion(
        admission.pendingPromotion,
        "admission_reconciliation"
      );
    }
    if (admission.status === "continuation_needs_attention") {
      this.scheduledHousekeepingAlarmAtMs = nowMs;
    }
    if (request.acceptedDispatchSnapshot?.deviceWait) {
      this.queueHousekeepingAlarmSync();
    }
    let response = resolveRuntimeCoordinatorHeadAdmissionResponse({
      admission,
      request,
    });
    if (
      migrationActivated &&
      response.ok &&
      response.status === "already_accepted"
    ) {
      response = { ...response, status: "accepted" };
    }
    if (
      response.ok &&
      response.status !== "queued" &&
      response.acceptedDispatchSnapshot?.executionContext
    ) {
      return {
        ...response,
        executionContext: await resolveExecutionContextTask(
          this.ctx.storage,
          response.acceptedDispatchSnapshot.executionContext,
          {
            resolvesWorkspaceDefault:
              this.resolveContextMigrationCapability({
                ownerUserId: request.ownerUserId,
                targetProfileId: identity.targetProfileId,
                agentControllerRef:
                  response.acceptedDispatchSnapshot.controllerSnapshot
                    .agentControllerRef,
                requiredContextVersion: 7,
              }) === null,
          }
        ),
      };
    }
    return response;
  }
  private async recordRuntimeCoordinatorHeadNoExecution(
    request: RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest
  ): Promise<RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse> {
    const nowMs = Date.now();
    const identity = request.targetWakeLifecycleIdentity;
    const existing = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      identity.targetWakeLifecycleId
    );
    const publicationIntentId = buildRuntimeCoordinatorHeadPublicationIntentId(
      identity.targetWakeLifecycleId
    );
    if (!existing) {
      const terminalAuthority =
        await this.readMatchingRuntimeCoordinatorTerminalAuthorityForHead(
          request
        );
      const terminalReasonCode =
        terminalAuthority?.terminalOutcome?.reasonCode ?? null;
      if (terminalAuthority && terminalReasonCode) {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_retired_terminal_head_redrive_observed]",
          {
            dispatchId: request.dispatchId,
            preservedReasonCode: terminalReasonCode,
            redriveReasonCode: request.reasonCode,
            runtimeCoordinatorExecutionId:
              terminalAuthority.runtimeCoordinatorExecutionId,
            targetProfileId: identity.targetProfileId,
            targetWakeLifecycleId: identity.targetWakeLifecycleId,
          }
        );
        return {
          ok: true,
          primaryDispatchId: request.dispatchId,
          publicationIntentId,
          reasonCode:
            RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE,
          runtimeCoordinatorExecutionId: null,
          status: "already_recorded",
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
        };
      }
      return {
        ok: false,
        primaryDispatchId: null,
        publicationIntentId,
        reasonCode: "runtime_coordinator.head_no_execution_missing_head",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (!isSameRuntimeCoordinatorHeadAuthority(existing, request)) {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId,
        reasonCode: "runtime_coordinator.head_no_execution_authority_conflict",
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.primaryDispatchId !== request.dispatchId) {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId,
        reasonCode: "runtime_coordinator.head_no_execution_duplicate_dispatch",
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "execution_linked") {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId,
        reasonCode: "runtime_coordinator.head_execution_already_linked",
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "stopped_before_execution") {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId:
          existing.publicationIntent?.intentId ?? publicationIntentId,
        reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "publication_intent_ready") {
      await this.publishRuntimeCoordinatorHeadFailureNotice(existing);
      return {
        ok: true,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId:
          existing.publicationIntent?.intentId ?? publicationIntentId,
        reasonCode:
          existing.noExecutionDecision?.reasonCode ?? request.reasonCode,
        runtimeCoordinatorExecutionId: null,
        status: "already_recorded",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    const nextRecord: RuntimeCoordinatorHeadLifecycleRecord = {
      ...existing,
      noExecutionDecision: {
        decidedAtMs: nowMs,
        publicationCategory: request.publicationCategory,
        reasonCode: request.reasonCode,
        source: request.decisionSource ?? "dispatch_preflight",
        userRecoveryAction: request.userRecoveryAction,
      },
      publicationIntent: {
        intentId: publicationIntentId,
        kind: "no_execution_failure",
        publicationCategory: request.publicationCategory,
        readyAtMs: nowMs,
        reasonCode: request.reasonCode,
        status: "ready_for_phase_6",
        userRecoveryAction: request.userRecoveryAction,
      },
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
      updatedAtMs: nowMs,
      waitingBoundary: undefined,
    };
    const stored =
      await this.writeRuntimeCoordinatorHeadLifecycleRecord(nextRecord);
    if (stored.status !== "publication_intent_ready") {
      return {
        ok: false,
        status: "conflict",
        primaryDispatchId: stored.primaryDispatchId,
        publicationIntentId: stored.publicationIntent?.intentId ?? null,
        runtimeCoordinatorExecutionId: null,
        reasonCode: "runtime_coordinator.head_terminal_transition_won",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    await this.publishRuntimeCoordinatorHeadFailureNotice(stored);
    return {
      ok: true,
      primaryDispatchId: existing.primaryDispatchId,
      publicationIntentId,
      reasonCode: stored.noExecutionDecision?.reasonCode ?? request.reasonCode,
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
      targetWakeLifecycleId: identity.targetWakeLifecycleId,
    };
  }
  private async recordRuntimeCoordinatorHeadPreAgentStop(
    request: RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest
  ): Promise<RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse> {
    const nowMs = Date.now();
    const identity = request.targetWakeLifecycleIdentity;
    const existing = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      identity.targetWakeLifecycleId
    );
    const publicationIntentId =
      buildRuntimeCoordinatorHeadStoppedPublicationIntentId(
        identity.targetWakeLifecycleId
      );
    if (!existing) {
      const nextRecord: RuntimeCoordinatorHeadLifecycleRecord = {
        createdAtMs: nowMs,
        duplicateDispatches: [],
        executionLinkedAtMs: null,
        modelVersion: RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
        ownerUserId: request.ownerUserId,
        primaryDispatchId: request.dispatchId,
        primaryIdempotencyKey: request.idempotencyKey,
        publicationIntent: {
          intentId: publicationIntentId,
          kind: "stopped_notice",
          readyAtMs: nowMs,
          reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
          status: "ready_for_phase_6",
        },
        runtimeCoordinatorExecutionId: null,
        status: "stopped_before_execution",
        stopReason: request.reason ?? null,
        targetWakeLifecycleIdentity: identity,
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
        targetDisplay: resolveRuntimeCoordinatorHeadTargetDisplay(request),
        updatedAtMs: nowMs,
      };
      return await this.commitRuntimeCoordinatorHeadStop({
        record: nextRecord,
        nowMs,
      });
    }
    if (!isSameRuntimeCoordinatorHeadAuthority(existing, request)) {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId: existing.publicationIntent?.intentId ?? null,
        reasonCode: "runtime_coordinator.pre_agent_stop_authority_conflict",
        runtimeCoordinatorExecutionId:
          existing.runtimeCoordinatorExecutionId ?? null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (
      existing.status === "execution_linked" ||
      existing.runtimeCoordinatorExecutionId
    ) {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId: existing.publicationIntent?.intentId ?? null,
        reasonCode: "runtime_coordinator.head_execution_already_linked",
        runtimeCoordinatorExecutionId:
          existing.runtimeCoordinatorExecutionId ?? null,
        status: "execution_linked",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "stopped_before_execution") {
      const stoppedRecord = await this.retainRuntimeCoordinatorHeadStopReason({
        nowMs,
        reason: request.reason ?? null,
        record: existing,
      });
      await this.publishRuntimeCoordinatorHeadPreAgentStoppedOutcome({
        nowMs,
        record: stoppedRecord,
      });
      return {
        ok: true,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId:
          existing.publicationIntent?.intentId ?? publicationIntentId,
        reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        runtimeCoordinatorExecutionId: null,
        status: "already_stopped",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "publication_intent_ready") {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId: existing.publicationIntent?.intentId ?? null,
        reasonCode:
          "runtime_coordinator.pre_agent_stop_after_publication_intent",
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    const duplicateReasonCode =
      existing.primaryDispatchId === request.dispatchId
        ? null
        : "runtime_coordinator.pre_agent_stop_duplicate_dispatch";
    const baseRecord =
      duplicateReasonCode === null
        ? existing
        : appendRuntimeCoordinatorHeadDuplicateObservation({
            nowMs,
            record: existing,
            request,
            reasonCode: duplicateReasonCode,
          });
    const nextRecord: RuntimeCoordinatorHeadLifecycleRecord = {
      ...baseRecord,
      noExecutionDecision: undefined,
      publicationIntent: {
        intentId: publicationIntentId,
        kind: "stopped_notice",
        readyAtMs: nowMs,
        reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        status: "ready_for_phase_6",
      },
      publicationRetry: undefined,
      runtimeCoordinatorExecutionId: null,
      status: "stopped_before_execution",
      stopReason: request.reason ?? null,
      targetDisplay:
        baseRecord.targetDisplay ??
        resolveRuntimeCoordinatorHeadTargetDisplay(request),
      updatedAtMs: nowMs,
      waitingBoundary: undefined,
    };
    return await this.commitRuntimeCoordinatorHeadStop({
      record: nextRecord,
      nowMs,
    });
  }
  private async commitRuntimeCoordinatorHeadStop(input: {
    record: RuntimeCoordinatorHeadLifecycleRecord;
    nowMs: number;
  }): Promise<RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse> {
    const nextRecord = input.record;
    const nowMs = input.nowMs;
    const identity = nextRecord.targetWakeLifecycleIdentity;
    const publicationIntentId =
      buildRuntimeCoordinatorHeadStoppedPublicationIntentId(
        identity.targetWakeLifecycleId
      );
    const stored =
      await this.writeRuntimeCoordinatorHeadLifecycleRecord(nextRecord);
    if (stored.status !== "stopped_before_execution") {
      return {
        ok: false,
        status: stored.runtimeCoordinatorExecutionId
          ? "execution_linked"
          : "conflict",
        primaryDispatchId: stored.primaryDispatchId,
        publicationIntentId: stored.publicationIntent?.intentId ?? null,
        runtimeCoordinatorExecutionId: stored.runtimeCoordinatorExecutionId,
        reasonCode: "runtime_coordinator.head_terminal_transition_won",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    await this.publishRuntimeCoordinatorHeadPreAgentStoppedOutcome({
      nowMs,
      record: stored,
    });
    return {
      ok: true,
      primaryDispatchId: stored.primaryDispatchId,
      publicationIntentId,
      reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
      runtimeCoordinatorExecutionId: null,
      status: "stopped_before_execution",
      targetWakeLifecycleId: identity.targetWakeLifecycleId,
    };
  }
  private async retainRuntimeCoordinatorHeadStopReason(input: {
    nowMs: number;
    reason: string | null;
    record: RuntimeCoordinatorHeadLifecycleRecord;
  }): Promise<RuntimeCoordinatorHeadLifecycleRecord> {
    if (input.record.stopReason || !input.reason) {
      return input.record;
    }
    const record = {
      ...input.record,
      stopReason: input.reason,
      updatedAtMs: input.nowMs,
    };
    await this.writeRuntimeCoordinatorHeadLifecycleRecord(record);
    return record;
  }
  private async resolveRuntimeCoordinatorHeadWaitingTiming(
    existing: RuntimeCoordinatorHeadLifecycleRecord
  ) {
    const pendingPromotion =
      existing.acceptedAtMs === undefined && existing.status === "waiting"
        ? await readPendingAgentProfileWorkPromotion(
            this.ctx.storage,
            existing.targetWakeLifecycleIdentity.targetProfileId
          )
        : null;
    const existingWithAcceptanceTiming =
      normalizeLegacyRuntimeCoordinatorHeadAcceptanceTiming(
        existing,
        pendingPromotion?.dispatchId === existing.primaryDispatchId &&
          pendingPromotion.targetWakeLifecycleId ===
            existing.targetWakeLifecycleId
          ? { acceptedAtMs: pendingPromotion.createdAtMs }
          : undefined
      );
    const existingBoundary = existingWithAcceptanceTiming.waitingBoundary;
    const waitingSinceMs =
      existingBoundary?.waitingSinceMs ??
      existingWithAcceptanceTiming.acceptedAtMs ??
      existingWithAcceptanceTiming.createdAtMs;
    const softDeadlineAtMs =
      existingBoundary?.softDeadlineAtMs ??
      waitingSinceMs + RUNTIME_COORDINATOR_HEAD_WAITING_SOFT_WAIT_MS;
    const deadlineAtMs =
      existing.acceptedDispatchSnapshot?.deviceWait?.deadlineAtMs ??
      existingBoundary?.deadlineAtMs ??
      waitingSinceMs + RUNTIME_COORDINATOR_HEAD_WAITING_HARD_DEADLINE_MS;
    return {
      existingWithAcceptanceTiming,
      waitingSinceMs,
      softDeadlineAtMs,
      deadlineAtMs,
    };
  }
  private async recordRuntimeCoordinatorHeadWaiting(
    request: RuntimeTransportRuntimeCoordinatorHeadWaitingRequest
  ): Promise<RuntimeTransportRuntimeCoordinatorHeadWaitingResponse> {
    const nowMs = Date.now();
    const identity = request.targetWakeLifecycleIdentity;
    const existing = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      identity.targetWakeLifecycleId
    );
    if (!existing) {
      return {
        ok: false,
        primaryDispatchId: null,
        reasonCode: "runtime_coordinator.head_waiting_missing_head",
        runtimeCoordinatorExecutionId: null,
        status: "retry_later",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (!isSameRuntimeCoordinatorHeadAuthority(existing, request)) {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        reasonCode: "runtime_coordinator.head_waiting_authority_conflict",
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.primaryDispatchId !== request.dispatchId) {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        reasonCode: "runtime_coordinator.head_waiting_duplicate_dispatch",
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "execution_linked") {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        reasonCode: "runtime_coordinator.head_execution_already_linked",
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "stopped_before_execution") {
      return {
        ok: false,
        primaryDispatchId: existing.primaryDispatchId,
        reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        runtimeCoordinatorExecutionId: null,
        status: "conflict",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    if (existing.status === "publication_intent_ready") {
      await this.publishRuntimeCoordinatorHeadFailureNotice(existing);
      const failureIntent =
        existing.publicationIntent?.kind === "no_execution_failure"
          ? existing.publicationIntent
          : null;
      return {
        ok: true,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntentId:
          failureIntent?.intentId ??
          buildRuntimeCoordinatorHeadPublicationIntentId(
            identity.targetWakeLifecycleId
          ),
        reasonCode: failureIntent?.reasonCode ?? "daemon.profile.offline",
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    const waitingPolicy = resolveRuntimeCoordinatorHeadWaitingPolicy(
      request.reasonCode
    );
    const waitingDecision = resolveRuntimeCoordinatorHeadWaitingDecision(
      request.reasonCode
    );
    const {
      existingWithAcceptanceTiming,
      waitingSinceMs,
      softDeadlineAtMs,
      deadlineAtMs,
    } = await this.resolveRuntimeCoordinatorHeadWaitingTiming(existing);
    if (deadlineAtMs <= nowMs) {
      const nextRecord =
        buildRuntimeCoordinatorHeadPublicationIntentReadyRecord({
          decisionSource: "runtime_coordinator_head_waiting_deadline",
          existing: existingWithAcceptanceTiming,
          nowMs,
          publicationCategory: waitingPolicy.waitingCategory,
          reasonCode: existing.acceptedDispatchSnapshot?.deviceWait
            ? "wake.device_wait.expired"
            : request.reasonCode,
          userRecoveryAction: waitingPolicy.userRecoveryAction,
        });
      const stored =
        await this.writeRuntimeCoordinatorHeadLifecycleRecord(nextRecord);
      if (stored.status !== "publication_intent_ready") {
        return {
          ok: false,
          status: "conflict",
          primaryDispatchId: stored.primaryDispatchId,
          runtimeCoordinatorExecutionId: null,
          reasonCode: "runtime_coordinator.head_terminal_transition_won",
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
        };
      }
      await this.publishRuntimeCoordinatorHeadFailureNotice(stored);
      return {
        ok: true,
        primaryDispatchId: nextRecord.primaryDispatchId,
        publicationIntentId:
          nextRecord.publicationIntent?.intentId ??
          buildRuntimeCoordinatorHeadPublicationIntentId(
            identity.targetWakeLifecycleId
          ),
        reasonCode:
          stored.noExecutionDecision?.reasonCode ?? request.reasonCode,
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    const waitingBoundary: RuntimeCoordinatorHeadWaitingBoundary = {
      deadlineAtMs,
      deadlineOutcome: "publication_intent_ready",
      observedAtMs: request.observedAtMs,
      softDeadlineAtMs,
      triggerOwner: "runtime_coordinator",
      waitingSinceMs,
      ...waitingPolicy,
    };
    const stored = await this.writeRuntimeCoordinatorHeadLifecycleRecord({
      ...existingWithAcceptanceTiming,
      runtimeCoordinatorExecutionId: null,
      status: "waiting",
      updatedAtMs: nowMs,
      waitingBoundary,
    });
    if (stored.status !== "waiting") {
      return {
        ok: false,
        status: "conflict",
        primaryDispatchId: stored.primaryDispatchId,
        runtimeCoordinatorExecutionId: null,
        reasonCode: "runtime_coordinator.head_terminal_transition_won",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
      };
    }
    await this.syncHousekeepingAlarm();
    return {
      deadlineAtMs,
      nextTriggerAtMs:
        softDeadlineAtMs > nowMs ? softDeadlineAtMs : deadlineAtMs,
      ok: true,
      primaryDispatchId: existing.primaryDispatchId,
      runtimeCoordinatorExecutionId: null,
      softDeadlineAtMs,
      status: "waiting",
      targetWakeLifecycleId: identity.targetWakeLifecycleId,
      ...waitingDecision,
    };
  }
  private async publishRuntimeCoordinatorHeadFailureNotice(
    record: RuntimeCoordinatorHeadLifecycleRecord
  ): Promise<RuntimeCoordinatorHeadLifecycleRecord> {
    if (
      record.status !== "publication_intent_ready" ||
      !record.publicationIntent ||
      !record.noExecutionDecision
    ) {
      return record;
    }
    if (
      record.publicationOutcome?.status === "failure_published" ||
      record.publicationOutcome?.status === "already_final" ||
      record.publicationExhaustion?.status === "publication_exhausted"
    ) {
      return record;
    }
    const nowMs = Date.now();
    const command = buildRuntimeCoordinatorHeadFailurePublicationCommand({
      nowMs,
      record,
    });
    const outcome =
      await this.applyRuntimeCoordinatorFailurePublicationCommand(command);
    const publicationOutcome =
      toRuntimeCoordinatorHeadPublicationOutcomeFromFailurePublication({
        nowMs,
        outcome,
      });
    const nextRecordBase: RuntimeCoordinatorHeadLifecycleRecord = {
      ...record,
      publicationOutcome,
      updatedAtMs: nowMs,
    };
    const nextRecord: RuntimeCoordinatorHeadLifecycleRecord =
      outcome.status === "failure_publication_failed"
        ? await this.buildRuntimeCoordinatorHeadPublicationFailureRecord({
            nextRecordBase,
            nowMs,
            outcome,
            previousRetry: record.publicationRetry,
          })
        : omitRuntimeCoordinatorHeadPublicationRetry(nextRecordBase);
    await this.writeRuntimeCoordinatorHeadLifecycleRecord(nextRecord);
    await this.recordRuntimeCoordinatorHeadFailureReadinessImpact({
      nowMs,
      record: nextRecord,
    });
    if (nextRecord.publicationRetry) {
      this.queueHousekeepingAlarmSync();
    }
    return nextRecord;
  }
  private async recordRuntimeCoordinatorHeadFailureReadinessImpact(input: {
    nowMs: number;
    record: RuntimeCoordinatorHeadLifecycleRecord;
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    const readinessImpactDb = getPostgresDatabase(this.env);
    if (!(db && readinessImpactDb && input.record.noExecutionDecision)) {
      return;
    }
    if (
      input.record.noExecutionDecision.reasonCode !==
      RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE
    ) {
      return;
    }
    const identity =
      await this.readRuntimeCoordinatorHeadFailureExecutionIdentity({
        db,
        dispatchId: input.record.primaryDispatchId,
      });
    if (!identity) {
      return;
    }
    try {
      const result = await writeAgentExecutionReadinessImpact({
        agentProfileId:
          input.record.targetWakeLifecycleIdentity.targetProfileId,
        // readiness impacts live in openmeld-local-state, not wake-evidence
        db: readinessImpactDb,
        executionIdentity: {
          bindingId: identity.bindingId,
          agentControllerRef: identity.agentControllerRef,
          openMeldServiceRuntimeId: identity.openMeldServiceRuntimeId,
        },
        observedAtMs: input.nowMs,
        reasonCode: RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE,
        sourceAttemptId: identity.attemptId,
        sourceDispatchId: input.record.primaryDispatchId,
      });
      if (result === "written") {
        console.info(
          "[core.runtime_transport.runtime_coordinator_head_failure_readiness_impact_written]",
          {
            agentProfileId:
              input.record.targetWakeLifecycleIdentity.targetProfileId,
            attemptId: identity.attemptId,
            dispatchId: input.record.primaryDispatchId,
            reasonCode: RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE,
            targetWakeLifecycleId: input.record.targetWakeLifecycleId,
          }
        );
      }
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_failure_readiness_impact_failed]",
        {
          agentProfileId:
            input.record.targetWakeLifecycleIdentity.targetProfileId,
          dispatchId: input.record.primaryDispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode: RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE,
          targetWakeLifecycleId: input.record.targetWakeLifecycleId,
        }
      );
    }
  }
  private async readRuntimeCoordinatorHeadFailureExecutionIdentity(input: {
    db: PostgresDatabase;
    dispatchId: string;
  }): Promise<{
    attemptId: string;
    bindingId: string;
    agentControllerRef: string;
    openMeldServiceRuntimeId: string;
  } | null> {
    let row: {
      latestAttemptId?: unknown;
    } | null = null;
    try {
      row = await input.db
        .query<{
          latestAttemptId?: unknown;
        }>({
          text: `
            SELECT latest_attempt_id AS "latestAttemptId"
            FROM "openmeld"."openMeldDaemon_dispatch_ledger"
            WHERE dispatch_id = $1
            LIMIT 1
          `,
          values: [input.dispatchId],
        })
        .then((result) => result.rows[0] ?? null);
    } catch {
      row = null;
    }
    const latestAttemptId = normalizeOptionalText(row?.latestAttemptId);
    if (!latestAttemptId) {
      return null;
    }
    const ownership = await readDispatchAttemptExecutionOwnershipFact({
      attemptId: latestAttemptId,
      db: input.db,
      dispatchId: input.dispatchId,
    }).catch(() => null);
    if (ownership?.status !== "found") {
      return null;
    }
    return {
      attemptId: ownership.attemptId,
      bindingId: ownership.bindingId,
      agentControllerRef: ownership.agentControllerRef,
      openMeldServiceRuntimeId: ownership.openMeldServiceRuntimeId,
    };
  }
  private async buildRuntimeCoordinatorHeadPublicationFailureRecord(input: {
    nextRecordBase: RuntimeCoordinatorHeadLifecycleRecord;
    nowMs: number;
    outcome: Extract<
      RuntimeCoordinatorFailurePublicationOutcome,
      {
        status: "failure_publication_failed";
      }
    >;
    previousRetry?: RuntimeCoordinatorHeadPublicationRetryState;
  }): Promise<RuntimeCoordinatorHeadLifecycleRecord> {
    const publicationRetry = buildRuntimeCoordinatorHeadPublicationRetry({
      nowMs: input.nowMs,
      outcome: input.outcome,
      previousRetry: input.previousRetry,
    });
    if (!isRuntimeCoordinatorPublicationRetryExhausted(publicationRetry)) {
      return {
        ...input.nextRecordBase,
        publicationRetry,
      };
    }
    const publicationExhaustion =
      buildRuntimeCoordinatorHeadPublicationExhaustion(publicationRetry);
    await this.writeRuntimeCoordinatorPublicationBlocker({
      blockerId: `head-failure:${input.nextRecordBase.targetWakeLifecycleId}`,
      blockerKind: "publication_unavailable",
      db: getPostgresDatabase(this.env),
      dispatchId: input.nextRecordBase.primaryDispatchId,
      nowMs: input.nowMs,
      publicationKind: "failure_notice",
      reasonCode: RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE,
      runtimeCoordinatorExecutionId:
        input.nextRecordBase.runtimeCoordinatorExecutionId,
      spaceId: input.nextRecordBase.targetWakeLifecycleIdentity.spaceId,
      targetProfileId:
        input.nextRecordBase.targetWakeLifecycleIdentity.targetProfileId,
      targetWakeLifecycleId: input.nextRecordBase.targetWakeLifecycleId,
    });
    return omitRuntimeCoordinatorHeadPublicationRetry({
      ...input.nextRecordBase,
      publicationExhaustion,
    });
  }
  private async applyRuntimeCoordinatorFailurePublicationCommand(
    command: RuntimeCoordinatorFailurePublicationCommand
  ): Promise<RuntimeCoordinatorFailurePublicationOutcome> {
    const spaceStub = resolveSpaceStub(
      this.env.OPENMELD_SPACES,
      command.spaceId
    );
    if (!spaceStub) {
      return buildRuntimeCoordinatorFailurePublicationFailureOutcome({
        command,
        reasonCode: "runtime_coordinator.failure_publication_space_unavailable",
      });
    }
    try {
      const rawOutcome =
        await spaceStub.rpcApplyRuntimeCoordinatorFailurePublicationCommand(
          command
        );
      const parsed =
        runtimeCoordinatorFailurePublicationOutcomeSchema.safeParse(rawOutcome);
      if (parsed.success) {
        return parsed.data;
      }
      return buildRuntimeCoordinatorFailurePublicationFailureOutcome({
        command,
        reasonCode: "runtime_coordinator.failure_publication_outcome_invalid",
      });
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_failure_publication_failed]",
        {
          dispatchId: command.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          failurePublicationCommandId: command.failurePublicationCommandId,
          publicationIntentId: command.publicationIntentId,
          targetWakeLifecycleId: command.targetWakeLifecycleId,
          targetProfileId: command.targetProfileId,
        }
      );
      return buildRuntimeCoordinatorFailurePublicationFailureOutcome({
        command,
        reasonCode: "runtime_coordinator.failure_publication_unavailable",
      });
    }
  }
  private async readRuntimeCoordinatorHeadLifecycleTrace(
    targetWakeLifecycleId: string
  ): Promise<RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse> {
    const existing = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      targetWakeLifecycleId
    );
    if (!existing) {
      return {
        ok: true,
        readStatus: "missing",
        reasonCode: "runtime_coordinator.head_lifecycle_not_found",
        targetWakeLifecycleId,
      };
    }
    return {
      lifecycle: {
        createdAtMs: existing.createdAtMs,
        duplicateDispatchCount: existing.duplicateDispatches.length,
        executionLinkedAtMs: existing.executionLinkedAtMs,
        modelVersion: existing.modelVersion,
        noExecutionDecision: existing.noExecutionDecision ?? null,
        ownerUserId: existing.ownerUserId,
        primaryDispatchId: existing.primaryDispatchId,
        publicationIntent: existing.publicationIntent ?? null,
        ...(existing.publicationExhaustion
          ? { publicationExhaustion: existing.publicationExhaustion }
          : {}),
        ...(existing.publicationOutcome
          ? { publicationOutcome: existing.publicationOutcome }
          : {}),
        runtimeCoordinatorExecutionId:
          existing.runtimeCoordinatorExecutionId ?? null,
        status: existing.status,
        targetWakeLifecycleIdentity: existing.targetWakeLifecycleIdentity,
        targetWakeLifecycleId: existing.targetWakeLifecycleId,
        ...(existing.targetDisplay
          ? { targetDisplay: existing.targetDisplay }
          : {}),
        updatedAtMs: existing.updatedAtMs,
        waitingBoundary:
          normalizeRuntimeCoordinatorHeadWaitingBoundary(existing) ?? null,
      },
      ok: true,
      readStatus: "found",
    };
  }
  private async readRuntimeCoordinatorHeadLifecycleRecord(
    targetWakeLifecycleId: string
  ): Promise<RuntimeCoordinatorHeadLifecycleRecord | null> {
    return await readRuntimeCoordinatorHeadLifecycleRecordFromStorage(
      this.ctx.storage,
      targetWakeLifecycleId
    );
  }
  private async writeRuntimeCoordinatorHeadLifecycleRecord(
    proposedRecord: RuntimeCoordinatorHeadLifecycleRecord
  ): Promise<RuntimeCoordinatorHeadLifecycleRecord> {
    const result = await writeRuntimeCoordinatorHeadLifecycleWithAdmission({
      blockForExecutionTargetMutation: false,
      nowMs: proposedRecord.updatedAtMs,
      record: proposedRecord,
      storage: this.ctx.storage,
    });
    if (!("effectiveRecord" in result)) {
      throw new Error(
        `RuntimeCoordinator head transition was not accepted: ${result.status}.`,
        { cause: result }
      );
    }
    const record = result.effectiveRecord;
    const pendingPromotion = result.pendingPromotion;
    this.publishAgentReadinessInvalidated({
      profileIds: [record.targetWakeLifecycleIdentity.targetProfileId],
      reason: "agent_profile_work_coordinator.changed",
    });
    this.publishWakeProgressChanged({
      agentProfileId: record.targetWakeLifecycleIdentity.targetProfileId,
      clientMessageId: record.targetWakeLifecycleIdentity.clientMessageId,
      spaceId: record.targetWakeLifecycleIdentity.spaceId,
    });
    if (pendingPromotion) {
      await this.requestSpaceDispatchOutboxRedriveForPromotion(
        pendingPromotion,
        "terminal_transaction"
      );
    }
    return record;
  }
  private async escalateRuntimeCoordinatorHeadWaitingDeadline(input: {
    nowMs: number;
    record: RuntimeCoordinatorHeadWaitingAlarmWorkItem;
  }): Promise<void> {
    // An alarm may have read this record before a cancellation or delivery won.
    const current = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      input.record.targetWakeLifecycleId
    );
    if (
      !(
        current &&
        (current.status === "waiting" ||
          isRuntimeCoordinatorHeadWaitingForDevice(current))
      )
    ) {
      return;
    }
    const deviceWait = current.acceptedDispatchSnapshot?.deviceWait;
    const waitingBoundary = current.waitingBoundary;
    const deadlineAtMs =
      deviceWait?.deadlineAtMs ?? waitingBoundary?.deadlineAtMs;
    if (deadlineAtMs === undefined || deadlineAtMs > input.nowMs) {
      return;
    }
    // Accepted/FIFO-queued intent proves a deadline, not an offline computer.
    // Preserve observed waiting evidence when present; otherwise classify the
    // expired local task without inventing route or readiness facts.
    const waitingPolicy = waitingBoundary
      ? resolveRuntimeCoordinatorHeadWaitingPolicy(waitingBoundary.reasonCode)
      : {
          waitingCategory: "local_agent_unavailable" as const,
          userRecoveryAction: "check_status" as const,
          reasonCode: "wake.device_wait.expired" as const,
        };
    const nextRecord = buildRuntimeCoordinatorHeadPublicationIntentReadyRecord({
      decisionSource: "runtime_coordinator_head_waiting_deadline",
      existing: current,
      nowMs: input.nowMs,
      publicationCategory: waitingPolicy.waitingCategory,
      reasonCode: waitingPolicy.reasonCode,
      userRecoveryAction: waitingPolicy.userRecoveryAction,
    });
    const stored =
      await this.writeRuntimeCoordinatorHeadLifecycleRecord(nextRecord);
    await this.publishRuntimeCoordinatorHeadFailureNotice(stored);
  }
  private async processRuntimeCoordinatorHeadWaitingAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    await processRuntimeCoordinatorHeadWaitingDeadlineAlarmWithPorts({
      nowMs,
      ports: {
        escalateHeadWaitingDeadline: (input) =>
          this.escalateRuntimeCoordinatorHeadWaitingDeadline(input),
        readRecords: () =>
          this.readRuntimeCoordinatorHeadLifecycleRecordsForWaitingAlarm(),
        reserveWorkUnit: () =>
          !run ||
          this.reserveHousekeepingAlarmWorkUnit(
            run,
            "runtime_coordinator_head_waiting"
          ),
      },
    });
  }
  private async readRuntimeCoordinatorHeadLifecycleRecordsForWaitingAlarm(): Promise<
    RuntimeCoordinatorHeadLifecycleRecord[]
  > {
    const records =
      await this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex();
    const legacyWaitingRecords = records.filter(
      (record) =>
        record.status === "waiting" && record.acceptedAtMs === undefined
    );
    const pendingPromotions =
      legacyWaitingRecords.length > 0
        ? await readPendingAgentProfileWorkPromotions(this.ctx.storage)
        : [];
    const pendingPromotionByWakeLifecycleId = new Map(
      pendingPromotions.map((promotion) => [
        promotion.targetWakeLifecycleId,
        promotion,
      ])
    );
    const normalizedRecords: RuntimeCoordinatorHeadLifecycleRecord[] = [];
    for (const record of records) {
      const pendingPromotion = pendingPromotionByWakeLifecycleId.get(
        record.targetWakeLifecycleId
      );
      const normalized =
        record.status === "waiting"
          ? normalizeLegacyRuntimeCoordinatorHeadAcceptanceTiming(
              record,
              pendingPromotion?.dispatchId === record.primaryDispatchId &&
                pendingPromotion.targetProfileId ===
                  record.targetWakeLifecycleIdentity.targetProfileId
                ? { acceptedAtMs: pendingPromotion.createdAtMs }
                : undefined
            )
          : record;
      if (normalized !== record) {
        await this.writeRuntimeCoordinatorHeadLifecycleRecord(normalized);
      }
      normalizedRecords.push(normalized);
    }
    return normalizedRecords;
  }
  private async processRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm(
    nowMs: number,
    run: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    if (
      !this.reserveHousekeepingAlarmWorkUnit(
        run,
        "runtime_coordinator_agent_profile_execution_index"
      )
    ) {
      return;
    }
    const status =
      await advanceRuntimeCoordinatorAgentProfileExecutionIndexRepair({
        nowMs,
        storage: this.ctx.storage,
      });
    if (status === "rebuilding") {
      this.requestHousekeepingAlarmContinuation(
        run,
        "runtime_coordinator.execution_index_rebuilding"
      );
    }
  }
  private async processRuntimeCoordinatorHeadAcceptedHandoffAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    await processRuntimeCoordinatorHeadAcceptedHandoffAlarmWithPorts({
      nowMs,
      ports: {
        readRecords: () =>
          this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex(),
        recordHeadWaitingBoundary: (request) =>
          this.recordRuntimeCoordinatorHeadWaiting(request),
        reserveWorkUnit: () =>
          !run ||
          this.reserveHousekeepingAlarmWorkUnit(
            run,
            "runtime_coordinator_head_accepted_handoff"
          ),
      },
    });
  }
  private async processRuntimeCoordinatorHeadFailurePublicationRetryAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    await processRuntimeCoordinatorHeadFailurePublicationRetryAlarmWithPorts({
      nowMs,
      ports: {
        publishHeadFailureNotice: async (record) => {
          await this.publishRuntimeCoordinatorHeadFailureNotice(record);
        },
        readRecords: () =>
          this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex(),
        reserveWorkUnit: () =>
          !run ||
          this.reserveHousekeepingAlarmWorkUnit(
            run,
            "runtime_coordinator_head_failure_publication"
          ),
      },
    });
  }
  private async readRuntimeCoordinatorHeadLifecycleRecordsFromIndex(): Promise<
    RuntimeCoordinatorHeadLifecycleRecord[]
  > {
    return await readRuntimeCoordinatorHeadLifecycleRecordsFromStorageIndex(
      this.ctx.storage
    );
  }
  private async resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMs(): Promise<
    number | null
  > {
    const records =
      await this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex();
    return resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMsFromRecords({
      nowMs: Date.now(),
      records,
    });
  }
  private async resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMs(): Promise<
    number | null
  > {
    const records =
      await this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex();
    return resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMsFromRecords(
      {
        nowMs: Date.now(),
        records,
      }
    );
  }
  private async resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMs(): Promise<
    number | null
  > {
    const records =
      await this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex();
    return resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMsFromRecords(
      {
        nowMs: Date.now(),
        records,
      }
    );
  }
  private async buildRuntimeCoordinatorRunCommandStateFromDelivery(input: {
    nowMs: number;
    reasonCode: string;
    request: RuntimeTransportDeliverDispatchRequest;
  }): Promise<RuntimeCoordinatorRunCommandState> {
    const executionToken = input.request.payload.executionToken ?? null;
    if (!executionToken) {
      throw new Error("runtime_coordinator.execution_token_unavailable");
    }
    const existing = await this.readRuntimeCoordinatorRunCommandState(
      input.request.payload.runtimeCoordinatorExecutionId
    );
    const deliverySession = this.state.sessionsById.get(
      input.request.daemonSessionId
    );
    if (
      !deliverySession ||
      deliverySession.ownerUserId !== input.request.ownerUserId ||
      deliverySession.connectionGeneration !==
        input.request.connectionGeneration
    ) {
      throw new Error(
        "runtime_coordinator.delivery_route_identity_unavailable"
      );
    }
    return {
      activeRunId: executionToken.runId,
      attemptId: input.request.attemptId,
      createdAtMs: existing?.createdAtMs ?? input.nowMs,
      dispatchId: input.request.dispatchId,
      lastCommandReasonCode: input.reasonCode,
      lastDeliveryProvenance: {
        connectionGeneration: input.request.connectionGeneration,
        daemonSessionId: input.request.daemonSessionId,
        deviceId: deliverySession.deviceId,
        lane: deliverySession.lane,
        leaseEpoch: input.request.leaseEpoch,
      },
      lastWatchdogCheckAtMs: null,
      localProgress: {
        acceptedLocalAtMs: null,
        completedLocalAtMs: null,
        lastLifecycleAtMs: input.nowMs,
        phase: "starting",
        resultReceivedAtMs: null,
        runningAtMs: null,
      },
      modelVersion: RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
      ownerUserId: input.request.ownerUserId,
      pendingInteraction: existing?.pendingInteraction ?? null,
      profileId: input.request.profileId,
      redeliveryCount: existing?.redeliveryCount ?? 0,
      runtimeCoordinatorExecutionId:
        input.request.payload.runtimeCoordinatorExecutionId,
      sanitizedDeliveryRequest:
        sanitizeRuntimeCoordinatorDeliveryRequestForCommandState(input.request),
      sourceClientMessageId:
        input.request.payload.sourceClientMessageId ?? null,
      targetProfileId: input.request.payload.targetProfileId,
      updatedAtMs: input.nowMs,
    };
  }
  private resolveRuntimeCoordinatorLifecycleRouteRejection(input: {
    commandState: RuntimeCoordinatorRunCommandState | null;
    request: RuntimeTransportDispatchLifecycleRequest;
    webSocket: WebSocket;
  }): string | null {
    if (!input.commandState) {
      return "daemon.session.not_found";
    }
    const session = this.state.sessionsById.get(input.request.daemonSessionId);
    const provenance = input.commandState.lastDeliveryProvenance;
    if (
      !session?.socket ||
      session.socket !== input.webSocket ||
      session.ownerUserId !== input.commandState.ownerUserId ||
      this.resolveVerifiedOwnerUserId(input.webSocket) !==
        input.commandState.ownerUserId ||
      input.request.daemonSessionId !== provenance.daemonSessionId ||
      !session.profileIds.has(input.commandState.profileId)
    ) {
      return "daemon.session.not_found";
    }
    if (
      session.connectionGeneration !== input.request.connectionGeneration ||
      input.request.connectionGeneration < provenance.connectionGeneration ||
      (input.request.connectionGeneration !== provenance.connectionGeneration &&
        (!hasRuntimeCoordinatorDurableLocalProgress(
          input.commandState.localProgress
        ) ||
          provenance.deviceId !== session.deviceId ||
          provenance.lane !== session.lane))
    ) {
      return "daemon.session.connection_replaced";
    }
    const lease = this.state.profileLeasesByProfileId.get(
      input.commandState.profileId
    );
    if (
      !lease ||
      lease.daemonSessionId !== session.daemonSessionId ||
      lease.deviceId !== session.deviceId ||
      lease.lane !== session.lane ||
      lease.leaseEpoch !== provenance.leaseEpoch ||
      input.request.leaseEpoch !== provenance.leaseEpoch
    ) {
      return "daemon.session.stale_lease";
    }
    return null;
  }
  private async updateRuntimeCoordinatorRunCommandStateFromLifecycle(input: {
    activeRunId: string;
    pending: PendingDispatchState | null;
    recordProgress: boolean;
    request: RuntimeTransportDispatchLifecycleRequest;
    webSocket: WebSocket;
  }): Promise<string | null> {
    return await this.ctx.storage.transaction(async (transaction) => {
      const current = await readRuntimeCoordinatorRunCommandStateFromStorage(
        transaction,
        input.request.runtimeCoordinatorExecutionId ?? ""
      );
      if (
        !current ||
        current.activeRunId !== input.activeRunId ||
        current.dispatchId !== input.request.dispatchId ||
        current.attemptId !== input.request.attemptId
      ) {
        return "daemon.session.not_found";
      }
      const rejected = this.resolveRuntimeCoordinatorLifecycleRouteRejection({
        commandState: current,
        request: input.request,
        webSocket: input.webSocket,
      });
      if (rejected) {
        return rejected;
      }
      const nowMs = Date.now();
      const next = input.recordProgress
        ? buildRuntimeCoordinatorRunCommandStateFromLifecycle({
            commandState: current,
            lifecycle: {
              ...input.request,
              lifecycleAtMs:
                input.pending?.lastLifecycleAtMs ?? input.request.lifecycleAtMs,
            },
            nowMs,
          })
        : current;
      await writeRuntimeCoordinatorRunCommandStateInTransaction(transaction, {
        ...next,
        // Same-process reconnect changes transport control, not execution or
        // progress. Occupied keepalives must also retain their watchdog baseline.
        lastDeliveryProvenance: {
          ...current.lastDeliveryProvenance,
          connectionGeneration: input.request.connectionGeneration,
        },
        updatedAtMs: nowMs,
      });
      return null;
    });
  }
  private async markRuntimeCoordinatorRunCommandStateResultReceived(input: {
    attemptId: string | null;
    dispatchId: string;
    receivedAtMs: number;
    runtimeCoordinatorExecutionId: string;
  }): Promise<void> {
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      input.runtimeCoordinatorExecutionId
    );
    if (
      !commandState ||
      commandState.dispatchId !== input.dispatchId ||
      commandState.attemptId !== input.attemptId
    ) {
      return;
    }
    await this.writeRuntimeCoordinatorRunCommandState({
      ...commandState,
      lastWatchdogCheckAtMs: null,
      localProgress: {
        ...commandState.localProgress,
        completedLocalAtMs:
          commandState.localProgress.completedLocalAtMs ?? input.receivedAtMs,
        lastLifecycleAtMs: Math.max(
          commandState.localProgress.lastLifecycleAtMs ?? 0,
          input.receivedAtMs
        ),
        phase: "result_received",
        resultReceivedAtMs:
          commandState.localProgress.resultReceivedAtMs ?? input.receivedAtMs,
        runningAtMs:
          commandState.localProgress.runningAtMs ?? input.receivedAtMs,
      },
      updatedAtMs: input.receivedAtMs,
    });
  }
  private recordRuntimeCoordinatorLifecycleProjectionFromCommandState(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    request: RuntimeTransportDispatchLifecycleRequest;
  }): void {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const nowMs = Date.now();
    const eventType = resolveCoordinatorLifecycleEventType(input.request.phase);
    const record = buildRuntimeCoordinatorExecutionRecordFromCommandState({
      commandState: input.commandState,
      nowMs,
      status: input.request.phase,
    });
    const projectionWrite = Promise.all([
      writeRuntimeCoordinatorExecutionProjection({ db, record }),
      writeRuntimeCoordinatorExecutionEventFromParts({
        db,
        eventType,
        idempotencyKey: buildCoordinatorLifecycleEventIdempotencyKey(
          input.request
        ),
        observedAtMs: nowMs,
        payload: {
          agentControllerConversationOccupancy:
            input.request.agentControllerConversationOccupancy ?? null,
          lifecycleAtMs: input.request.lifecycleAtMs,
          runningAtMs: input.commandState.localProgress.runningAtMs,
          localQueue: input.request.localQueue ?? null,
          phase: input.request.phase,
          source: "runtime_coordinator_run_command_state",
        },
        replaceCurrentState: Boolean(
          input.request.agentControllerConversationOccupancy
        ),
        runtimeCoordinatorExecutionId:
          input.commandState.runtimeCoordinatorExecutionId,
        statusAfter: input.request.phase,
      }),
    ]);
    projectionWrite.catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_lifecycle_failed]",
        {
          attemptId: input.request.attemptId,
          dispatchId: input.request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId:
            input.commandState.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private async readRuntimeCoordinatorDecisionByKey(input: {
    idempotencyKey: string;
    runtimeCoordinatorExecutionId: string;
  }): Promise<RuntimeCoordinatorDurableDecisionRecord | null> {
    return await readRuntimeCoordinatorDecisionByKeyFromStorage(
      this.ctx.storage,
      input
    );
  }
  private async appendRuntimeCoordinatorDecisionRecord(input: {
    decision: RuntimeCoordinatorDurableDecisionRecord;
    runtimeCoordinatorExecutionId: string;
  }): Promise<void> {
    await appendRuntimeCoordinatorDecisionRecordToStorage(
      this.ctx.storage,
      input
    );
  }
  private async readRuntimeCoordinatorDecisionRecords(
    runtimeCoordinatorExecutionId: string
  ): Promise<RuntimeCoordinatorDurableDecisionRecord[]> {
    return await readRuntimeCoordinatorDecisionRecordsFromStorage(
      this.ctx.storage,
      runtimeCoordinatorExecutionId
    );
  }
  private async recordRuntimeCoordinatorDeliveryProjection(input: {
    deliveryRouteAssessment: {
      evidence: RuntimeCoordinatorDeliveryRouteEvidence;
      observedAtMs: number;
    } | null;
    request: Parameters<typeof deliverDispatch>[1];
    response: RuntimeTransportDeliverDispatchResponse;
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const nowMs = Date.now();
    const status: RuntimeCoordinatorExecutionStatus = input.response.accepted
      ? "delivery_accepted"
      : "delivery_rejected";
    const record = buildRuntimeCoordinatorExecutionRecordFromDelivery({
      nowMs,
      request: input.request,
      status,
    });
    try {
      await writeRuntimeCoordinatorExecutionProjection({ db, record });
      if (input.response.accepted) {
        await writeRuntimeCoordinatorExecutionEventFromParts({
          db,
          eventType: "execution_created",
          idempotencyKey: `deliver:${input.request.dispatchId}:${input.request.attemptId}`,
          observedAtMs: nowMs,
          payload: {
            deliveryStatus: input.response.status,
          },
          runtimeCoordinatorExecutionId:
            input.request.payload.runtimeCoordinatorExecutionId,
          statusAfter: status,
        });
        const executionToken = input.request.payload.executionToken ?? null;
        if (executionToken) {
          await writeRuntimeCoordinatorExecutionEventFromParts({
            db,
            eventType: "execution_token_issued",
            idempotencyKey: `execution_token:${input.request.payload.runtimeCoordinatorExecutionId}:${executionToken.runId}:issued`,
            observedAtMs: executionToken.issuedAtMs,
            payload: {
              deliveryIdempotencyKey: executionToken.deliveryIdempotencyKey,
              runId: executionToken.runId,
              tokenFingerprint: executionToken.tokenFingerprint,
              tokenStatus: executionToken.tokenStatus,
            },
            reasonCode: "execution_token_issued",
            runtimeCoordinatorExecutionId:
              input.request.payload.runtimeCoordinatorExecutionId,
            statusAfter: status,
          });
        }
      }
      await writeRuntimeCoordinatorExecutionEventFromParts({
        db,
        eventType: input.response.accepted
          ? "delivery_accepted"
          : "delivery_rejected",
        idempotencyKey: `deliver:${input.request.dispatchId}:${input.request.attemptId}`,
        observedAtMs: nowMs,
        payload: {
          accepted: input.response.accepted,
          deliveryStatus: input.response.status,
          ...(input.deliveryRouteAssessment
            ? {
                deliveryRouteEvidence: input.deliveryRouteAssessment.evidence,
                deliveryRouteObservedAtMs:
                  input.deliveryRouteAssessment.observedAtMs,
              }
            : {}),
        },
        reasonCode:
          "reasonCode" in input.response ? input.response.reasonCode : null,
        runtimeCoordinatorExecutionId:
          input.request.payload.runtimeCoordinatorExecutionId,
        statusAfter: status,
      });
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_projection_failed]",
        {
          dispatchId: input.request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId:
            input.request.payload.runtimeCoordinatorExecutionId,
        }
      );
    }
  }
  private async handleWaitDispatchResultRequest(
    request: Request
  ): Promise<Response> {
    const raw = await readJsonBody(request);
    const parsed = parseWaitDispatchResultRequest(raw);
    if (!parsed) {
      return Response.json(
        {
          state: "failed",
          reasonCode: "daemon.delivery.timeout",
        } satisfies WaitDispatchResultResponse,
        { status: 400 }
      );
    }
    const durableResult = await this.readAcceptedResultInbox(parsed);
    if (durableResult) {
      return Response.json(durableResult, { status: 200 });
    }
    const response = await waitDispatchResult(this.state, parsed);
    await this.syncHousekeepingAlarm();
    return Response.json(response, {
      status: response.state === "failed" ? 409 : 200,
    });
  }
  private async readAcceptedResultInbox(
    request: WaitDispatchResultRequest
  ): Promise<WaitDispatchResultResponse | null> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return null;
    }
    const record = await readDispatchResultInboxRecord(db, {
      attemptId: request.attemptId,
      dispatchId: request.dispatchId,
    }).catch(() => null);
    if (!record) {
      return null;
    }
    if (
      record.daemonSessionId !== request.daemonSessionId ||
      record.leaseEpoch !== request.leaseEpoch
    ) {
      return {
        state: "failed",
        reasonCode: "daemon.session.stale_lease",
      };
    }
    return {
      state: "completed",
      taskResult: record.taskResult,
    };
  }

  private async handleExecutionInput(
    request: Request,
    resolveOnly: boolean
  ): Promise<Response> {
    const body = await readJsonBody(request);
    const operation = localExecutionInputOperationSchema.safeParse(body);
    let selectorBody = body;
    if (!resolveOnly) {
      selectorBody = operation.success
        ? {
            ownerUserId: operation.data.request.ownerUserId,
            runtimeCoordinatorExecutionId:
              operation.data.request.runtimeCoordinatorExecutionId,
            dispatchId: operation.data.request.dispatchId,
            targetProfileId: operation.data.request.targetProfileId,
            spaceId: operation.data.request.source.spaceId,
            authorProfileId: operation.data.request.source.authorProfileId,
          }
        : null;
    }
    const selector = localExecutionInputResolveSchema.safeParse(selectorBody);
    if (!(selector.success && (resolveOnly || operation.success))) {
      return Response.json(null, { status: 400 });
    }
    const scope = selector.data;
    const state = await this.ctx.storage.transaction(async (transaction) => {
      const [command, authority] = await Promise.all([
        readRuntimeCoordinatorRunCommandStateFromStorage(
          transaction,
          scope.runtimeCoordinatorExecutionId
        ),
        readRuntimeCoordinatorTokenAuthorityFromStorage(
          transaction,
          scope.runtimeCoordinatorExecutionId
        ),
      ]);
      const delivery = command?.sanitizedDeliveryRequest.payload;
      if (
        !(command && delivery) ||
        command.ownerUserId !== scope.ownerUserId ||
        command.dispatchId !== scope.dispatchId ||
        command.targetProfileId !== scope.targetProfileId ||
        delivery.spaceId !== scope.spaceId ||
        delivery.sourceSignal.profileId !== scope.authorProfileId ||
        !supportsLocalExecutionInput(
          delivery.executionIdentity.core.agentControllerRef
        )
      ) {
        return null;
      }
      if (
        operation.success &&
        (command.attemptId !== operation.data.request.attemptId ||
          command.activeRunId !==
            operation.data.request.runtimeCoordinatorRunId)
      ) {
        return null;
      }
      if (
        resolveOnly ||
        (operation.success && operation.data.operation === "apply")
      ) {
        const run = authority?.runsById[command.activeRunId];
        // Resolving reserves the next input in Space; apply delivers to the
        // current controller turn. Startup must not reject a queue.
        const inputPhases = resolveOnly
          ? ["starting", "accepted_local", "running"]
          : ["running"];
        if (
          !authority ||
          authority.terminalOutcome ||
          authority.currentRunId !== command.activeRunId ||
          run?.tokenStatus !== "active" ||
          !inputPhases.includes(command.localProgress.phase) ||
          command.localAttemptWithdrawal ||
          command.lastCommandReasonCode?.includes("wake_stop")
        ) {
          return null;
        }
      }
      return command;
    });
    if (!state) {
      // Even a known terminal state says nothing about an earlier application's receipt.
      return Response.json(null);
    }
    const provenance = state.lastDeliveryProvenance;
    const session = this.state.sessionsById.get(provenance.daemonSessionId);
    const lease = this.state.profileLeasesByProfileId.get(
      scope.targetProfileId
    );
    if (
      !session?.socket ||
      session.ownerUserId !== scope.ownerUserId ||
      session.connectionGeneration !== provenance.connectionGeneration ||
      !session.profileIds.has(scope.targetProfileId) ||
      session.capabilities.localExecutionInput !== true ||
      !isDaemonExecutionCompatible(session.executionCompatibility) ||
      !lease ||
      lease.daemonSessionId !== session.daemonSessionId ||
      lease.deviceId !== session.deviceId ||
      lease.lane !== session.lane ||
      lease.leaseEpoch !== provenance.leaseEpoch
    ) {
      return Response.json(null);
    }
    if (resolveOnly) {
      return Response.json(
        localExecutionInputBindingSchema.parse({
          ownerUserId: state.ownerUserId,
          runtimeCoordinatorExecutionId: state.runtimeCoordinatorExecutionId,
          dispatchId: state.dispatchId,
          targetProfileId: state.targetProfileId,
          attemptId: state.attemptId,
          runtimeCoordinatorRunId: state.activeRunId,
        })
      );
    }
    if (!operation.success) {
      return Response.json(null);
    }
    const requestId = crypto.randomUUID();
    try {
      const result = await this.sendCurrentDeviceOperationAndWait({
        code: "daemon.execution_input.request",
        expectedResponseCode: "daemon.execution_input.result",
        requestId,
        session: session as RuntimeTransportSessionState & {
          socket: WebSocket;
        },
        payload: {
          ...operation.data,
          requestId,
          connectionGeneration: session.connectionGeneration,
          leaseEpoch: lease.leaseEpoch,
        },
        isExpectedPayload: (value) => {
          const parsed = localExecutionInputResponseSchema.safeParse(value);
          return (
            parsed.success &&
            parsed.data.inputId === operation.data.request.inputId
          );
        },
        timeoutMs: 10_000,
      });
      return Response.json(result);
    } catch (error) {
      // Space owns the durable claim. Neither a lost response nor a transport
      // error authorizes a second apply; only a read may reconcile it.
      console.warn("[core.runtime_transport.execution_input_unconfirmed]", {
        inputId: operation.data.request.inputId,
        runtimeCoordinatorExecutionId: scope.runtimeCoordinatorExecutionId,
        operation: operation.data.operation,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return Response.json(null);
    }
  }

  private async handleRuntimeCoordinatorReadInteractionRequest(
    request: Request,
    options: { includeRevision: boolean }
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorReadInteractionRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(
        {
          pendingInteraction: null,
        } satisfies RuntimeTransportRuntimeCoordinatorReadInteractionResponse,
        { status: 400 }
      );
    }
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      parsed.data.runtimeCoordinatorExecutionId
    );
    const nowMs = Date.now();
    const storedPending = commandState?.pendingInteraction ?? null;
    const pending =
      storedPending &&
      !storedPending.response &&
      storedPending.request.expiresAtMs > nowMs
        ? storedPending
        : null;
    const canRespond =
      Boolean(commandState) &&
      commandState?.ownerUserId === parsed.data.actorOwnerUserId &&
      Boolean(pending) &&
      (pending?.request.expiresAtMs ?? 0) > Date.now();
    const pendingInteraction: AgentInteractionPendingSummary | null = pending
      ? {
          canRespond,
          expiresAtMs: pending.request.expiresAtMs,
          interactionId: pending.request.interactionId,
          kind: pending.request.kind,
          request: canRespond ? pending.request : null,
          requestedAtMs: pending.request.requestedAtMs,
        }
      : null;
    if (!options.includeRevision) {
      return Response.json(
        runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema.parse({
          pendingInteraction,
        })
      );
    }
    return Response.json(
      runtimeTransportRuntimeCoordinatorReadInteractionRevisionResponseSchema.parse(
        {
          interactionUpdatedAtMs:
            resolveRuntimeCoordinatorInteractionUpdatedAtMs({
              commandState,
              nowMs,
            }),
          pendingInteraction,
        }
      )
    );
  }
  private async handleRuntimeCoordinatorRespondInteractionRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return this.buildRuntimeCoordinatorRespondInteractionHttpResponse(
        {
          message: "The interaction response is invalid.",
          ok: false,
          status: "response_invalid",
        },
        400
      );
    }
    const response = await this.respondToRuntimeCoordinatorInteraction(
      parsed.data
    );
    return this.buildRuntimeCoordinatorRespondInteractionHttpResponse(
      response,
      response.ok ? 200 : 409
    );
  }
  private async respondToRuntimeCoordinatorInteraction(
    input: RuntimeTransportRuntimeCoordinatorRespondInteractionRequest
  ): Promise<RuntimeTransportRuntimeCoordinatorRespondInteractionResponse> {
    const fingerprint = await interactionResponseFingerprint(input.response);
    const response = await this.ctx.storage.transaction((transaction) =>
      this.persistRuntimeCoordinatorInteractionResponse(
        input,
        transaction,
        fingerprint
      )
    );
    if (response.ok) {
      const commandState = await this.readRuntimeCoordinatorRunCommandState(
        input.runtimeCoordinatorExecutionId
      );
      const pending = commandState?.pendingInteraction;
      if (
        commandState &&
        pending?.request.interactionId === input.interactionId
      ) {
        this.publishWakeProgressChanged({
          agentProfileId: commandState.targetProfileId,
          clientMessageId: commandState.sourceClientMessageId,
          spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
        });
        await this.tryResolveRuntimeCoordinatorInteractionInboxItem({
          commandState,
          interaction: pending.request,
          resolvedAtMs: response.respondedAtMs,
        });
        this.tryDeliverRuntimeCoordinatorInteractionResponse(commandState);
      }
      this.queueHousekeepingAlarmSync();
    }
    return response;
  }

  private async persistRuntimeCoordinatorInteractionResponse(
    input: RuntimeTransportRuntimeCoordinatorRespondInteractionRequest,
    transaction: DurableObjectTransaction,
    fingerprint: string
  ): Promise<RuntimeTransportRuntimeCoordinatorRespondInteractionResponse> {
    const commandState = await readRuntimeCoordinatorRunCommandStateFromStorage(
      transaction,
      input.runtimeCoordinatorExecutionId
    );
    if (!commandState) {
      return {
        message: "This local agent interaction is no longer available.",
        ok: false,
        status: "not_found",
      };
    }
    if (commandState.ownerUserId !== input.actorOwnerUserId) {
      return {
        message: "Only the owner of this local agent can respond.",
        ok: false,
        status: "owner_mismatch",
      };
    }
    const receipts = commandState.interactionResponseReceipts ?? {};
    const receipt = Object.hasOwn(receipts, input.interactionId)
      ? receipts[input.interactionId]
      : undefined;
    if (receipt) {
      return receipt.responseFingerprint === fingerprint
        ? {
            ok: true,
            respondedAtMs: receipt.respondedAtMs,
            status: "already_resolved",
          }
        : {
            ok: false,
            status: "response_invalid",
            message:
              "A different response was already recorded. Refresh to see the current status.",
          };
    }
    const pending = commandState.pendingInteraction ?? null;
    if (!pending || pending.request.interactionId !== input.interactionId) {
      return {
        message: "This response does not match the pending interaction.",
        ok: false,
        status: "interaction_mismatch",
      };
    }
    if (pending.response && pending.respondedAtMs !== null) {
      if (JSON.stringify(pending.response) !== JSON.stringify(input.response)) {
        return {
          message:
            "A different response was already recorded. Refresh to see the current status.",
          ok: false,
          status: "response_invalid",
        };
      }
      return {
        ok: true,
        respondedAtMs: pending.respondedAtMs,
        status: "already_resolved",
      };
    }
    if (pending.request.expiresAtMs <= Date.now()) {
      return {
        message: "This request expired. Send the task again when you’re ready.",
        ok: false,
        status: "expired",
      };
    }
    const resolution = agentInteractionResolutionSchema.safeParse({
      request: pending.request,
      response: input.response,
    });
    if (!resolution.success) {
      return {
        message: "This answer is not valid for the pending interaction.",
        ok: false,
        status: "response_invalid",
      };
    }
    const respondedAtMs = Date.now();
    const nextPending: RuntimeCoordinatorPendingAgentInteractionState = {
      ...pending,
      respondedAtMs,
      response: resolution.data.response,
    };
    const nextCommandState: RuntimeCoordinatorRunCommandState = {
      ...commandState,
      lastCommandReasonCode: "runtime_coordinator.interaction_responded",
      interactionResponseReceipts: {
        ...commandState.interactionResponseReceipts,
        [input.interactionId]: {
          responseFingerprint: fingerprint,
          respondedAtMs,
        },
      },
      pendingInteraction: nextPending,
      updatedAtMs: respondedAtMs,
    };
    await writeRuntimeCoordinatorRunCommandStateInTransaction(
      transaction,
      nextCommandState
    );
    return {
      ok: true,
      respondedAtMs,
      status: "accepted",
    };
  }
  private buildRuntimeCoordinatorRespondInteractionHttpResponse(
    response: RuntimeTransportRuntimeCoordinatorRespondInteractionResponse,
    status: number
  ): Response {
    const parsed =
      runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema.safeParse(
        response
      );
    if (!parsed.success) {
      return Response.json(
        {
          message: "The interaction response could not be recorded.",
          ok: false,
          status: "retry_later",
        } satisfies RuntimeTransportRuntimeCoordinatorRespondInteractionResponse,
        { status: 500 }
      );
    }
    return Response.json(parsed.data, { status });
  }
  private async replayRuntimeCoordinatorInteractionResponsesForSession(
    daemonSessionId: string
  ): Promise<void> {
    const session = this.state.sessionsById.get(daemonSessionId);
    if (
      !session?.socket ||
      session.capabilities.localAgentInteraction !== true
    ) {
      return;
    }
    const commandStates =
      await this.readRuntimeCoordinatorRunCommandStatesFromIndex();
    for (const commandState of commandStates) {
      if (
        commandState.ownerUserId !== session.ownerUserId ||
        !session.profileIds.has(commandState.profileId)
      ) {
        continue;
      }
      this.tryDeliverRuntimeCoordinatorInteractionResponse(commandState);
    }
  }
  private async reconcileRuntimeCoordinatorExecutionsAfterSessionDisconnect(input: {
    daemonSessionId: string;
  }): Promise<void> {
    const disconnectedSession = this.state.sessionsById.get(
      input.daemonSessionId
    );
    if (!disconnectedSession || disconnectedSession.socket !== null) {
      return;
    }
    const replacementSessionIds = new Set(
      [...this.state.sessionsById.values()]
        .filter(
          (session) =>
            session.daemonSessionId !== input.daemonSessionId &&
            session.socket !== null &&
            session.ownerUserId === disconnectedSession.ownerUserId &&
            session.deviceId === disconnectedSession.deviceId &&
            session.lane === disconnectedSession.lane
        )
        .map((session) => session.daemonSessionId)
    );
    for (const daemonSessionId of replacementSessionIds) {
      await this.reconcileRuntimeCoordinatorExecutionsForReplacementSession({
        daemonSessionId,
      });
    }
  }
  private async reconcileRuntimeCoordinatorExecutionsForReplacementSession(input: {
    daemonSessionId: string;
  }): Promise<void> {
    const replacementSession = this.state.sessionsById.get(
      input.daemonSessionId
    );
    const db = getPostgresDatabase(this.env);
    if (
      !(
        replacementSession?.socket &&
        replacementSession.acceptingDispatches !== false &&
        db
      )
    ) {
      return;
    }
    // Result frames sent before the startup-admission heartbeat are already
    // ordered by dispatch. Await those real result decisions before declaring
    // that the replacement Service has no recoverable local result.
    await Promise.all([...this.orderedDispatchFrameTails.values()]);
    const currentReplacementSession = this.state.sessionsById.get(
      input.daemonSessionId
    );
    if (
      !currentReplacementSession?.socket ||
      currentReplacementSession.acceptingDispatches === false
    ) {
      return;
    }
    const commandStates =
      await this.readRuntimeCoordinatorRunCommandStatesFromIndex();
    for (const commandState of commandStates) {
      const previousDaemonSessionId =
        commandState.lastDeliveryProvenance.daemonSessionId;
      if (
        previousDaemonSessionId === currentReplacementSession.daemonSessionId ||
        commandState.ownerUserId !== currentReplacementSession.ownerUserId ||
        commandState.localProgress.phase === "result_received"
      ) {
        continue;
      }
      await this.runSerializedRuntimeCoordinatorFinalizationToCompletion({
        run: () =>
          this.reconcileRuntimeCoordinatorExecutionForReplacementSession({
            daemonSessionId: input.daemonSessionId,
            runtimeCoordinatorExecutionId:
              commandState.runtimeCoordinatorExecutionId,
          }),
        runtimeCoordinatorExecutionId:
          commandState.runtimeCoordinatorExecutionId,
      });
    }
  }
  private async reconcileRuntimeCoordinatorExecutionForReplacementSession(input: {
    daemonSessionId: string;
    runtimeCoordinatorExecutionId: string;
  }): Promise<void> {
    const currentReplacementSession = this.state.sessionsById.get(
      input.daemonSessionId
    );
    const db = getPostgresDatabase(this.env);
    if (
      !(
        currentReplacementSession?.socket &&
        currentReplacementSession.acceptingDispatches !== false &&
        db
      )
    ) {
      return;
    }
    // This method runs behind the per-execution serializer, but the index scan
    // that queued it may have observed an older command. Re-read inside the
    // serialized section so a concurrent reconciliation sees the first
    // delivery's durable provenance and cannot send the same Wake twice.
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      input.runtimeCoordinatorExecutionId
    );
    if (!commandState) {
      return;
    }
    const previousDaemonSessionId =
      commandState.lastDeliveryProvenance.daemonSessionId;
    const previousSession = this.state.sessionsById.get(
      previousDaemonSessionId
    );
    const currentLease = this.state.profileLeasesByProfileId.get(
      commandState.profileId
    );
    const persistedPreviousRouteMatchesReplacement =
      previousSession === undefined &&
      commandState.lastDeliveryProvenance.deviceId ===
        currentReplacementSession.deviceId &&
      commandState.lastDeliveryProvenance.lane ===
        currentReplacementSession.lane;
    const inMemoryPreviousRouteWasDisconnected =
      previousSession !== undefined &&
      previousSession.socket === null &&
      previousSession.deliveryDisconnectedAtMs !== null &&
      previousSession.ownerUserId === currentReplacementSession.ownerUserId &&
      previousSession.deviceId === currentReplacementSession.deviceId &&
      previousSession.lane === currentReplacementSession.lane;
    if (
      previousDaemonSessionId === currentReplacementSession.daemonSessionId ||
      commandState.ownerUserId !== currentReplacementSession.ownerUserId ||
      commandState.localProgress.phase === "result_received" ||
      !(
        persistedPreviousRouteMatchesReplacement ||
        inMemoryPreviousRouteWasDisconnected
      ) ||
      !currentReplacementSession.profileIds.has(commandState.profileId) ||
      currentLease?.daemonSessionId !==
        currentReplacementSession.daemonSessionId
    ) {
      return;
    }
    if (
      !hasRuntimeCoordinatorDurableLocalProgress(commandState.localProgress)
    ) {
      await this.decideRuntimeCoordinatorExecutionProgress({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        attemptId: commandState.attemptId,
        dispatchId: commandState.dispatchId,
        eventKind: "reclaim",
        idempotencyKey: `runtime_coordinator_pre_accept_service_replacement:${commandState.runtimeCoordinatorExecutionId}:${commandState.activeRunId}:${currentReplacementSession.daemonSessionId}`,
        observedRunId: commandState.activeRunId,
        reasonCode: "runtime_coordinator.pre_accept_service_replacement",
        runtimeCoordinatorExecutionId:
          commandState.runtimeCoordinatorExecutionId,
        sourceClientMessageId: commandState.sourceClientMessageId,
        spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
        targetProfileId: commandState.targetProfileId,
        trigger: "daemon",
      });
      return;
    }
    const [authority, projection] = await Promise.all([
      this.readRuntimeCoordinatorTokenAuthority(
        commandState.runtimeCoordinatorExecutionId
      ),
      readRuntimeCoordinatorExecutionProjectionById({
        db,
        runtimeCoordinatorExecutionId:
          commandState.runtimeCoordinatorExecutionId,
      }),
    ]);
    if (
      !authority ||
      authority.terminalOutcome ||
      !authority.currentRunId ||
      !projection ||
      projection.terminalOutcome
    ) {
      return;
    }
    if (projection.status === "cancellation_requested") {
      await this.settleRuntimeCoordinatorWakeStopLocalControlResult({
        daemonSessionId: previousDaemonSessionId,
        payload: {
          accepted: false,
          note: "The task is not present after OpenMeld Service restarted.",
          reasonCode: "task.not_found",
          target: {
            by: "task",
            taskId: commandState.sanitizedDeliveryRequest.payload.taskId,
          },
        },
        requestId: buildRuntimeCoordinatorWakeStopControlRequestId(
          commandState.runtimeCoordinatorExecutionId
        ),
      });
      return;
    }
    if (
      projection.status === "cancelled" ||
      projection.status === "failed_terminal" ||
      projection.status === "reply_published"
    ) {
      return;
    }
    const nowMs = Date.now();
    await this.recordRuntimeCoordinatorDeliveryExpiredDecision({
      authority,
      commandState,
      expiryCause: "local_runtime_lost",
      input: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        attemptId: commandState.attemptId,
        dispatchId: commandState.dispatchId,
        eventKind: "reclaim",
        idempotencyKey: `runtime_coordinator_local_runtime_lost:${commandState.runtimeCoordinatorExecutionId}:${commandState.activeRunId}:${currentReplacementSession.daemonSessionId}`,
        reasonCode: RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE,
        runtimeCoordinatorExecutionId:
          commandState.runtimeCoordinatorExecutionId,
        sourceClientMessageId: commandState.sourceClientMessageId,
        spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
        targetProfileId: commandState.targetProfileId,
        trigger: "daemon",
      },
      nowMs,
      projection,
    });
  }
  private tryDeliverRuntimeCoordinatorInteractionResponse(
    commandState: RuntimeCoordinatorRunCommandState
  ): boolean {
    const pending = commandState.pendingInteraction ?? null;
    if (!(pending?.response && pending.respondedAtMs !== null)) {
      return false;
    }
    const lease = this.state.profileLeasesByProfileId.get(
      commandState.profileId
    );
    const session = lease
      ? this.state.sessionsById.get(lease.daemonSessionId)
      : null;
    if (
      !(lease && session?.socket) ||
      session.ownerUserId !== commandState.ownerUserId ||
      !session.profileIds.has(commandState.profileId) ||
      session.capabilities.localAgentInteraction !== true ||
      !isDaemonExecutionCompatible(session.executionCompatibility) ||
      !isDaemonExecutionCompatible(lease.executionCompatibility)
    ) {
      return false;
    }
    this.sendRuntimeCoordinatorInteractionResponse({
      commandState,
      interactionId: pending.request.interactionId,
      respondedAtMs: pending.respondedAtMs,
      response: pending.response,
      webSocket: session.socket,
    });
    return true;
  }
  private sendRuntimeCoordinatorInteractionResponse(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    interactionId: string;
    respondedAtMs: number;
    response: NonNullable<
      RuntimeCoordinatorPendingAgentInteractionState["response"]
    >;
    webSocket: WebSocket;
  }): void {
    const payload =
      runtimeTransportDispatchInteractionResponseFramePayloadSchema.parse({
        attemptId: input.commandState.attemptId,
        dispatchId: input.commandState.dispatchId,
        interactionId: input.interactionId,
        respondedAtMs: input.respondedAtMs,
        response: input.response,
        runtimeCoordinatorExecutionId:
          input.commandState.runtimeCoordinatorExecutionId,
      });
    this.sendFrame(input.webSocket, {
      code: "daemon.dispatch.interaction_response",
      payload,
    });
  }
  /**
   * The Wake's request chain root and Session from its accepted assignment,
   * once the chain is enforced. Null keeps the owner-rooted legacy item.
   */
  private async readInteractionRequestRoot(
    commandState: RuntimeCoordinatorRunCommandState
  ): Promise<InteractionRequestRoot | null> {
    if (!isRequestChainEnforced()) {
      return null;
    }
    const payload = commandState.sanitizedDeliveryRequest.payload;
    const head = await this.readRuntimeCoordinatorHeadLifecycleRecord(
      projectTargetWakeLifecycleIdentity({
        clientMessageId: commandState.sourceClientMessageId,
        dispatchId: commandState.dispatchId,
        sourceSignalId: payload.sourceEventId,
        spaceId: payload.spaceId,
        targetProfileId: commandState.targetProfileId,
      }).targetWakeLifecycleId
    );
    const snapshot = head?.acceptedDispatchSnapshot;
    const chain =
      snapshot?.executionContext?.requestChain ??
      snapshot?.contextRequest?.requestChain;
    const root = chain?.[0];
    return root?.kind === "human"
      ? {
          contextId: snapshot?.executionContext?.id ?? null,
          rootProfileId: root.profileId,
        }
      : null;
  }
  private async tryProjectRuntimeCoordinatorInteractionInboxItem(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    interaction: RuntimeTransportDispatchInteractionRequest["interaction"];
    nowMs: number;
  }): Promise<void> {
    const requestRoot = await this.readInteractionRequestRoot(
      input.commandState
    );
    await this.tryApplyRuntimeCoordinatorInteractionInboxRepair({
      ...(requestRoot ? { requestRoot } : {}),
      attemptCount: 0,
      desiredStatus: "open",
      interaction: {
        interactionId: input.interaction.interactionId,
        kind: input.interaction.kind,
        requestedAtMs: input.interaction.requestedAtMs,
      },
      nextAttemptAtMs: input.nowMs,
      ownerUserId: input.commandState.ownerUserId,
      resolvedAtMs: null,
      runtimeCoordinatorExecutionId:
        input.commandState.runtimeCoordinatorExecutionId,
      sourceSignalId:
        input.commandState.sanitizedDeliveryRequest.payload.sourceEventId,
      spaceId: input.commandState.sanitizedDeliveryRequest.payload.spaceId,
      targetProfileName:
        input.commandState.sanitizedDeliveryRequest.payload.targetProfileName ??
        input.commandState.sanitizedDeliveryRequest.payload
          .targetProfileMentionLabel ??
        "Agent",
      threadRootSignalId:
        input.commandState.sanitizedDeliveryRequest.payload.threadContext
          ?.rootSignalId ?? null,
      updatedAtMs: input.nowMs,
      v: 1,
    });
  }
  private async tryResolveRuntimeCoordinatorInteractionInboxItem(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    interaction: RuntimeTransportDispatchInteractionRequest["interaction"];
    resolvedAtMs: number;
  }): Promise<void> {
    const requestRoot = await this.readInteractionRequestRoot(
      input.commandState
    );
    const record: RuntimeCoordinatorInteractionInboxRepairRecord = {
      ...(requestRoot ? { requestRoot } : {}),
      attemptCount: 0,
      desiredStatus: "resolved",
      interaction: {
        interactionId: input.interaction.interactionId,
        kind: input.interaction.kind,
        requestedAtMs: input.interaction.requestedAtMs,
      },
      nextAttemptAtMs: input.resolvedAtMs,
      ownerUserId: input.commandState.ownerUserId,
      resolvedAtMs: input.resolvedAtMs,
      runtimeCoordinatorExecutionId:
        input.commandState.runtimeCoordinatorExecutionId,
      sourceSignalId:
        input.commandState.sanitizedDeliveryRequest.payload.sourceEventId,
      spaceId: input.commandState.sanitizedDeliveryRequest.payload.spaceId,
      targetProfileName:
        input.commandState.sanitizedDeliveryRequest.payload.targetProfileName ??
        input.commandState.sanitizedDeliveryRequest.payload
          .targetProfileMentionLabel ??
        "Agent",
      threadRootSignalId:
        input.commandState.sanitizedDeliveryRequest.payload.threadContext
          ?.rootSignalId ?? null,
      updatedAtMs: input.resolvedAtMs,
      v: 1,
    };
    await this.claimRuntimeCoordinatorInteractionInboxRepair(record);
    this.ctx.waitUntil(
      this.applyRuntimeCoordinatorInteractionInboxRepair(record)
    );
  }
  private async tryApplyRuntimeCoordinatorInteractionInboxRepair(
    record: RuntimeCoordinatorInteractionInboxRepairRecord
  ): Promise<void> {
    await this.claimRuntimeCoordinatorInteractionInboxRepair(record);
    await this.applyRuntimeCoordinatorInteractionInboxRepair(record);
  }
  private async applyRuntimeCoordinatorInteractionInboxRepair(
    record: RuntimeCoordinatorInteractionInboxRepairRecord
  ): Promise<void> {
    const targetInboxDb = getPostgresDatabase(this.env);
    const spaceIndexDb = getPostgresDatabase(this.env);
    if (!(targetInboxDb && spaceIndexDb)) {
      await this.deferRuntimeCoordinatorInteractionInboxRepair(record);
      console.warn(
        "[core.runtime_transport.interaction_inbox_projection_deferred]",
        {
          desiredStatus: record.desiredStatus,
          interactionId: record.interaction.interactionId,
          reasonCode: "runtime_coordinator.interaction_inbox.db_unavailable",
          runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
        }
      );
      return;
    }
    try {
      let changed: { organizationId: string } | null;
      if (record.desiredStatus === "open") {
        if (!record.sourceSignalId) {
          throw new Error(
            "runtime_coordinator.interaction_inbox.source_signal_unavailable"
          );
        }
        changed = await projectRuntimeCoordinatorInteractionInboxItem({
          inboxDb: targetInboxDb,
          interaction: record.interaction,
          nowMs: record.updatedAtMs,
          ownerUserId: record.ownerUserId,
          runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
          sourceSignalId: record.sourceSignalId,
          spaceId: record.spaceId,
          spaceIndexDb,
          targetProfileName: record.targetProfileName,
          threadRootSignalId: record.threadRootSignalId,
          requestRoot: record.requestRoot ?? null,
        });
      } else {
        changed = await resolveRuntimeCoordinatorInteractionInboxItem({
          inboxDb: targetInboxDb,
          interaction: record.interaction,
          ownerUserId: record.ownerUserId,
          requestRoot: record.requestRoot ?? null,
          resolvedAtMs: record.resolvedAtMs ?? record.updatedAtMs,
          runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
          spaceId: record.spaceId,
          spaceIndexDb,
        });
      }
      await this.removeRuntimeCoordinatorInteractionInboxRepair(record);
      if (changed) {
        // An open Inbox shows the question, or its end, without a reload.
        this.ctx.waitUntil(
          publishAccountInvalidation({
            env: this.env,
            frame: { type: "inbox.changed" },
            organizationId: changed.organizationId,
            userIds: [record.ownerUserId],
          })
        );
      }
    } catch (error) {
      await this.deferRuntimeCoordinatorInteractionInboxRepair(record);
      console.warn(
        "[core.runtime_transport.interaction_inbox_projection_deferred]",
        {
          error: error instanceof Error ? error.message : String(error),
          desiredStatus: record.desiredStatus,
          interactionId: record.interaction.interactionId,
          runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
        }
      );
    }
  }
  private async claimRuntimeCoordinatorInteractionInboxRepair(
    record: RuntimeCoordinatorInteractionInboxRepairRecord
  ): Promise<void> {
    try {
      await this.ctx.storage.put(
        this.runtimeCoordinatorInteractionInboxRepairStorageKey(
          record.runtimeCoordinatorExecutionId
        ),
        record
      );
      await this.syncHousekeepingAlarm();
    } catch (error) {
      console.warn(
        "[core.runtime_transport.interaction_inbox_repair_claim_failed]",
        {
          desiredStatus: record.desiredStatus,
          error: error instanceof Error ? error.message : String(error),
          interactionId: record.interaction.interactionId,
          runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
        }
      );
    }
  }
  private async deferRuntimeCoordinatorInteractionInboxRepair(
    record: RuntimeCoordinatorInteractionInboxRepairRecord
  ): Promise<void> {
    try {
      const storageKey =
        this.runtimeCoordinatorInteractionInboxRepairStorageKey(
          record.runtimeCoordinatorExecutionId
        );
      const existing =
        await this.ctx.storage.get<RuntimeCoordinatorInteractionInboxRepairRecord>(
          storageKey
        );
      if (
        existing &&
        !this.isSameRuntimeCoordinatorInteractionInboxRepairGeneration(
          existing,
          record
        ) &&
        !(
          existing.interaction.interactionId ===
            record.interaction.interactionId &&
          existing.desiredStatus === "open" &&
          record.desiredStatus === "resolved"
        )
      ) {
        return;
      }
      const attemptCount =
        existing &&
        this.isSameRuntimeCoordinatorInteractionInboxRepairGeneration(
          existing,
          record
        )
          ? existing.attemptCount + 1
          : record.attemptCount + 1;
      const delayIndex = Math.min(
        attemptCount - 1,
        RUNTIME_COORDINATOR_INTERACTION_INBOX_RETRY_DELAYS_MS.length - 1
      );
      const retryDelayMs =
        RUNTIME_COORDINATOR_INTERACTION_INBOX_RETRY_DELAYS_MS[delayIndex] ??
        RUNTIME_COORDINATOR_INTERACTION_INBOX_RETRY_DELAYS_MS.at(-1) ??
        300_000;
      const nowMs = Date.now();
      await this.ctx.storage.put(storageKey, {
        ...record,
        attemptCount,
        nextAttemptAtMs: nowMs + retryDelayMs,
        updatedAtMs: nowMs,
      } satisfies RuntimeCoordinatorInteractionInboxRepairRecord);
      await this.syncHousekeepingAlarm();
    } catch (error) {
      console.warn(
        "[core.runtime_transport.interaction_inbox_repair_schedule_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          interactionId: record.interaction.interactionId,
          runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
        }
      );
    }
  }
  private async removeRuntimeCoordinatorInteractionInboxRepair(
    record: Pick<
      RuntimeCoordinatorInteractionInboxRepairRecord,
      | "attemptCount"
      | "desiredStatus"
      | "interaction"
      | "runtimeCoordinatorExecutionId"
      | "updatedAtMs"
    >
  ): Promise<void> {
    const storageKey = this.runtimeCoordinatorInteractionInboxRepairStorageKey(
      record.runtimeCoordinatorExecutionId
    );
    try {
      const existing =
        await this.ctx.storage.get<RuntimeCoordinatorInteractionInboxRepairRecord>(
          storageKey
        );
      if (
        existing &&
        this.isSameRuntimeCoordinatorInteractionInboxRepairGeneration(
          existing,
          record
        )
      ) {
        await this.ctx.storage.delete(storageKey);
        await this.syncHousekeepingAlarm();
      }
    } catch (error) {
      console.warn(
        "[core.runtime_transport.interaction_inbox_repair_cleanup_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          interactionId: record.interaction.interactionId,
          runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
        }
      );
    }
  }
  private isSameRuntimeCoordinatorInteractionInboxRepairGeneration(
    left: RuntimeCoordinatorInteractionInboxRepairRecord,
    right: Pick<
      RuntimeCoordinatorInteractionInboxRepairRecord,
      "attemptCount" | "desiredStatus" | "interaction" | "updatedAtMs"
    >
  ): boolean {
    return (
      left.interaction.interactionId === right.interaction.interactionId &&
      left.desiredStatus === right.desiredStatus &&
      left.updatedAtMs === right.updatedAtMs &&
      left.attemptCount === right.attemptCount
    );
  }
  private runtimeCoordinatorInteractionInboxRepairStorageKey(
    runtimeCoordinatorExecutionId: string
  ): string {
    return `${RUNTIME_COORDINATOR_INTERACTION_INBOX_REPAIR_STORAGE_PREFIX}${runtimeCoordinatorExecutionId}`;
  }
  private async handleRuntimeCoordinatorWakeStopRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorWakeStopRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(
        buildWakeStopFailureResponse({
          reasonCode: "runtime_coordinator.wake_stop_request_invalid",
          runtimeCoordinatorExecutionId: null,
          status: "retry_later",
          targetProfileId: "unknown",
        }),
        { status: 400 }
      );
    }
    const response = await this.requestRuntimeCoordinatorWakeStop(parsed.data);
    const validated =
      runtimeTransportRuntimeCoordinatorWakeStopResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        buildWakeStopFailureResponse({
          reasonCode: "runtime_coordinator.wake_stop_response_invalid",
          runtimeCoordinatorExecutionId:
            parsed.data.runtimeCoordinatorExecutionId,
          status: "retry_later",
          targetProfileId: parsed.data.targetProfileId,
        }),
        { status: 500 }
      );
    }
    return Response.json(validated.data);
  }
  private async handleRuntimeCoordinatorPublicationWakeStopEligibilityRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorWakeStopRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(null, { status: 400 });
    }
    const input = parsed.data;
    const [commandState, authority] = await Promise.all([
      this.readRuntimeCoordinatorRunCommandState(
        input.runtimeCoordinatorExecutionId
      ),
      this.readRuntimeCoordinatorTokenAuthority(
        input.runtimeCoordinatorExecutionId
      ),
    ]);
    if (
      !(commandState && authority) ||
      authority.terminalOutcome ||
      commandState.localProgress.phase !== "result_received" ||
      !isRuntimeCoordinatorWakeStopCommandScopeMatch({ commandState, input }) ||
      !isRuntimeCoordinatorWakeStopTokenAuthorityScopeMatch({
        authority,
        input,
      })
    ) {
      return Response.json(null);
    }
    // This is a read-only stage projection. The existing Stop command still
    // validates the accepted inbox and elects the final Space publication.
    return Response.json(
      wakeStopEligibilityReadModelSchema.parse({
        controlMode: "openmeld_owned_publication_cancel",
        reasonCode: null,
        reliability: "openmeld_owned_publication",
        status: "eligible",
      })
    );
  }
  private async requestRuntimeCoordinatorWakeStop(
    input: RuntimeTransportRuntimeCoordinatorWakeStopRequest
  ): Promise<RuntimeTransportRuntimeCoordinatorWakeStopResponse> {
    const nowMs = Date.now();
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return buildWakeStopFailureResponse({
        reasonCode: "runtime_coordinator.wake_stop_store_unavailable",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "retry_later",
        targetProfileId: input.targetProfileId,
      });
    }
    const acceptedResultStop =
      await this.runSerializedRuntimeCoordinatorFinalizationToCompletion({
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        run: () =>
          this.stopAcceptedRuntimeCoordinatorResult({ db, input, nowMs }),
      }).catch(() =>
        buildWakeStopFailureResponse({
          reasonCode: "runtime_coordinator.wake_stop_store_unavailable",
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
          status: "retry_later",
          targetProfileId: input.targetProfileId,
        })
      );
    if (acceptedResultStop) {
      return acceptedResultStop;
    }
    const preparedStop =
      await this.prepareRuntimeCoordinatorWakeStopCommandState({
        input,
        nowMs,
      }).catch(() => null);
    if (!preparedStop) {
      return buildWakeStopFailureResponse({
        reasonCode: "runtime_coordinator.wake_stop_store_unavailable",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "retry_later",
        targetProfileId: input.targetProfileId,
      });
    }
    if (preparedStop.status !== "ready") {
      return buildRuntimeCoordinatorWakeStopPreparationFailureResponse({
        input,
        status: preparedStop.status,
      });
    }
    const currentCommandState = preparedStop.commandState;
    const projection = await readRuntimeCoordinatorExecutionProjectionById({
      db,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    }).catch(() => null);
    if (
      !(
        projection &&
        isRuntimeCoordinatorWakeStopScopeMatch({
          input,
          commandState: currentCommandState,
          projection,
        })
      )
    ) {
      return buildWakeStopFailureResponse({
        reasonCode: "runtime_coordinator.wake_stop_scope_missing",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "retry_later",
        targetProfileId: input.targetProfileId,
      });
    }
    if (projection.status === "cancelled") {
      return buildWakeStopSuccessResponse({
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "already_cancelled",
        targetProfileId: input.targetProfileId,
      });
    }
    if (
      projection.status === "reply_published" ||
      projection.status === "failed_terminal" ||
      projection.terminalOutcome !== null
    ) {
      return buildWakeStopFailureResponse({
        reasonCode: "runtime_coordinator.wake_stop_execution_terminal",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "not_stoppable",
        targetProfileId: input.targetProfileId,
      });
    }
    const reportDb = getPostgresDatabase(this.env);
    if (!reportDb) {
      return buildWakeStopFailureResponse({
        reasonCode: "runtime_coordinator.runtime_report_store_unavailable",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "retry_later",
        targetProfileId: input.targetProfileId,
      });
    }
    const agentControllerReport = await readCurrentRuntimeAgentControllerReport(
      {
        agentControllerRef: projection.agentControllerRef,
        db: reportDb,
        openMeldServiceRuntimeId: projection.openMeldServiceRuntimeId,
      }
    ).catch(() => null);
    const wakeStopEligibility = resolveWakeStopEligibility({
      agentControllerInterface:
        agentControllerReport?.agentControllerInterface ?? null,
    });
    if (wakeStopEligibility.status !== "eligible") {
      return buildWakeStopFailureResponse({
        reasonCode:
          wakeStopEligibility.reasonCode ??
          "agent_controller_interface.stop_unsupported",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "unsupported",
        targetProfileId: input.targetProfileId,
      });
    }
    const deliveryPreparation =
      await this.prepareRuntimeCoordinatorWakeStopDelivery({
        commandState: currentCommandState,
        controlMode: wakeStopEligibility.controlMode,
        db,
        input,
        nowMs,
        reliability: wakeStopEligibility.reliability,
      });
    if (deliveryPreparation.status === "response") {
      return deliveryPreparation.response;
    }
    const delivery = await this.deliverRuntimeCoordinatorWakeStopControlFrame({
      commandState: deliveryPreparation.commandState,
      controlMode: wakeStopEligibility.controlMode,
      input,
      nowMs,
      reliability: wakeStopEligibility.reliability,
    });
    if (!delivery.ok) {
      return buildWakeStopFailureResponse({
        reasonCode: delivery.reasonCode,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "retry_later",
        targetProfileId: input.targetProfileId,
      });
    }
    return buildWakeStopSuccessResponse({
      cancellationStateStatus: "delivery_pending",
      reasonCode: delivery.reasonCode,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      status: "cancellation_requested",
      targetProfileId: input.targetProfileId,
    });
  }
  private async stopAcceptedRuntimeCoordinatorResult(input: {
    db: PostgresDatabase;
    input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
    nowMs: number;
  }): Promise<RuntimeTransportRuntimeCoordinatorWakeStopResponse | null> {
    const request = input.input;
    const commandState = await this.readRuntimeCoordinatorRunCommandState(
      request.runtimeCoordinatorExecutionId
    );
    if (
      !commandState ||
      commandState.localProgress.phase !== "result_received"
    ) {
      return null;
    }
    const failure = (
      reasonCode: string,
      status: "retry_later" | "not_stoppable" = "retry_later"
    ) =>
      buildWakeStopFailureResponse({
        reasonCode,
        runtimeCoordinatorExecutionId: request.runtimeCoordinatorExecutionId,
        status,
        targetProfileId: request.targetProfileId,
      });
    const authority = await this.readRuntimeCoordinatorTokenAuthority(
      request.runtimeCoordinatorExecutionId
    );
    const projection = await readRuntimeCoordinatorExecutionProjectionById({
      db: input.db,
      runtimeCoordinatorExecutionId: request.runtimeCoordinatorExecutionId,
    });
    if (
      !(
        authority &&
        projection &&
        isRuntimeCoordinatorWakeStopScopeMatch({
          input: request,
          commandState,
          projection,
        }) &&
        isRuntimeCoordinatorWakeStopTokenAuthorityScopeMatch({
          authority,
          input: request,
        })
      )
    ) {
      return failure("runtime_coordinator.wake_stop_scope_missing");
    }
    const alreadyCancelled = authority.terminalOutcome?.status === "cancelled";
    if (
      (authority.terminalOutcome && !alreadyCancelled) ||
      hasNonCancelledFinalOutcome(projection)
    ) {
      return failure(
        "runtime_coordinator.wake_stop_execution_terminal",
        "not_stoppable"
      );
    }
    const result = await readDispatchResultInboxRecord(input.db, {
      attemptId: commandState.attemptId,
      dispatchId: request.dispatchId,
    });
    const run = authority.runsById[commandState.activeRunId];
    if (
      !(
        result &&
        run &&
        result.runtimeCoordinatorExecutionId ===
          request.runtimeCoordinatorExecutionId &&
        result.targetProfileId === request.targetProfileId &&
        result.executionTokenRunId === run.runId &&
        result.executionTokenFingerprint === run.tokenFingerprint &&
        [
          "result_accepted",
          "reply_publication_failed",
          "reply_suppressed_stopped",
        ].includes(result.publishState)
      )
    ) {
      return failure("runtime_coordinator.wake_stop_scope_missing");
    }
    // An accepted result has retired its local token. It still owns a cloud
    // publication obligation, and Stop must not depend on that old Service.
    // Reconstruct a legacy deleted command only from the exact accepted inbox
    // result and its existing dispatch fact; never execute the Agent again.
    const command = await this.prepareRuntimeCoordinatorFinalizationCommand({
      ...result,
      db: input.db,
      executionTokenRunId: run.runId,
      persistForReplay: false,
      runtimeCoordinatorExecutionId: request.runtimeCoordinatorExecutionId,
      spaceId: request.spaceId,
    });
    if (!command) {
      return failure("runtime_coordinator.finalization_command_missing");
    }
    const claim = await this.readRuntimeCoordinatorFinalizationClaim(command);
    if (!claim) {
      return failure("runtime_coordinator.stopped_publication_unavailable");
    }
    if (
      claim.status !== "unresolved" &&
      claim.status !== "wake_stopped_visible"
    ) {
      await this.reconcileAcceptedResultFinalClaim({
        claim,
        command,
        db: input.db,
        nowMs: input.nowMs,
      });
      return failure(
        "runtime_coordinator.wake_stop_execution_terminal",
        "not_stoppable"
      );
    }
    // The same per-execution serializer owns finalization and this Stop. Keep
    // its durable retry before recording the Stop fence, including old Wakes
    // whose former review path deleted both command and retry.
    await this.persistRuntimeCoordinatorFinalizationCommand({
      command,
      db: input.db,
    });
    await this.writeRuntimeCoordinatorRunCommandState({
      ...commandState,
      lastCommandReasonCode:
        RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
      stopReason: commandState.stopReason ?? request.reason ?? null,
      updatedAtMs: input.nowMs,
    });
    try {
      await this.suppressRuntimeCoordinatorFinalizationAfterWakeStop({
        command,
        db: input.db,
      });
    } catch (error) {
      this.warnRuntimeCoordinatorPublicationRepairFailure({
        command,
        error,
        event: "[core.runtime_transport.accepted_wake_stop_repair_pending]",
      });
      return failure("runtime_coordinator.stopped_publication_unavailable");
    }
    const publication =
      await this.readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        buildRuntimeCoordinatorWakeStoppedNoticePublicationId(
          request.runtimeCoordinatorExecutionId
        )
      );
    if (publication?.status !== "published") {
      const settledClaim =
        await this.readRuntimeCoordinatorFinalizationClaim(command);
      if (
        settledClaim?.status === "finalization_visible" ||
        settledClaim?.status === "publication_failed_visible"
      ) {
        return failure(
          "runtime_coordinator.wake_stop_execution_terminal",
          "not_stoppable"
        );
      }
      return failure("runtime_coordinator.stopped_publication_unavailable");
    }
    return buildWakeStopSuccessResponse({
      runtimeCoordinatorExecutionId: request.runtimeCoordinatorExecutionId,
      status: alreadyCancelled ? "already_cancelled" : "cancelled",
      targetProfileId: request.targetProfileId,
    });
  }
  private async prepareRuntimeCoordinatorWakeStopDelivery(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    controlMode: RuntimeCoordinatorWakeStopControlMode;
    db: PostgresDatabase;
    input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
    nowMs: number;
    reliability: RuntimeCoordinatorWakeStopControlReliability;
  }): Promise<
    | {
        commandState: RuntimeCoordinatorRunCommandState;
        status: "ready";
      }
    | {
        response: RuntimeTransportRuntimeCoordinatorWakeStopResponse;
        status: "response";
      }
  > {
    const currentStop =
      await this.readCurrentRuntimeCoordinatorWakeStopCommandState({
        commandState: input.commandState,
        input: input.input,
      });
    if (currentStop.status !== "ready") {
      return {
        response: buildRuntimeCoordinatorWakeStopPreparationFailureResponse({
          input: input.input,
          status: currentStop.status,
        }),
        status: "response",
      };
    }
    const currentProjection =
      await readRuntimeCoordinatorExecutionProjectionById({
        db: input.db,
        runtimeCoordinatorExecutionId:
          input.input.runtimeCoordinatorExecutionId,
      }).catch(() => null);
    const projectionResponse =
      resolveRuntimeCoordinatorWakeStopProjectionResponse({
        commandState: currentStop.commandState,
        input: input.input,
        projection: currentProjection,
      });
    if (projectionResponse) {
      return { response: projectionResponse, status: "response" };
    }
    if (currentProjection?.status !== "cancellation_requested") {
      const projectionWrite = await writeRuntimeCoordinatorExecutionProjection({
        db: input.db,
        record: buildRuntimeCoordinatorExecutionRecordFromCommandState({
          commandState: currentStop.commandState,
          nowMs: input.nowMs,
          status: "cancellation_requested",
        }),
      });
      if (projectionWrite === "skipped_stale") {
        return {
          response:
            await this.resolveRacedRuntimeCoordinatorWakeStopResponse(input),
          status: "response",
        };
      }
      await writeRuntimeCoordinatorExecutionEventFromParts({
        db: input.db,
        eventType: "cancellation_requested",
        idempotencyKey: `wake-stop-requested:${input.input.runtimeCoordinatorExecutionId}`,
        observedAtMs: input.nowMs,
        payload: {
          controlMode: input.controlMode,
          reason: input.input.reason ?? null,
          reliability: input.reliability,
          source: "space_wake_stop",
        },
        reasonCode: RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
        runtimeCoordinatorExecutionId:
          input.input.runtimeCoordinatorExecutionId,
        statusAfter: "cancellation_requested",
      });
    }
    const deliverableStop =
      await this.readCurrentRuntimeCoordinatorWakeStopCommandState({
        commandState: currentStop.commandState,
        input: input.input,
      });
    return deliverableStop.status === "ready"
      ? deliverableStop
      : {
          response: buildRuntimeCoordinatorWakeStopPreparationFailureResponse({
            input: input.input,
            status: deliverableStop.status,
          }),
          status: "response",
        };
  }
  private async resolveRacedRuntimeCoordinatorWakeStopResponse(input: {
    db: PostgresDatabase;
    input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
  }): Promise<RuntimeTransportRuntimeCoordinatorWakeStopResponse> {
    const racedProjection = await readRuntimeCoordinatorExecutionProjectionById(
      {
        db: input.db,
        runtimeCoordinatorExecutionId:
          input.input.runtimeCoordinatorExecutionId,
      }
    ).catch(() => null);
    return racedProjection?.status === "cancelled"
      ? buildWakeStopSuccessResponse({
          runtimeCoordinatorExecutionId:
            input.input.runtimeCoordinatorExecutionId,
          status: "already_cancelled",
          targetProfileId: input.input.targetProfileId,
        })
      : buildWakeStopFailureResponse({
          reasonCode: "runtime_coordinator.wake_stop_state_changed",
          runtimeCoordinatorExecutionId:
            input.input.runtimeCoordinatorExecutionId,
          status: "retry_later",
          targetProfileId: input.input.targetProfileId,
        });
  }
  private async prepareRuntimeCoordinatorWakeStopCommandState(input: {
    input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
    nowMs: number;
  }): Promise<
    | {
        commandState: RuntimeCoordinatorRunCommandState;
        pendingInteraction: RuntimeCoordinatorPendingAgentInteractionState | null;
        status: "ready";
      }
    | {
        status: "scope_missing" | "terminal";
      }
  > {
    const prepared = await this.ctx.storage.transaction(async (transaction) => {
      const [commandState, authority] = await Promise.all([
        readRuntimeCoordinatorRunCommandStateFromStorage(
          transaction,
          input.input.runtimeCoordinatorExecutionId
        ),
        readRuntimeCoordinatorTokenAuthorityFromStorage(
          transaction,
          input.input.runtimeCoordinatorExecutionId
        ),
      ]);
      if (
        !(
          commandState &&
          isRuntimeCoordinatorWakeStopCommandScopeMatch({
            commandState,
            input: input.input,
          })
        ) ||
        (authority &&
          !isRuntimeCoordinatorWakeStopTokenAuthorityScopeMatch({
            authority,
            input: input.input,
          }))
      ) {
        return { status: "scope_missing" as const };
      }
      const activeTokenRun = authority?.currentRunId
        ? authority.runsById[authority.currentRunId]
        : null;
      if (
        authority &&
        (authority.terminalOutcome !== null ||
          !activeTokenRun ||
          activeTokenRun.tokenStatus !== "active")
      ) {
        return { status: "terminal" as const };
      }
      const stopReason = commandState.stopReason ?? input.input.reason ?? null;
      const pendingInteraction = commandState.pendingInteraction ?? null;
      const nextCommandState: RuntimeCoordinatorRunCommandState = {
        ...commandState,
        lastCommandReasonCode:
          RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
        ...(pendingInteraction && !pendingInteraction.response
          ? {
              pendingInteraction: {
                ...pendingInteraction,
                respondedAtMs: input.nowMs,
                response: { kind: "cancel" as const },
              },
            }
          : {}),
        stopReason,
        updatedAtMs: input.nowMs,
      };
      await writeRuntimeCoordinatorRunCommandStateInTransaction(
        transaction,
        nextCommandState
      );
      return {
        commandState: nextCommandState,
        pendingInteraction:
          pendingInteraction && !pendingInteraction.response
            ? pendingInteraction
            : null,
        status: "ready" as const,
      };
    });
    if (prepared.status !== "ready") {
      return prepared;
    }
    const { commandState, pendingInteraction } = prepared;
    if (pendingInteraction && !pendingInteraction.response) {
      await this.tryResolveRuntimeCoordinatorInteractionInboxItem({
        commandState,
        interaction: pendingInteraction.request,
        resolvedAtMs: input.nowMs,
      });
      this.tryDeliverRuntimeCoordinatorInteractionResponse(commandState);
    }
    return prepared;
  }
  private async readCurrentRuntimeCoordinatorWakeStopCommandState(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
  }): Promise<
    | {
        commandState: RuntimeCoordinatorRunCommandState;
        status: "ready";
      }
    | {
        status: "scope_missing" | "terminal";
      }
  > {
    return await this.ctx.storage.transaction(async (transaction) => {
      const [commandState, authority] = await Promise.all([
        readRuntimeCoordinatorRunCommandStateFromStorage(
          transaction,
          input.input.runtimeCoordinatorExecutionId
        ),
        readRuntimeCoordinatorTokenAuthorityFromStorage(
          transaction,
          input.input.runtimeCoordinatorExecutionId
        ),
      ]);
      if (
        !(
          commandState &&
          isRuntimeCoordinatorWakeStopCommandScopeMatch({
            commandState,
            input: input.input,
          })
        ) ||
        commandState.activeRunId !== input.commandState.activeRunId ||
        commandState.attemptId !== input.commandState.attemptId
      ) {
        return { status: "scope_missing" as const };
      }
      const activeTokenRun = authority?.currentRunId
        ? authority.runsById[authority.currentRunId]
        : null;
      if (
        (authority &&
          (authority.terminalOutcome !== null ||
            authority.currentRunId !== commandState.activeRunId ||
            !activeTokenRun ||
            activeTokenRun.tokenStatus !== "active")) ||
        ![
          RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
          "runtime_coordinator.wake_stop_delivery_pending",
        ].includes(commandState.lastCommandReasonCode ?? "")
      ) {
        return { status: "terminal" as const };
      }
      return { commandState, status: "ready" as const };
    });
  }
  private async markRuntimeCoordinatorWakeStopDeliveryReason(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    nowMs: number;
    reasonCode: string;
  }): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      const current = await readRuntimeCoordinatorRunCommandStateFromStorage(
        transaction,
        input.commandState.runtimeCoordinatorExecutionId
      );
      if (
        !current ||
        current.activeRunId !== input.commandState.activeRunId ||
        current.attemptId !== input.commandState.attemptId ||
        current.lastCommandReasonCode !==
          RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE
      ) {
        return;
      }
      await writeRuntimeCoordinatorRunCommandStateInTransaction(transaction, {
        ...current,
        lastCommandReasonCode: input.reasonCode,
        updatedAtMs: input.nowMs,
      });
    });
  }
  private async deliverRuntimeCoordinatorWakeStopControlFrame(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    controlMode: RuntimeCoordinatorWakeStopControlMode;
    input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
    nowMs: number;
    reliability: RuntimeCoordinatorWakeStopControlReliability;
  }): Promise<
    | {
        ok: true;
        reasonCode: string;
        requestId: string;
      }
    | {
        ok: false;
        reasonCode: string;
        requestId: string | null;
      }
  > {
    const requestId = buildRuntimeCoordinatorWakeStopControlRequestId(
      input.input.runtimeCoordinatorExecutionId
    );
    const sessionResolution =
      this.resolveRuntimeCoordinatorWakeStopControlSession({
        commandState: input.commandState,
        controlMode: input.controlMode,
      });
    if (!sessionResolution.ok) {
      await this.recordRuntimeCoordinatorWakeStopDeliveryEvent({
        commandState: input.commandState,
        controlMode: input.controlMode,
        eventType: "cancellation_delivery_rejected",
        nowMs: input.nowMs,
        reasonCode: sessionResolution.reasonCode,
        reliability: input.reliability,
        requestId,
      });
      return {
        ok: false,
        reasonCode: sessionResolution.reasonCode,
        requestId,
      };
    }
    const payload = buildRuntimeCoordinatorWakeStopControlFramePayload({
      commandState: input.commandState,
      controlMode: input.controlMode,
      reason: input.input.reason ?? null,
      requestId,
    });
    try {
      this.sendFrame(sessionResolution.session.socket, {
        code:
          input.controlMode === "cancel"
            ? "daemon.local_agent_control.cancel"
            : "daemon.local_agent_control.interrupt",
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch (error) {
      const reasonCode = "runtime_coordinator.wake_stop_delivery_send_failed";
      await this.recordRuntimeCoordinatorWakeStopDeliveryEvent({
        commandState: input.commandState,
        controlMode: input.controlMode,
        eventType: "cancellation_delivery_rejected",
        nowMs: input.nowMs,
        reasonCode,
        reliability: input.reliability,
        requestId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reasonCode, requestId };
    }
    const reasonCode = "runtime_coordinator.wake_stop_delivery_pending";
    await this.recordRuntimeCoordinatorWakeStopDeliveryEvent({
      commandState: input.commandState,
      controlMode: input.controlMode,
      eventType: "cancellation_delivery_accepted",
      nowMs: input.nowMs,
      reasonCode,
      reliability: input.reliability,
      requestId,
    });
    await this.markRuntimeCoordinatorWakeStopDeliveryReason({
      commandState: input.commandState,
      nowMs: input.nowMs,
      reasonCode,
    });
    return { ok: true, reasonCode, requestId };
  }
  private async handleRuntimeCoordinatorDecisionRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportRuntimeCoordinatorDecisionRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          reasonCode: "runtime_coordinator.decision_request_invalid",
          runtimeCoordinatorExecutionId: "invalid",
          status: "retry_later",
        } satisfies RuntimeTransportRuntimeCoordinatorDecisionResponse,
        { status: 400 }
      );
    }
    const response = await this.decideRuntimeCoordinatorExecutionProgress(
      parsed.data
    );
    const validated =
      runtimeTransportRuntimeCoordinatorDecisionResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        {
          ok: false,
          reasonCode: "runtime_coordinator.decision_response_invalid",
          runtimeCoordinatorExecutionId:
            parsed.data.runtimeCoordinatorExecutionId,
          status: "retry_later",
        } satisfies RuntimeTransportRuntimeCoordinatorDecisionResponse,
        { status: 500 }
      );
    }
    return Response.json(validated.data, {
      status: validated.data.ok ? 200 : 409,
    });
  }
  private async decideRuntimeCoordinatorExecutionProgress(
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest,
    options?: {
      skipProjectionRead?: boolean;
    }
  ): Promise<RuntimeTransportRuntimeCoordinatorDecisionResponse> {
    const existingDecision = await this.readRuntimeCoordinatorDecisionByKey({
      idempotencyKey: input.idempotencyKey,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    });
    if (
      existingDecision &&
      !isRuntimeCoordinatorReevaluatableDecisionAction(existingDecision.action)
    ) {
      return {
        ok: true,
        action: existingDecision.action,
        reasonCode: existingDecision.reasonCode,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "already_recorded",
      };
    }
    const nowMs = Date.now();
    const { authorityRead, projection } =
      await this.readRuntimeCoordinatorDecisionInputs(input, options);
    if (authorityRead.status === "unavailable") {
      return {
        ok: false,
        reasonCode: authorityRead.reasonCode,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "retry_later",
      };
    }
    const authority = authorityRead.authority;
    if (!authority) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.execution_token_authority_missing",
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        status: "retry_later",
      };
    }
    const scopeMismatchReason =
      resolveRuntimeCoordinatorDecisionScopeMismatchReason({
        authority,
        input,
      });
    if (scopeMismatchReason) {
      return await this.recordRuntimeCoordinatorDiagnosticDecision({
        authority,
        input,
        nowMs,
        projection,
        reasonCode: scopeMismatchReason,
        statusAfter: null,
      });
    }
    const diagnosticDecision =
      resolveRuntimeCoordinatorTokenAwareExecutionDecision({
        authority,
        eventKind: input.eventKind,
        observedRunId: input.observedRunId ?? null,
        trigger: input.trigger,
      });
    const terminalProjectionLocked =
      projection?.status === "reply_published" ||
      projection?.status === "cancelled" ||
      projection?.status === "failed_terminal" ||
      authority?.terminalOutcome != null;
    if (
      terminalProjectionLocked ||
      diagnosticDecision.coordinatorAction === "record_diagnostic_only" ||
      input.eventKind === "owner_conflict"
    ) {
      return await this.recordRuntimeCoordinatorDiagnosticDecision({
        authority,
        input,
        nowMs,
        projection,
        reasonCode: terminalProjectionLocked
          ? "execution_token_terminal_late"
          : diagnosticDecision.reasonCode,
        statusAfter: projection?.status ?? null,
      });
    }
    if (
      input.eventKind === "retry" ||
      input.eventKind === "reclaim" ||
      input.eventKind === "timeout"
    ) {
      return await this.recordRuntimeCoordinatorRedeliveryDecision({
        authority,
        diagnosticReasonCode: diagnosticDecision.reasonCode,
        input,
        nowMs,
        projection,
      });
    }
    return await this.recordRuntimeCoordinatorTerminalDecision({
      authority,
      input,
      nowMs,
      projection,
    });
  }
  private async readRuntimeCoordinatorDecisionInputs(
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest,
    options?: {
      skipProjectionRead?: boolean;
    }
  ): Promise<{
    authorityRead: RuntimeCoordinatorDecisionAuthorityRead;
    projection: RuntimeCoordinatorExecutionRecord | null;
  }> {
    const decisionInputsDb = getPostgresDatabase(this.env);
    const [authorityRead, projection] = await Promise.all([
      this.readRuntimeCoordinatorTokenAuthorityForDecision(
        input.runtimeCoordinatorExecutionId
      ),
      decisionInputsDb && !options?.skipProjectionRead
        ? readRuntimeCoordinatorExecutionProjectionById({
            db: decisionInputsDb,
            runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { authorityRead, projection };
  }
  private async recordRuntimeCoordinatorDiagnosticDecision(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest;
    nowMs: number;
    projection: RuntimeCoordinatorExecutionRecord | null;
    reasonCode: string;
    statusAfter: RuntimeCoordinatorExecutionStatus | null;
  }): Promise<RuntimeTransportRuntimeCoordinatorDecisionResponse> {
    return await this.recordRuntimeCoordinatorDurableDecision({
      action: "diagnostic_only",
      authority: input.authority,
      eventType: "runtime_coordinator_decision_recorded",
      input: input.input,
      nowMs: input.nowMs,
      projection: input.projection,
      reasonCode: input.reasonCode,
      statusAfter: input.statusAfter,
    });
  }
  private async recordRuntimeCoordinatorRedeliveryDecision(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    diagnosticReasonCode: string;
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest;
    nowMs: number;
    projection: RuntimeCoordinatorExecutionRecord | null;
  }): Promise<RuntimeTransportRuntimeCoordinatorDecisionResponse> {
    const redelivery = await this.redeliverRuntimeCoordinatorCurrentRun({
      authority: input.authority,
      decision: input.input,
      nowMs: input.nowMs,
      reasonCode: input.input.reasonCode ?? input.diagnosticReasonCode,
    });
    if (!redelivery.ok && redelivery.terminal) {
      return await this.recordRuntimeCoordinatorDeliveryExpiredDecision({
        authority: input.authority,
        commandState: redelivery.commandState,
        expiryCause: redelivery.expiryCause,
        input: input.input,
        nowMs: input.nowMs,
        projection: input.projection,
      });
    }
    return await this.recordRuntimeCoordinatorDurableDecision({
      action: resolveRuntimeCoordinatorRedeliveryAction(redelivery),
      authority: input.authority,
      eventType: redelivery.ok
        ? "runtime_coordinator_redelivery_commanded"
        : "runtime_coordinator_decision_recorded",
      input: input.input,
      nowMs: input.nowMs,
      projection: input.projection,
      reasonCode: redelivery.reasonCode,
      statusAfter: input.projection?.status ?? null,
    });
  }
  private async recordRuntimeCoordinatorDeliveryExpiredDecision(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    commandState: RuntimeCoordinatorRunCommandState;
    expiryCause: RuntimeCoordinatorRunExpiryCause;
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest;
    nowMs: number;
    projection: RuntimeCoordinatorExecutionRecord | null;
  }): Promise<RuntimeTransportRuntimeCoordinatorDecisionResponse> {
    const terminalPlan = resolveRuntimeCoordinatorLostRunTerminalPlan(
      input.expiryCause
    );
    const lostRunReasonCode = resolveRuntimeCoordinatorLostRunReasonCode(
      input.expiryCause
    );
    const prePublicationAuthority =
      settleRuntimeCoordinatorAuthorityForTerminalDecision({
        authority: input.authority,
        nowMs: input.nowMs,
        plan: terminalPlan,
        replySignalId: null,
      });
    await this.writeRuntimeCoordinatorTokenAuthority(prePublicationAuthority);
    await this.writeRuntimeCoordinatorTerminalProjection({
      authority: prePublicationAuthority,
      input: input.input,
      nowMs: input.nowMs,
      projection: input.projection,
      reasonCode: terminalPlan.reasonCode,
      terminalOutcomeKind: terminalPlan.terminalOutcomeKind,
    });
    await this.recordRuntimeCoordinatorDeliveryExpiredReadinessImpact({
      commandState: input.commandState,
      nowMs: input.nowMs,
      reasonCode: terminalPlan.reasonCode,
    });
    if (input.expiryCause === "controller_conversation_occupied") {
      await this.requestRuntimeCoordinatorLocalAttemptWithdrawal({
        commandState: input.commandState,
        controlReason: "controller_conversation_occupied_timeout",
        nowMs: input.nowMs,
        reasonCode:
          RUNTIME_COORDINATOR_LOCAL_ATTEMPT_WITHDRAWAL_OCCUPANCY_TERMINAL_REASON_CODE,
      });
    }
    const stopCause = this.state.sessionsById.get(
      input.commandState.sanitizedDeliveryRequest.daemonSessionId
    )?.stopCause;
    const publication =
      await this.publishRuntimeCoordinatorDeliveryExpiredFailure({
        commandState: input.commandState,
        nowMs: input.nowMs,
        stopCause,
        reasonCode: lostRunReasonCode,
      });
    const finalAuthority = publication.ok
      ? withRuntimeCoordinatorTerminalReplySignalId({
          authority: prePublicationAuthority,
          replySignalId: publication.publishedSignalId,
        })
      : prePublicationAuthority;
    if (finalAuthority !== prePublicationAuthority) {
      await this.writeRuntimeCoordinatorTokenAuthority(finalAuthority);
    }
    if (!publication.ok) {
      await this.writeRuntimeCoordinatorPublicationBlocker({
        blockerId: `${resolveRuntimeCoordinatorLostRunPublicationPresentation(lostRunReasonCode).blockerSlug}:${input.commandState.runtimeCoordinatorExecutionId}`,
        blockerKind: "publication_unavailable",
        db: getPostgresDatabase(this.env),
        dispatchId: input.commandState.dispatchId,
        nowMs: input.nowMs,
        publicationKind: "failure_notice",
        reasonCode: publication.reasonCode,
        runtimeCoordinatorExecutionId:
          input.commandState.runtimeCoordinatorExecutionId,
        spaceId: input.commandState.sanitizedDeliveryRequest.payload.spaceId,
        targetProfileId: input.commandState.targetProfileId,
        targetWakeLifecycleId: null,
      });
    }
    return await this.recordRuntimeCoordinatorDurableDecision({
      action: terminalPlan.action,
      authority: finalAuthority,
      eventType: terminalPlan.eventType,
      eventPayload: {
        ...buildRuntimeCoordinatorRunExpiryEventPayload({
          commandState: input.commandState,
          expiryCause: input.expiryCause,
          publication,
        }),
        ...(stopCause ? { stopCause } : {}),
      },
      input: input.input,
      nowMs: input.nowMs,
      projection: input.projection,
      reasonCode: terminalPlan.reasonCode,
      statusAfter: "failed_terminal",
    });
  }
  private async recordRuntimeCoordinatorDeliveryExpiredReadinessImpact(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    nowMs: number;
    reasonCode: RuntimeCoordinatorTerminalDecisionPlan["reasonCode"];
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    const readinessImpactDb = getPostgresDatabase(this.env);
    if (!(db && readinessImpactDb)) {
      return;
    }
    const executionIdentity =
      input.commandState.sanitizedDeliveryRequest.payload.executionIdentity
        .core;
    try {
      const result = await writeAgentExecutionReadinessImpact({
        agentProfileId: input.commandState.targetProfileId,
        // readiness impacts live in openmeld-local-state, not wake-evidence
        db: readinessImpactDb,
        executionIdentity: {
          bindingId: executionIdentity.bindingId,
          agentControllerRef: executionIdentity.agentControllerRef,
          openMeldServiceRuntimeId:
            executionIdentity.openMeldServiceRuntimeId.value,
        },
        observedAtMs: input.nowMs,
        reasonCode: input.reasonCode,
        sourceAttemptId: input.commandState.attemptId,
        sourceDispatchId: input.commandState.dispatchId,
      });
      if (result === "written") {
        console.info(
          "[core.runtime_transport.runtime_coordinator_delivery_expired_readiness_impact_written]",
          {
            agentProfileId: input.commandState.targetProfileId,
            attemptId: input.commandState.attemptId,
            dispatchId: input.commandState.dispatchId,
            reasonCode: input.reasonCode,
            runtimeCoordinatorExecutionId:
              input.commandState.runtimeCoordinatorExecutionId,
          }
        );
        return;
      }
      console.warn(
        "[core.runtime_transport.runtime_coordinator_delivery_expired_readiness_impact_not_applicable]",
        {
          agentProfileId: input.commandState.targetProfileId,
          attemptId: input.commandState.attemptId,
          dispatchId: input.commandState.dispatchId,
          reasonCode: input.reasonCode,
          runtimeCoordinatorExecutionId:
            input.commandState.runtimeCoordinatorExecutionId,
        }
      );
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_delivery_expired_readiness_impact_write_failed]",
        {
          agentProfileId: input.commandState.targetProfileId,
          attemptId: input.commandState.attemptId,
          dispatchId: input.commandState.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode: input.reasonCode,
          runtimeCoordinatorExecutionId:
            input.commandState.runtimeCoordinatorExecutionId,
        }
      );
    }
  }
  private async publishRuntimeCoordinatorDeliveryExpiredFailure(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    nowMs: number;
    stopCause?: RuntimeTransportStopCause;
    reasonCode: RuntimeCoordinatorLostRunTerminalReasonCode;
  }): Promise<
    | {
        ok: true;
        publishedSignalId: string;
      }
    | {
        ok: false;
        reasonCode: "runtime_coordinator.failure_publication_unavailable";
      }
  > {
    const request = input.commandState.sanitizedDeliveryRequest;
    const payload = request.payload;
    const presentation =
      resolveRuntimeCoordinatorLostRunPublicationPresentation(input.reasonCode);
    const text = buildSystemNoticeText({
      actorName:
        payload.targetProfileName ?? payload.targetProfileMentionLabel ?? null,
      noticeType: "terminal_failure",
      variant: presentation.noticeVariant,
    });
    const publicationSlug = presentation.blockerSlug;
    try {
      const signal = await emitSpaceSystemNoticeSignal({
        env: this.env,
        finalOutcomeAuthority: "approved_compatibility",
        spaceId: payload.spaceId,
        profile: {
          kind: "system",
          profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
          profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
        },
        data: {
          noticeType: "terminal_failure",
          actorProfileId: payload.targetProfileId,
          coreReadinessFactsChanged: {
            agentProfileId: payload.targetProfileId,
            kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
          },
          ...(payload.targetProfileName
            ? { actorName: payload.targetProfileName }
            : {}),
          dispatchId: payload.dispatchId,
          generatedBy: "openmeld",
          reason: input.reasonCode,
          reasonCode: input.reasonCode,
          // The Wake never produced a settled agent outcome (delivery
          // expired or local progress went stale), so this is an execution
          // failure, not a broken reply publication.
          failureStage: "execution",
          ...(input.stopCause ? { stopCause: input.stopCause } : {}),
          ...(payload.replyToSnapshot
            ? { replyTo: payload.replyToSnapshot }
            : {}),
          text,
        },
        spaceAccess: createDispatchContinuationSpaceAccessContext({
          attemptId: request.attemptId,
          dispatchId: request.dispatchId,
          password: payload.spacePassword ?? null,
          requestContext: {
            actorContext: {
              requestId: `runtime-coordinator-${publicationSlug}-${request.dispatchId}`,
              openMeldProfileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
              profileKind: "system",
              profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
              ...(payload.dispatchChainId
                ? { dispatchChainId: payload.dispatchChainId }
                : {}),
              ...(typeof payload.autoRelayDepth === "number"
                ? { autoRelayDepth: payload.autoRelayDepth }
                : {}),
              ...(payload.visitedProfileIds
                ? { visitedProfileIds: payload.visitedProfileIds }
                : {}),
              ...(payload.visitedProfileIdsHash
                ? { visitedProfileIdsHash: payload.visitedProfileIdsHash }
                : {}),
            },
          },
          sourceSignalId: payload.sourceEventId,
          spaceId: payload.spaceId,
          targetProfileId: payload.targetProfileId,
        }),
        ...(payload.threadContext
          ? { threadContext: payload.threadContext }
          : {}),
      });
      const task = this.buildRuntimeCoordinatorSpaceWakeAgentTaskHandle(
        input.commandState
      );
      if (task) {
        const delivery =
          await upsertRuntimeCoordinatorAgentTaskObservationDelivery(
            this.ctx.storage,
            {
              nowMs: input.nowMs,
              observation: {
                errorCode: input.reasonCode,
                eventId: `runtime-coordinator-terminal:${input.commandState.runtimeCoordinatorExecutionId}`,
                occurredAtMs: input.nowMs,
                publishedSignalId: signal.id,
                status: "failed",
              },
              runtimeCoordinatorExecutionId:
                input.commandState.runtimeCoordinatorExecutionId,
              task,
            }
          );
        await this.enqueueRuntimeCoordinatorAgentTaskObservationRedrive({
          delivery,
          ownerUserId: input.commandState.ownerUserId,
        });
        const projected =
          await this.tryProjectRuntimeCoordinatorAgentTaskObservationDelivery(
            delivery
          );
        if (projected) {
          this.queueHousekeepingAlarmSync();
        } else {
          await this.syncHousekeepingAlarm();
        }
      }
      return {
        ok: true,
        publishedSignalId: signal.id,
      };
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_delivery_expired_publication_failed]",
        {
          dispatchId: request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId:
            input.commandState.runtimeCoordinatorExecutionId,
        }
      );
      return {
        ok: false,
        reasonCode: "runtime_coordinator.failure_publication_unavailable",
      };
    }
  }
  private async projectRuntimeCoordinatorStoppedTaskOutcome(input: {
    record: RuntimeCoordinatorWakeStoppedNoticePublicationRecord;
    sourceClientMessageId: string | null;
  }): Promise<void> {
    const sourceClientMessageId =
      normalizeOptionalText(input.sourceClientMessageId) ??
      normalizeOptionalText(input.record.taskOutcomeSourceClientMessageId);
    if (
      !(
        sourceClientMessageId &&
        input.record.status === "published" &&
        input.record.publishedSignalId
      )
    ) {
      return;
    }
    if (typeof input.record.taskOutcomeProjectedAtMs === "number") {
      return;
    }
    await recordRuntimeCoordinatorStoppedTaskOutcome({
      db: getPostgresDatabase(this.env),
      env: this.env,
      eventId: input.record.publicationId,
      occurredAtMs: input.record.updatedAtMs,
      publishedSignalId: input.record.publishedSignalId,
      reasonCode: input.record.reasonCode,
      sourceClientMessageId,
      spaceId: input.record.spaceId,
      targetProfileId: input.record.targetProfileId,
    });
    await this.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord({
      ...input.record,
      taskOutcomeProjectedAtMs: Date.now(),
      taskOutcomeSourceClientMessageId: sourceClientMessageId,
    });
  }
  private async publishRuntimeCoordinatorWakeStoppedNotice(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    nowMs: number;
    reasonCode: string;
    stopReason?: string | null;
  }): Promise<RuntimeCoordinatorWakeStoppedNoticePublicationResult> {
    const publicationId = buildRuntimeCoordinatorWakeStoppedNoticePublicationId(
      input.commandState.runtimeCoordinatorExecutionId
    );
    const existing =
      await this.readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        publicationId
      );
    if (existing?.status === "published" && existing.publishedSignalId) {
      await this.projectRuntimeCoordinatorStoppedTaskOutcome({
        record: existing,
        sourceClientMessageId: input.commandState.sourceClientMessageId,
      });
      return {
        ok: true,
        publishedSignalId: existing.publishedSignalId,
        status: "already_visible",
      };
    }
    const request = input.commandState.sanitizedDeliveryRequest;
    const payload = request.payload;
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: input.commandState.sourceClientMessageId,
      dispatchId: request.dispatchId,
      sourceSignalId: payload.sourceEventId,
      spaceId: payload.spaceId,
      targetProfileId: payload.targetProfileId,
    });
    const text = buildSystemNoticeText({
      actorName:
        payload.targetProfileMentionLabel?.trim() ||
        payload.targetProfileName?.trim() ||
        null,
      noticeType: "wake_stopped",
      variant:
        input.stopReason === DELETED_AGENT_PROFILE_WAKE_STOP_REASON
          ? "agent_profile_deleted"
          : undefined,
    });
    let publicationRecord: RuntimeCoordinatorWakeStoppedNoticePublicationRecord;
    let publishedSignalId: string;
    try {
      const signal = await emitSpaceSystemNoticeSignal({
        env: this.env,
        finalOutcomeAuthority: "runtime_coordinator_wake_stop_publication",
        spaceId: payload.spaceId,
        profile: {
          kind: "system",
          profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
          profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
        },
        data: {
          noticeType: "wake_stopped",
          actorProfileId: payload.targetProfileId,
          ...(payload.targetProfileName
            ? { actorName: payload.targetProfileName }
            : {}),
          dispatchId: payload.dispatchId,
          generatedBy: "openmeld",
          reason: input.stopReason ?? input.reasonCode,
          reasonCode: input.reasonCode,
          ...(payload.replyToSnapshot
            ? { replyTo: payload.replyToSnapshot }
            : {}),
          text,
        },
        spaceAccess: createDispatchContinuationSpaceAccessContext({
          attemptId: request.attemptId,
          dispatchId: request.dispatchId,
          password: payload.spacePassword ?? null,
          requestContext: {
            actorContext: {
              requestId: `runtime-coordinator-wake-stopped-${request.dispatchId}`,
              openMeldProfileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
              profileKind: "system",
              profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
              ...(payload.dispatchChainId
                ? { dispatchChainId: payload.dispatchChainId }
                : {}),
              ...(typeof payload.autoRelayDepth === "number"
                ? { autoRelayDepth: payload.autoRelayDepth }
                : {}),
              ...(payload.visitedProfileIds
                ? { visitedProfileIds: payload.visitedProfileIds }
                : {}),
              ...(payload.visitedProfileIdsHash
                ? { visitedProfileIdsHash: payload.visitedProfileIdsHash }
                : {}),
            },
          },
          sourceSignalId: payload.sourceEventId,
          spaceId: payload.spaceId,
          targetProfileId: payload.targetProfileId,
        }),
        ...(payload.threadContext
          ? { threadContext: payload.threadContext }
          : {}),
      });
      publicationRecord = {
        createdAtMs: existing?.createdAtMs ?? input.nowMs,
        dispatchId: request.dispatchId,
        modelVersion:
          RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
        publicationId,
        publishedSignalId: signal.id,
        reasonCode: input.reasonCode,
        runtimeCoordinatorExecutionId:
          input.commandState.runtimeCoordinatorExecutionId,
        spaceId: payload.spaceId,
        status: "published",
        taskOutcomeProjectedAtMs: null,
        taskOutcomeSourceClientMessageId:
          input.commandState.sourceClientMessageId,
        targetProfileId: payload.targetProfileId,
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
        updatedAtMs: input.nowMs,
      } satisfies RuntimeCoordinatorWakeStoppedNoticePublicationRecord;
      await this.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        publicationRecord
      );
      publishedSignalId = signal.id;
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_wake_stopped_publication_failed]",
        {
          dispatchId: request.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId:
            input.commandState.runtimeCoordinatorExecutionId,
        }
      );
      await this.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord({
        createdAtMs: existing?.createdAtMs ?? input.nowMs,
        dispatchId: request.dispatchId,
        modelVersion:
          RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
        publicationId,
        publishedSignalId: null,
        reasonCode: "runtime_coordinator.stopped_publication_unavailable",
        runtimeCoordinatorExecutionId:
          input.commandState.runtimeCoordinatorExecutionId,
        spaceId: payload.spaceId,
        status: "publication_failed",
        taskOutcomeProjectedAtMs: null,
        taskOutcomeSourceClientMessageId: null,
        targetProfileId: payload.targetProfileId,
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
        updatedAtMs: input.nowMs,
      });
      return {
        ok: false,
        reasonCode: "runtime_coordinator.stopped_publication_unavailable",
        status: "unavailable",
      };
    }
    await this.projectRuntimeCoordinatorStoppedTaskOutcome({
      record: publicationRecord,
      sourceClientMessageId: input.commandState.sourceClientMessageId,
    });
    return {
      ok: true,
      publishedSignalId,
      status: "published",
    };
  }
  private async publishRuntimeCoordinatorHeadPreAgentStoppedOutcome(input: {
    nowMs: number;
    record: RuntimeCoordinatorHeadLifecycleRecord;
  }): Promise<RuntimeCoordinatorWakeStoppedNoticePublicationResult> {
    const reasonCode =
      input.record.publicationIntent?.reasonCode ??
      RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE;
    const publication =
      await this.publishRuntimeCoordinatorHeadWakeStoppedNotice({
        nowMs: input.nowMs,
        reasonCode,
        record: input.record,
      });
    if (publication.ok) {
      await retireRuntimeCoordinatorAgentProfileHeadHistoryReference({
        record: input.record,
        storage: this.ctx.storage,
      });
      return publication;
    }
    const identity = input.record.targetWakeLifecycleIdentity;
    await this.writeRuntimeCoordinatorPublicationBlocker({
      blockerId: buildRuntimeCoordinatorHeadWakeStoppedNoticePublicationId(
        input.record.targetWakeLifecycleId
      ),
      blockerKind: "publication_unavailable",
      db: getPostgresDatabase(this.env),
      dispatchId: input.record.primaryDispatchId,
      nowMs: input.nowMs,
      publicationKind: "stopped_notice",
      reasonCode: publication.reasonCode,
      runtimeCoordinatorExecutionId: null,
      spaceId: identity.spaceId,
      targetProfileId: identity.targetProfileId,
      targetWakeLifecycleId: input.record.targetWakeLifecycleId,
    });
    return publication;
  }
  private async publishRuntimeCoordinatorHeadWakeStoppedNotice(input: {
    nowMs: number;
    reasonCode: string;
    record: RuntimeCoordinatorHeadLifecycleRecord;
  }): Promise<RuntimeCoordinatorWakeStoppedNoticePublicationResult> {
    const publicationId =
      buildRuntimeCoordinatorHeadWakeStoppedNoticePublicationId(
        input.record.targetWakeLifecycleId
      );
    const existing =
      await this.readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        publicationId
      );
    if (existing?.status === "published" && existing.publishedSignalId) {
      await this.projectRuntimeCoordinatorStoppedTaskOutcome({
        record: existing,
        sourceClientMessageId:
          input.record.targetWakeLifecycleIdentity.clientMessageId,
      });
      return {
        ok: true,
        publishedSignalId: existing.publishedSignalId,
        status: "already_visible",
      };
    }
    const identity = input.record.targetWakeLifecycleIdentity;
    const actorName = input.record.targetDisplay?.targetProfileName?.trim();
    const text = buildSystemNoticeText({
      actorName:
        input.record.targetDisplay?.targetProfileMentionLabel?.trim() ||
        actorName ||
        null,
      noticeType: "wake_stopped",
      variant:
        input.record.stopReason === DELETED_AGENT_PROFILE_WAKE_STOP_REASON
          ? "agent_profile_deleted"
          : "stopped_before_execution",
    });
    let publicationRecord: RuntimeCoordinatorWakeStoppedNoticePublicationRecord;
    let publishedSignalId: string;
    try {
      const signal = await emitSpaceSystemNoticeSignal({
        env: this.env,
        finalOutcomeAuthority: "runtime_coordinator_wake_stop_publication",
        spaceId: identity.spaceId,
        profile: {
          kind: "system",
          profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
          profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
        },
        data: {
          noticeType: "wake_stopped",
          actorProfileId: identity.targetProfileId,
          ...(actorName ? { actorName } : {}),
          dispatchId: input.record.primaryDispatchId,
          generatedBy: "openmeld",
          reason: input.record.stopReason ?? input.reasonCode,
          reasonCode: input.reasonCode,
          text,
        },
        spaceAccess: createDispatchContinuationSpaceAccessContext({
          dispatchId: input.record.primaryDispatchId,
          password: null,
          requestContext: {
            actorContext: {
              requestId: `runtime-coordinator-pre-agent-wake-stopped-${input.record.primaryDispatchId}`,
              openMeldProfileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
              profileKind: "system",
              profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
            },
          },
          sourceSignalId: identity.sourceSignalId,
          spaceId: identity.spaceId,
          targetProfileId: identity.targetProfileId,
        }),
      });
      publicationRecord = {
        createdAtMs: existing?.createdAtMs ?? input.nowMs,
        dispatchId: input.record.primaryDispatchId,
        modelVersion:
          RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
        publicationId,
        publishedSignalId: signal.id,
        reasonCode: input.reasonCode,
        runtimeCoordinatorExecutionId: null,
        spaceId: identity.spaceId,
        status: "published",
        taskOutcomeProjectedAtMs: null,
        taskOutcomeSourceClientMessageId: identity.clientMessageId,
        targetProfileId: identity.targetProfileId,
        targetWakeLifecycleId: input.record.targetWakeLifecycleId,
        updatedAtMs: input.nowMs,
      } satisfies RuntimeCoordinatorWakeStoppedNoticePublicationRecord;
      await this.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
        publicationRecord
      );
      publishedSignalId = signal.id;
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_pre_agent_wake_stopped_publication_failed]",
        {
          dispatchId: input.record.primaryDispatchId,
          error: error instanceof Error ? error.message : String(error),
          targetWakeLifecycleId: input.record.targetWakeLifecycleId,
        }
      );
      await this.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord({
        createdAtMs: existing?.createdAtMs ?? input.nowMs,
        dispatchId: input.record.primaryDispatchId,
        modelVersion:
          RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
        publicationId,
        publishedSignalId: null,
        reasonCode: "runtime_coordinator.stopped_publication_unavailable",
        runtimeCoordinatorExecutionId: null,
        spaceId: identity.spaceId,
        status: "publication_failed",
        taskOutcomeProjectedAtMs: null,
        taskOutcomeSourceClientMessageId: null,
        targetProfileId: identity.targetProfileId,
        targetWakeLifecycleId: input.record.targetWakeLifecycleId,
        updatedAtMs: input.nowMs,
      });
      return {
        ok: false,
        reasonCode: "runtime_coordinator.stopped_publication_unavailable",
        status: "unavailable",
      };
    }
    await this.projectRuntimeCoordinatorStoppedTaskOutcome({
      record: publicationRecord,
      sourceClientMessageId: identity.clientMessageId,
    });
    return {
      ok: true,
      publishedSignalId,
      status: "published",
    };
  }
  private async recordRuntimeCoordinatorTerminalDecision(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    eventPayload?: Record<string, unknown>;
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest;
    nowMs: number;
    plan?: RuntimeCoordinatorTerminalDecisionPlan;
    projection: RuntimeCoordinatorExecutionRecord | null;
    replySignalId?: string | null;
  }): Promise<RuntimeTransportRuntimeCoordinatorDecisionResponse> {
    const terminalPlan =
      input.plan ?? resolveRuntimeCoordinatorTerminalDecisionPlan(input.input);
    const nextAuthority = settleRuntimeCoordinatorAuthorityForTerminalDecision({
      authority: input.authority,
      nowMs: input.nowMs,
      plan: terminalPlan,
      replySignalId: input.replySignalId ?? null,
    });
    await this.writeRuntimeCoordinatorTokenAuthority(nextAuthority);
    await this.writeRuntimeCoordinatorTerminalProjection({
      authority: nextAuthority,
      input: input.input,
      nowMs: input.nowMs,
      projection: input.projection,
      reasonCode: terminalPlan.reasonCode,
      terminalOutcomeKind: terminalPlan.terminalOutcomeKind,
    });
    return await this.recordRuntimeCoordinatorDurableDecision({
      action: terminalPlan.action,
      authority: nextAuthority,
      eventType: terminalPlan.eventType,
      input: input.input,
      nowMs: input.nowMs,
      eventPayload: input.eventPayload,
      projection: input.projection,
      reasonCode: terminalPlan.reasonCode,
      statusAfter: "failed_terminal",
    });
  }
  private async writeRuntimeCoordinatorTerminalProjection(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest;
    nowMs: number;
    projection: RuntimeCoordinatorExecutionRecord | null;
    reasonCode: string;
    terminalOutcomeKind: RuntimeCoordinatorTerminalOutcome["kind"];
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const record =
      input.projection ??
      buildRuntimeCoordinatorExecutionRecordFromAuthority({
        authority: input.authority,
        fallback: input.input,
        nowMs: input.nowMs,
      });
    if (!record) {
      return;
    }
    const terminalRecord: RuntimeCoordinatorExecutionRecord = {
      ...record,
      status: "failed_terminal",
      terminalOutcome: {
        kind: input.terminalOutcomeKind,
        observedAtMs: input.nowMs,
        reasonCode: input.reasonCode,
      },
      updatedAtMs: input.nowMs,
    };
    const projectionWrite =
      input.projection === null
        ? writeRuntimeCoordinatorTerminalExecutionProjectionWithoutRead({
            db,
            record: terminalRecord,
          })
        : writeRuntimeCoordinatorExecutionProjection({
            db,
            record: terminalRecord,
          });
    await projectionWrite.catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_terminal_projection_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          reasonCode: input.reasonCode,
          runtimeCoordinatorExecutionId:
            input.input.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private async recordRuntimeCoordinatorDurableDecision(input: {
    action: Extract<
      RuntimeTransportRuntimeCoordinatorDecisionResponse,
      {
        ok: true;
      }
    >["action"];
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    eventPayload?: Record<string, unknown>;
    eventType: RuntimeCoordinatorExecutionEventType;
    input: RuntimeTransportRuntimeCoordinatorDecisionRequest;
    nowMs: number;
    projection: RuntimeCoordinatorExecutionRecord | null;
    reasonCode: string;
    statusAfter: RuntimeCoordinatorExecutionStatus | null;
  }): Promise<RuntimeTransportRuntimeCoordinatorDecisionResponse> {
    const decisionRun = resolveRuntimeCoordinatorDecisionRun({
      authority: input.authority,
      observedRunId: input.input.observedRunId ?? null,
    });
    const decisionOrdinal =
      (
        await this.readRuntimeCoordinatorDecisionRecords(
          input.input.runtimeCoordinatorExecutionId
        )
      ).length + 1;
    const decision: RuntimeCoordinatorDurableDecisionRecord = {
      action: input.action,
      createdAtMs: input.nowMs,
      decisionId: buildRuntimeCoordinatorDecisionId({
        idempotencyKey: `decision:${decisionOrdinal}`,
        runtimeCoordinatorExecutionId:
          input.input.runtimeCoordinatorExecutionId,
      }),
      eventKind: input.input.eventKind,
      idempotencyKey: input.input.idempotencyKey,
      modelVersion: RUNTIME_COORDINATOR_DECISION_MODEL_VERSION,
      reasonCode: input.reasonCode,
      runId: decisionRun?.runId ?? input.input.observedRunId ?? null,
      statusAfter: input.statusAfter,
      tokenStatus: decisionRun?.tokenStatus ?? null,
      trigger: input.input.trigger,
    };
    await this.appendRuntimeCoordinatorDecisionRecord({
      decision,
      runtimeCoordinatorExecutionId: input.input.runtimeCoordinatorExecutionId,
    });
    const eventDb = getPostgresDatabase(this.env);
    if (eventDb) {
      await writeRuntimeCoordinatorExecutionEventFromParts({
        db: eventDb,
        eventType: input.eventType,
        idempotencyKey: `decision:${decisionOrdinal}`,
        observedAtMs: input.nowMs,
        payload: {
          ...(input.eventPayload ?? {}),
          action: input.action,
          attemptId: input.input.attemptId ?? null,
          claimDecision: input.input.claimDecision ?? null,
          decisionId: decision.decisionId,
          decisionOrdinal,
          eventKind: input.input.eventKind,
          reasonCode: input.reasonCode,
          runId: decision.runId,
          tokenStatus: decision.tokenStatus,
          trigger: input.input.trigger,
          triggerIdempotencyKey: input.input.idempotencyKey,
          usesFinalClaimAuthority: false,
          usesLegacyClaimLeaseAuthority: false,
        },
        reasonCode: input.reasonCode,
        runtimeCoordinatorExecutionId:
          input.input.runtimeCoordinatorExecutionId,
        statusAfter: input.statusAfter,
      }).catch((error) => {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_decision_failed]",
          {
            error: error instanceof Error ? error.message : String(error),
            reasonCode: input.reasonCode,
            runtimeCoordinatorExecutionId:
              input.input.runtimeCoordinatorExecutionId,
          }
        );
      });
    }
    return {
      ok: true,
      action: input.action,
      reasonCode: input.reasonCode,
      runtimeCoordinatorExecutionId: input.input.runtimeCoordinatorExecutionId,
      status: "recorded",
    };
  }
  private async retainCommunicationRecoveryIfUnavailable(
    commandState: RuntimeCoordinatorRunCommandState,
    nowMs: number
  ): Promise<RuntimeCoordinatorRunCommandState> {
    const session = this.state.sessionsById.get(
      commandState.lastDeliveryProvenance.daemonSessionId
    );
    if (
      session?.socket &&
      nowMs - session.lastHeartbeatMs <= LEASE_TTL_MS &&
      session.connectedAtMs <=
        resolveRuntimeCoordinatorWatchdogProgressBaselineAtMs(commandState)
    ) {
      return commandState;
    }
    // A reconnect may precede this alarm (or bounded bootstrap repair). Opening
    // transport is not accepted execution progress, and must not lose the grace.
    return await retainRuntimeCoordinatorCommunicationRecovery(
      this.ctx.storage,
      commandState
    );
  }
  /**
   * Names the cause behind a stale-progress terminal.
   *
   * Same watchdog, different cause: repeated occupied lifecycle keepalives
   * prove liveness without advancing work, so the wait reaches the stale
   * threshold. Core still holds the occupancy flag
   * the Adapter reported, and naming it here is what lets the Wake fail with
   * its real reason and settle into an owner decision instead of a "reconnect
   * the computer" dead end.
   */
  private async resolveRuntimeCoordinatorStaleProgressCause(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    dispatchId: string;
    targetProfileId: string;
  }): Promise<{
    expiryCause: RuntimeCoordinatorRunExpiryCause;
    reasonCode:
      | typeof RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
      | typeof RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE
      | typeof RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE;
  }> {
    const deliveredSession = this.state.sessionsById.get(
      input.commandState.lastDeliveryProvenance.daemonSessionId
    );
    const sessionConnectionExpired =
      !deliveredSession?.socket &&
      (!deliveredSession ||
        Date.now() - deliveredSession.lastHeartbeatMs > LEASE_TTL_MS);
    if (
      sessionConnectionExpired ||
      (deliveredSession?.acceptingDispatches === false &&
        deliveredSession.stopCause !== null)
    ) {
      return {
        expiryCause: "local_runtime_lost",
        reasonCode: RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE,
      };
    }
    const occupied =
      await readRuntimeCoordinatorAgentProfileWorkControllerConversationOccupied(
        {
          dispatchId: input.dispatchId,
          storage: this.ctx.storage,
          targetProfileId: input.targetProfileId,
        }
      );
    return occupied
      ? {
          expiryCause: "controller_conversation_occupied",
          reasonCode:
            RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
        }
      : {
          expiryCause: "local_progress_stale",
          reasonCode: RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE,
        };
  }
  private async redeliverRuntimeCoordinatorCurrentRun(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    decision: RuntimeTransportRuntimeCoordinatorDecisionRequest;
    nowMs: number;
    reasonCode: string;
  }): Promise<
    | {
        ok: true;
        commandState: RuntimeCoordinatorRunCommandState;
        reasonCode: "runtime_coordinator.current_run_redelivered";
      }
    | {
        ok: false;
        terminal: true;
        commandState: RuntimeCoordinatorRunCommandState;
        expiryCause: RuntimeCoordinatorRunExpiryCause;
        reasonCode:
          | typeof RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
          | typeof RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE
          | typeof RUNTIME_COORDINATOR_LOCAL_RUNTIME_LOST_REASON_CODE
          | typeof RUNTIME_COORDINATOR_PROGRESS_STALE_TERMINAL_REASON_CODE;
      }
    | {
        ok: false;
        terminal?: false;
        reasonCode:
          | "runtime_coordinator.active_run_missing"
          | "runtime_coordinator.active_token_secret_unavailable"
          | "runtime_coordinator.local_progress_active"
          | "runtime_coordinator.progress_stale_policy_pending"
          | "runtime_coordinator.redelivery_capability_unavailable"
          | "runtime_coordinator.redelivery_command_missing"
          | "runtime_coordinator.redelivery_route_unavailable"
          | "runtime_coordinator.redelivery_send_failed"
          | "runtime_coordinator.redelivery_scope_mismatch";
      }
  > {
    const activeRunId = input.authority.currentRunId;
    const activeRun = activeRunId
      ? (input.authority.runsById[activeRunId] ?? null)
      : null;
    if (activeRun?.tokenStatus !== "active") {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.active_run_missing",
      };
    }
    if (!activeRun.tokenSecretRefOrSealedToken) {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.active_token_secret_unavailable",
      };
    }
    let commandState = await this.readRuntimeCoordinatorRunCommandState(
      input.decision.runtimeCoordinatorExecutionId
    );
    if (!commandState) {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.redelivery_command_missing",
      };
    }
    if (
      commandState.dispatchId !== input.authority.executionScope.dispatchId ||
      commandState.targetProfileId !==
        input.authority.executionScope.targetProfileId ||
      commandState.runtimeCoordinatorExecutionId !==
        input.authority.runtimeCoordinatorExecutionId
    ) {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.redelivery_scope_mismatch",
      };
    }
    if (hasRuntimeCoordinatorDurableLocalProgress(commandState.localProgress)) {
      commandState = await this.retainCommunicationRecoveryIfUnavailable(
        commandState,
        input.nowMs
      );
      const localProgressReason =
        resolveRuntimeCoordinatorLocalProgressDecisionReason(commandState);
      if (
        localProgressReason ===
          "runtime_coordinator.progress_stale_policy_pending" &&
        hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
          commandState,
          nowMs: input.nowMs,
        })
      ) {
        return {
          ok: false,
          terminal: true,
          commandState,
          ...(await this.resolveRuntimeCoordinatorStaleProgressCause({
            commandState,
            dispatchId: commandState.dispatchId,
            targetProfileId: commandState.targetProfileId,
          })),
        };
      }
      return {
        ok: false,
        terminal: false,
        reasonCode: localProgressReason,
      };
    }
    const pending = this.state.pendingDispatches.get(
      buildDispatchAttemptKey(commandState.dispatchId, commandState.attemptId)
    );
    if (pending && hasRuntimeCoordinatorLocalProgress(pending)) {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.local_progress_active",
      };
    }
    const expiryCause = resolveRuntimeCoordinatorPreAcceptRedeliveryExpiry({
      commandState,
      nowMs: input.nowMs,
    });
    if (expiryCause) {
      return {
        ok: false,
        terminal: true,
        commandState,
        expiryCause,
        reasonCode: RUNTIME_COORDINATOR_DELIVERY_EXPIRED_REASON_CODE,
      };
    }
    const lease = this.state.profileLeasesByProfileId.get(
      commandState.profileId
    );
    const session = lease
      ? (this.state.sessionsById.get(lease.daemonSessionId) ?? null)
      : null;
    const redeliveryRoute = resolveRuntimeCoordinatorRedeliveryRoute({
      commandState,
      lease,
      session,
    });
    if (!redeliveryRoute) {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.redelivery_route_unavailable",
      };
    }
    const hasCapability = hasRuntimeAdapterCapabilityForRef({
      agentControllerRef: input.authority.authorityScope.agentControllerRef,
      runtimeAdapters: redeliveryRoute.lease.capabilities.runtimeAdapters,
    });
    if (!hasCapability) {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.redelivery_capability_unavailable",
      };
    }
    const deliveryProvenance = {
      connectionGeneration: redeliveryRoute.session.connectionGeneration,
      daemonSessionId: redeliveryRoute.session.daemonSessionId,
      leaseEpoch: redeliveryRoute.lease.leaseEpoch,
    };
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope: input.authority.authorityScope,
      deliveryProvenance,
      existingAuthority: input.authority,
      executionScope: input.authority.executionScope,
      nowMs: input.nowMs,
    });
    const redeliveryExecutionToken = {
      ...issued.envelope,
      deliveryProvenance,
    };
    const redeliveryRequest: RuntimeTransportDeliverDispatchRequest = {
      ...commandState.sanitizedDeliveryRequest,
      connectionGeneration: redeliveryRoute.session.connectionGeneration,
      daemonSessionId: redeliveryRoute.session.daemonSessionId,
      leaseEpoch: redeliveryRoute.lease.leaseEpoch,
      payload: {
        ...commandState.sanitizedDeliveryRequest.payload,
        executionToken: redeliveryExecutionToken,
      },
    };
    try {
      this.sendFrame(redeliveryRoute.session.socket, {
        code: "daemon.dispatch.deliver",
        payload: redeliveryRequest,
      });
    } catch {
      return {
        ok: false,
        terminal: false,
        reasonCode: "runtime_coordinator.redelivery_send_failed",
      };
    }
    this.state.pendingDispatches.set(
      buildDispatchAttemptKey(
        redeliveryRequest.dispatchId,
        redeliveryRequest.attemptId
      ),
      buildPendingDispatchStateFromAcceptedRequest({
        acceptedRequest: redeliveryRequest,
        nowMs: input.nowMs,
      })
    );
    const nextCommandState: RuntimeCoordinatorRunCommandState = {
      ...commandState,
      activeRunId: redeliveryExecutionToken.runId,
      lastCommandReasonCode: input.reasonCode,
      lastDeliveryProvenance: {
        connectionGeneration: redeliveryRequest.connectionGeneration,
        daemonSessionId: redeliveryRequest.daemonSessionId,
        deviceId: redeliveryRoute.session.deviceId,
        lane: redeliveryRoute.session.lane,
        leaseEpoch: redeliveryRequest.leaseEpoch,
      },
      lastWatchdogCheckAtMs: null,
      redeliveryCount: commandState.redeliveryCount + 1,
      sanitizedDeliveryRequest:
        sanitizeRuntimeCoordinatorDeliveryRequestForCommandState(
          redeliveryRequest
        ),
      updatedAtMs: input.nowMs,
    };
    await this.writeRuntimeCoordinatorRunCommandState(nextCommandState);
    return {
      ok: true,
      commandState: nextCommandState,
      reasonCode: "runtime_coordinator.current_run_redelivered",
    };
  }
  private async handleRouteCatalogChangedRequest(
    request: Request
  ): Promise<Response> {
    const parsed =
      runtimeTransportNotifyRouteCatalogChangedRequestSchema.safeParse(
        await readJsonBody(request)
      );
    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          notifiedSessions: 0,
        },
        { status: 400 }
      );
    }
    const response = {
      ok: true,
      notifiedSessions: this.notifyRouteCatalogChanged(parsed.data),
    };
    const validated =
      runtimeTransportNotifyRouteCatalogChangedResponseSchema.safeParse(
        response
      );
    if (!validated.success) {
      return Response.json(
        {
          ok: false,
          notifiedSessions: 0,
        },
        { status: 500 }
      );
    }
    this.ctx.waitUntil(
      this.triggerRuntimeCoordinatorHeadWaitingRecovery({
        ownerUserId: parsed.data.ownerUserId,
        profileIds: null,
        trigger: "route_catalog_changed",
      })
    );
    await this.syncHousekeepingAlarm();
    return Response.json(validated.data, { status: 200 });
  }
  private async handleRuntimeCoordinatorPreExecutionHandoffRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportPreExecutionHandoffRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      const response: RuntimeTransportPreExecutionHandoffResponse = {
        ok: false,
        reasonCode: "runtime_coordinator.pre_execution_handoff_request_invalid",
        status: "retry_later",
      };
      return Response.json(response, { status: 400 });
    }
    const nowMs = Date.now();
    let record = await this.upsertRuntimeCoordinatorPreExecutionHandoffRecord({
      nowMs,
      request: parsed.data,
    });
    if (record.publicationStatus === "recovered") {
      const response: RuntimeTransportPreExecutionHandoffResponse = {
        deadlineAtMs: record.deadlineAtMs,
        ok: true,
        reasonCode: record.reasonCode,
        status: "handoff_recovered",
      };
      await this.syncHousekeepingAlarm();
      return Response.json(response, { status: 200 });
    }
    if (record.publicationStatus === "legacy_evidence_only") {
      const response: RuntimeTransportPreExecutionHandoffResponse = {
        deadlineAtMs: record.deadlineAtMs,
        ok: true,
        reasonCode: record.reasonCode,
        status: "legacy_evidence_only",
      };
      await this.syncHousekeepingAlarm();
      return Response.json(response, { status: 200 });
    }
    if (record.publicationStatus === "published" && record.publishedSignalId) {
      const response: RuntimeTransportPreExecutionHandoffResponse = {
        deadlineAtMs: record.deadlineAtMs,
        ok: true,
        publishedSignalId: record.publishedSignalId,
        reasonCode: record.reasonCode,
        resultRef: record.resultRef,
        status: "failure_published",
      };
      await this.syncHousekeepingAlarm();
      return Response.json(response, { status: 200 });
    }
    if (record.deadlineAtMs <= nowMs) {
      record =
        await this.markRuntimeCoordinatorPreExecutionHandoffLegacyEvidenceOnly({
          nowMs,
          record,
        });
      await this.syncHousekeepingAlarm();
      const response: RuntimeTransportPreExecutionHandoffResponse = {
        deadlineAtMs: record.deadlineAtMs,
        ok: true,
        reasonCode: record.reasonCode,
        status: "legacy_evidence_only",
      };
      return Response.json(response, { status: 200 });
    }
    await this.recordRuntimeCoordinatorPreExecutionHandoffOpsDecision({
      decisionCode: "runtime_coordinator.pre_execution_handoff_waiting",
      expectedRecoveryCriteria:
        "RuntimeCoordinator owner shard alarm owns the deadline and failure publication; Queue redelivery is only an optional trigger",
      nowMs,
      record,
    });
    await this.syncHousekeepingAlarm();
    const response: RuntimeTransportPreExecutionHandoffResponse = {
      deadlineAtMs: record.deadlineAtMs,
      nextAlarmAtMs: record.nextAlarmAtMs,
      ok: true,
      reasonCode: record.reasonCode,
      status: "waiting_for_recovery",
    };
    return Response.json(response, { status: 200 });
  }
  private async processRuntimeCoordinatorWatchdogAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    await repairRuntimeCoordinatorWatchdogSchedule(this.ctx.storage);
    await processRuntimeCoordinatorWatchdogAlarmWithPorts({
      nowMs,
      ports: {
        processWatchdogDue: (input) =>
          this.processRuntimeCoordinatorWatchdogDue(input),
        readCommandStates: () =>
          readRuntimeCoordinatorWatchdogDueCommands(this.ctx.storage, nowMs),
        reserveWorkUnit: () =>
          !run ||
          this.reserveHousekeepingAlarmWorkUnit(
            run,
            "runtime_coordinator_watchdog"
          ),
      },
    });
  }
  private async processRuntimeCoordinatorWatchdogDue(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    nextCheckAtMs: number;
    nowMs: number;
  }): Promise<void> {
    const { commandState, nextCheckAtMs, nowMs } = input;
    try {
      const pendingInteraction = commandState.pendingInteraction ?? null;
      if (
        pendingInteraction &&
        !pendingInteraction.response &&
        pendingInteraction.request.expiresAtMs <= nowMs
      ) {
        const nextCommandState: RuntimeCoordinatorRunCommandState = {
          ...commandState,
          lastCommandReasonCode: "runtime_coordinator.interaction_expired",
          pendingInteraction: {
            ...pendingInteraction,
            respondedAtMs: nowMs,
            response: { kind: "cancel" },
          },
          updatedAtMs: nowMs,
        };
        await this.writeRuntimeCoordinatorRunCommandState(nextCommandState);
        await this.tryResolveRuntimeCoordinatorInteractionInboxItem({
          commandState: nextCommandState,
          interaction: pendingInteraction.request,
          resolvedAtMs: nowMs,
        });
        this.tryDeliverRuntimeCoordinatorInteractionResponse(nextCommandState);
        return;
      }
      const response = await this.decideRuntimeCoordinatorExecutionProgress(
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          attemptId: commandState.attemptId,
          dispatchId: commandState.dispatchId,
          eventKind: "timeout",
          idempotencyKey: `runtime_coordinator_watchdog:${commandState.runtimeCoordinatorExecutionId}:${commandState.activeRunId}:${nextCheckAtMs}`,
          reasonCode: "runtime_coordinator.watchdog_due",
          runtimeCoordinatorExecutionId:
            commandState.runtimeCoordinatorExecutionId,
          sourceClientMessageId: commandState.sourceClientMessageId,
          spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
          targetProfileId: commandState.targetProfileId,
          trigger: "alarm",
        },
        { skipProjectionRead: true }
      );
      if (
        response.ok &&
        response.action === "keep_waiting" &&
        (response.reasonCode === "runtime_coordinator.local_progress_active" ||
          response.reasonCode ===
            "runtime_coordinator.progress_stale_policy_pending")
      ) {
        await this.markRuntimeCoordinatorProgressWatchdogChecked({
          commandState,
          nowMs,
          reasonCode: response.reasonCode,
        });
      }
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_watchdog_failed]",
        {
          dispatchId: commandState.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          runtimeCoordinatorExecutionId:
            commandState.runtimeCoordinatorExecutionId,
          targetProfileId: commandState.targetProfileId,
        }
      );
    }
  }
  private async processRuntimeCoordinatorPreExecutionHandoffAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    await processRuntimeCoordinatorPreExecutionHandoffAlarmWithPorts({
      nowMs,
      ports: {
        deleteRecord: (dispatchId) =>
          this.deleteRuntimeCoordinatorPreExecutionHandoffRecord(dispatchId),
        markLegacyEvidenceOnly: (input) =>
          this.markRuntimeCoordinatorPreExecutionHandoffLegacyEvidenceOnly(
            input
          ),
        readRecords: () =>
          this.readRuntimeCoordinatorPreExecutionHandoffRecordsFromIndex(),
        reserveWorkUnit: () =>
          !run ||
          this.reserveHousekeepingAlarmWorkUnit(
            run,
            "runtime_coordinator_pre_execution_handoff"
          ),
      },
    });
  }
  private async processRuntimeCoordinatorFinalizationRetryAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    await processRuntimeCoordinatorFinalizationRetryAlarmWithPorts({
      nowMs,
      ports: {
        processFinalizationRetry: (input) =>
          this.processRuntimeCoordinatorFinalizationRetry(input),
        readRetryEntries: () =>
          this.readRuntimeCoordinatorFinalizationRetries(),
        reserveWorkUnit: () =>
          !run ||
          this.reserveHousekeepingAlarmWorkUnit(
            run,
            "runtime_coordinator_finalization_retry"
          ),
      },
    });
  }
  private buildRuntimeCoordinatorInteractionAgentTaskObservationDelivery(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    interaction: RuntimeTransportDispatchInteractionRequest["interaction"];
  }): {
    observation: {
      attentionCode: string;
      eventId: string;
      occurredAtMs: number;
      status: "needs_attention";
    };
    runtimeCoordinatorExecutionId: string;
    task: {
      kind: "space_wake";
      sourceClientMessageId: string;
      spaceId: string;
      targetProfileId: string;
      v: 1;
    };
  } | null {
    const task = this.buildRuntimeCoordinatorSpaceWakeAgentTaskHandle(
      input.commandState
    );
    if (!task) {
      return null;
    }
    return {
      observation: {
        attentionCode: runtimeCoordinatorInteractionAttentionCode(
          input.interaction.kind
        ),
        eventId: buildRuntimeCoordinatorInteractionAttentionEventId({
          interactionId: input.interaction.interactionId,
          runtimeCoordinatorExecutionId:
            input.commandState.runtimeCoordinatorExecutionId,
        }),
        occurredAtMs: input.interaction.requestedAtMs,
        status: "needs_attention",
      },
      runtimeCoordinatorExecutionId:
        input.commandState.runtimeCoordinatorExecutionId,
      task,
    };
  }
  private buildRuntimeCoordinatorSpaceWakeAgentTaskHandle(
    commandState: RuntimeCoordinatorRunCommandState
  ): {
    kind: "space_wake";
    sourceClientMessageId: string;
    spaceId: string;
    targetProfileId: string;
    v: 1;
  } | null {
    if (!commandState.sourceClientMessageId) {
      return null;
    }
    return {
      kind: "space_wake",
      sourceClientMessageId: commandState.sourceClientMessageId,
      spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
      targetProfileId: commandState.targetProfileId,
      v: 1,
    };
  }
  private async tryProjectRuntimeCoordinatorAgentTaskObservationDelivery(
    delivery: RuntimeCoordinatorAgentTaskObservationDeliveryRecord
  ): Promise<boolean> {
    try {
      await this.projectRuntimeCoordinatorAgentTaskObservationDelivery(
        delivery
      );
      return true;
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_agent_task_observation_delivery_deferred]",
        {
          deliveryId: delivery.deliveryId,
          error: error instanceof Error ? error.message : String(error),
          observationStatus: delivery.observation.status,
          runtimeCoordinatorExecutionId: delivery.runtimeCoordinatorExecutionId,
        }
      );
      return false;
    }
  }
  private async enqueueRuntimeCoordinatorAgentTaskObservationRedrive(input: {
    delivery: RuntimeCoordinatorAgentTaskObservationDeliveryRecord;
    ownerUserId: string;
  }): Promise<void> {
    if (input.delivery.status === "projected") {
      return;
    }
    const queue = this.env.OPENMELD_DAEMON_DISPATCH_QUEUE;
    if (!queue) {
      throw new Error("agent_task_observation_redrive.queue_unavailable");
    }
    const message = agentTaskObservationRedriveQueueMessageSchema.parse({
      deliveryId: input.delivery.deliveryId,
      enqueuedAtMs: Date.now(),
      idempotencyKey: input.delivery.deliveryId,
      kind: "agent_task_observation_redrive",
      observation: input.delivery.observation,
      ownerUserId: input.ownerUserId,
      runtimeCoordinatorExecutionId:
        input.delivery.runtimeCoordinatorExecutionId,
      task: input.delivery.task,
      v: 5,
    });
    await queue.send(message);
  }
  private async projectRuntimeCoordinatorAgentTaskObservationDelivery(
    delivery: RuntimeCoordinatorAgentTaskObservationDeliveryRecord
  ): Promise<void> {
    if (delivery.status === "projected") {
      await removeRuntimeCoordinatorAgentTaskObservationDeliveryFromIndex(
        this.ctx.storage,
        delivery.deliveryId
      );
      return;
    }
    const db = getPostgresDatabase(this.env);
    if (!db) {
      throw new Error("agent_task_coordination.db_unavailable");
    }
    if (delivery.observation.status === "needs_attention") {
      await recordAndEnqueueAgentTaskNeedsAttentionObservation({
        db,
        env: this.env,
        nowMs: Date.now(),
        observation: delivery.observation,
        task: delivery.task,
      });
    } else {
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db,
        env: this.env,
        nowMs: Date.now(),
        outcome: delivery.observation,
        task: delivery.task,
      });
    }
    await markRuntimeCoordinatorAgentTaskObservationDeliveryProjected(
      this.ctx.storage,
      {
        deliveryId: delivery.deliveryId,
        projectedAtMs: Date.now(),
      }
    );
  }
  private async processRuntimeCoordinatorAgentTaskObservationDeliveryAlarm(
    _nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    const deliveries =
      await readRuntimeCoordinatorAgentTaskObservationDeliveriesFromIndex(
        this.ctx.storage
      );
    for (const delivery of deliveries) {
      if (
        run &&
        !this.reserveHousekeepingAlarmWorkUnit(
          run,
          "runtime_coordinator_agent_task_observation_delivery"
        )
      ) {
        return;
      }
      await this.projectRuntimeCoordinatorAgentTaskObservationDelivery(
        delivery
      );
    }
  }
  private async processRuntimeCoordinatorStoppedTaskProjectionAlarm(
    _nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    const publicationIds =
      await this.readRuntimeCoordinatorStoppedTaskProjectionPublicationIds();
    for (const publicationId of publicationIds) {
      if (
        run &&
        !this.reserveHousekeepingAlarmWorkUnit(
          run,
          "runtime_coordinator_stopped_task_projection"
        )
      ) {
        return;
      }
      const record =
        await this.readRuntimeCoordinatorWakeStoppedNoticePublicationRecord(
          publicationId
        );
      if (
        !record ||
        record.status !== "published" ||
        !record.publishedSignalId ||
        !record.taskOutcomeSourceClientMessageId ||
        record.taskOutcomeProjectedAtMs !== null
      ) {
        await this.removeRuntimeCoordinatorStoppedTaskProjectionPublicationId(
          publicationId
        );
        continue;
      }
      await this.projectRuntimeCoordinatorStoppedTaskOutcome({
        record,
        sourceClientMessageId: record.taskOutcomeSourceClientMessageId,
      });
    }
  }
  private async processRuntimeCoordinatorInteractionInboxRepairAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    const storedRecords =
      await this.ctx.storage.list<RuntimeCoordinatorInteractionInboxRepairRecord>(
        {
          prefix: RUNTIME_COORDINATOR_INTERACTION_INBOX_REPAIR_STORAGE_PREFIX,
        }
      );
    const repairRecords = [...storedRecords.values()]
      .filter((record) => record.v === 1 && record.nextAttemptAtMs <= nowMs)
      .sort((left, right) => left.nextAttemptAtMs - right.nextAttemptAtMs);
    for (const repairRecord of repairRecords) {
      if (
        run &&
        !this.reserveHousekeepingAlarmWorkUnit(
          run,
          "runtime_coordinator_interaction_inbox_projection"
        )
      ) {
        return;
      }
      const commandState = await this.readRuntimeCoordinatorRunCommandState(
        repairRecord.runtimeCoordinatorExecutionId
      );
      const pendingInteraction = commandState?.pendingInteraction ?? null;
      if (
        commandState &&
        pendingInteraction &&
        pendingInteraction.request.interactionId ===
          repairRecord.interaction.interactionId &&
        !pendingInteraction.response
      ) {
        await this.tryApplyRuntimeCoordinatorInteractionInboxRepair({
          ...repairRecord,
          desiredStatus: "open",
          interaction: {
            interactionId: pendingInteraction.request.interactionId,
            kind: pendingInteraction.request.kind,
            requestedAtMs: pendingInteraction.request.requestedAtMs,
          },
          ownerUserId: commandState.ownerUserId,
          resolvedAtMs: null,
          sourceSignalId:
            commandState.sanitizedDeliveryRequest.payload.sourceEventId,
          spaceId: commandState.sanitizedDeliveryRequest.payload.spaceId,
          targetProfileName:
            commandState.sanitizedDeliveryRequest.payload.targetProfileName ??
            commandState.sanitizedDeliveryRequest.payload
              .targetProfileMentionLabel ??
            "Agent",
          updatedAtMs: nowMs,
        });
        continue;
      }
      await this.tryApplyRuntimeCoordinatorInteractionInboxRepair({
        ...repairRecord,
        desiredStatus: "resolved",
        resolvedAtMs:
          pendingInteraction?.respondedAtMs ??
          repairRecord.resolvedAtMs ??
          nowMs,
        updatedAtMs: nowMs,
      });
    }
  }
  private async processLocalAgentStreamClosureRetryAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    const retryEntries = await listDueLocalAgentStreamClosureRetryEntries({
      limit: RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_MAX_WORK_UNITS,
      nowMs,
      storage: this.ctx.storage,
    });
    for (const retryEntry of retryEntries) {
      if (
        run &&
        !this.reserveHousekeepingAlarmWorkUnit(
          run,
          "local_agent_stream_closure_retry"
        )
      ) {
        return;
      }
      const closed = await this.tryCloseLocalAgentStream(retryEntry);
      if (closed) {
        await removeLocalAgentStreamClosureRetryEntry({
          storage: this.ctx.storage,
          streamId: retryEntry.streamId,
        });
        continue;
      }
      await upsertLocalAgentStreamClosureRetryEntry({
        entry: incrementLocalAgentStreamClosureRetryEntry({
          entry: retryEntry,
          nowMs,
        }),
        storage: this.ctx.storage,
      });
    }
  }
  private async processRuntimeCoordinatorFinalizationRetry(input: {
    nowMs: number;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<void> {
    const { nowMs, retryEntry } = input;
    try {
      if (
        isRuntimeCoordinatorFinalizationRetryParkLimitReached({
          firstFailureAtMs: retryEntry.firstFailureAtMs,
          nowMs,
        })
      ) {
        let authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
        try {
          authority = await this.readRuntimeCoordinatorTokenAuthority(
            retryEntry.runtimeCoordinatorExecutionId
          );
        } catch {
          await this.storeRuntimeCoordinatorFinalizationRetryOrPark({
            db: getPostgresDatabase(this.env),
            queueAlarm: true,
            retryEntry: {
              ...retryEntry,
              updatedAtMs: nowMs,
            },
          });
          return;
        }
        if (
          authority?.terminalOutcome?.status === "failed_terminal" &&
          authority.terminalOutcome.reasonCode ===
            RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE
        ) {
          await this.storeRuntimeCoordinatorFinalizationRetryOrPark({
            db: getPostgresDatabase(this.env),
            queueAlarm: true,
            retryEntry: {
              ...retryEntry,
              updatedAtMs: nowMs,
            },
          });
          return;
        }
      }
      const replay = await this.replayRuntimeCoordinatorFinalizationCommand({
        attemptId: retryEntry.attemptId,
        dispatchId: retryEntry.dispatchId,
        executionTokenRunId: retryEntry.executionTokenRunId,
        runtimeCoordinatorExecutionId: retryEntry.runtimeCoordinatorExecutionId,
        spaceId: retryEntry.spaceId,
      });
      if (!replay.ok) {
        if (replay.publicationUncertain) {
          await this.upsertRuntimeCoordinatorFinalizationRetryEntry({
            ...retryEntry,
            nextReplayAtMs:
              nowMs + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
            updatedAtMs: nowMs,
          });
          return;
        }
        if (replay.retryable) {
          await this.rescheduleOrExhaustRuntimeCoordinatorFinalizationRetry({
            nowMs,
            retryEntry,
          });
          return;
        }
        await this.writeRuntimeCoordinatorPublicationBlocker({
          blockerId: `finalization:${retryEntry.finalizationCommandId}`,
          blockerKind: "unreplayable",
          db: getPostgresDatabase(this.env),
          dispatchId: retryEntry.dispatchId,
          nowMs,
          publicationKind: "success_reply",
          reasonCode:
            replay.blockerReasonCode ??
            "runtime_coordinator.finalization_unavailable",
          runtimeCoordinatorExecutionId:
            retryEntry.runtimeCoordinatorExecutionId,
          spaceId: retryEntry.spaceId,
          targetProfileId: retryEntry.targetProfileId,
          targetWakeLifecycleId: null,
        });
        await this.removeRuntimeCoordinatorFinalizationRetry(
          retryEntry.finalizationCommandId
        );
      }
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_finalization_retry_failed]",
        {
          dispatchId: retryEntry.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          finalizationCommandId: retryEntry.finalizationCommandId,
          runtimeCoordinatorExecutionId:
            retryEntry.runtimeCoordinatorExecutionId,
        }
      );
      await this.rescheduleOrExhaustRuntimeCoordinatorFinalizationRetry({
        nowMs,
        retryEntry,
      });
    }
  }
  private async rescheduleOrExhaustRuntimeCoordinatorFinalizationRetry(input: {
    nowMs: number;
    retryEntry: RuntimeCoordinatorFinalizationRetryEntry;
  }): Promise<void> {
    const nextRetryEntry = incrementRuntimeCoordinatorFinalizationRetryEntry({
      nowMs: input.nowMs,
      retryEntry: input.retryEntry,
    });
    await this.storeRuntimeCoordinatorFinalizationRetryOrPark({
      db: getPostgresDatabase(this.env),
      retryEntry: nextRetryEntry,
    });
  }
  private async markRuntimeCoordinatorProgressWatchdogChecked(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    nowMs: number;
    reasonCode: string;
  }): Promise<void> {
    const latest = await this.readRuntimeCoordinatorRunCommandState(
      input.commandState.runtimeCoordinatorExecutionId
    );
    if (
      !latest ||
      latest.activeRunId !== input.commandState.activeRunId ||
      !hasRuntimeCoordinatorDurableLocalProgress(latest.localProgress) ||
      latest.localProgress.phase === "result_received"
    ) {
      return;
    }
    await this.writeRuntimeCoordinatorRunCommandState({
      ...latest,
      lastCommandReasonCode: input.reasonCode,
      lastWatchdogCheckAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
    });
  }
  private async readRuntimeCoordinatorRunCommandStatesFromIndex(): Promise<
    RuntimeCoordinatorRunCommandState[]
  > {
    return await readRuntimeCoordinatorRunCommandStatesFromStorageIndex(
      this.ctx.storage
    );
  }
  private notifyRouteCatalogChanged(input: {
    affectedProfileIds?: readonly string[];
    ownerUserId: string;
    reason: string;
  }): number {
    this.invalidateExpectedRouteReconciliationReadCachesForOwner(
      input.ownerUserId
    );
    const payload =
      runtimeTransportRouteCatalogChangedFramePayloadSchema.safeParse({
        reason: input.reason,
      });
    if (!payload.success) {
      return 0;
    }
    // The frame always goes to every owner session: it is a pull signal
    // ("re-sync your catalog"), not a readiness verdict, and any daemon may
    // hold routes the change displaces. Only the readiness invalidation
    // narrows below.
    let notifiedSessions = 0;
    const sessionProfileIds: string[] = [];
    for (const session of this.state.sessionsById.values()) {
      if (session.ownerUserId !== input.ownerUserId) {
        continue;
      }
      sessionProfileIds.push(...collectReadinessProfileIdsForSession(session));
      if (!session.socket) {
        continue;
      }
      this.sendFrame(session.socket, {
        code: "daemon.route_catalog.changed",
        payload: payload.data,
      });
      notifiedSessions += 1;
    }
    this.publishAgentReadinessInvalidated({
      profileIds: resolveRouteCatalogChangedInvalidationProfileIds({
        scopedProfileIds: normalizeRuntimeTransportProfileIds(
          input.affectedProfileIds ?? []
        ),
        sessionProfileIds,
      }),
      reason: payload.data.reason,
    });
    return notifiedSessions;
  }
  private async reconcileExpectedRoutesForSession(input: {
    connectionGeneration: number;
    daemonSessionId: string;
    deviceId: string;
    lane: DaemonServiceLane;
    ownerUserId: string;
    trigger: RouteCatalogReconciliationTrigger;
  }): Promise<void> {
    try {
      await this.reconcileExpectedRoutesForSessionUnsafe(input);
    } catch (error) {
      console.warn("[core.runtime_transport.route_reconciliation_failed]", {
        connectionGeneration: input.connectionGeneration,
        daemonSessionId: input.daemonSessionId,
        deviceId: input.deviceId,
        errorMessage: error instanceof Error ? error.message : String(error),
        event: "core.runtime_transport.route_reconciliation_failed",
        lane: input.lane,
        ownerUserId: input.ownerUserId,
        reason: SERVER_ROUTE_RECONCILIATION_REASON,
        trigger: input.trigger,
      });
    }
  }
  private async reconcileExpectedRoutesForSessionUnsafe(input: {
    connectionGeneration: number;
    daemonSessionId: string;
    deviceId: string;
    lane: DaemonServiceLane;
    ownerUserId: string;
    trigger: RouteCatalogReconciliationTrigger;
  }): Promise<void> {
    const nowMs = Date.now();
    this.reapExpiredLeases(nowMs);
    const session = this.state.sessionsById.get(input.daemonSessionId);
    if (
      !session ||
      session.ownerUserId !== input.ownerUserId ||
      session.deviceId !== input.deviceId ||
      session.lane !== input.lane ||
      session.connectionGeneration !== input.connectionGeneration ||
      !session.socket ||
      nowMs - session.lastHeartbeatMs > LEASE_TTL_MS ||
      !isDaemonExecutionCompatible(session.executionCompatibility)
    ) {
      return;
    }
    const sessionKey = this.resolveRouteCatalogReconciliationSessionKey(input);
    const leaseSetKey = this.resolveExpectedRouteReconciliationLeaseSetKey({
      nowMs,
      session,
    });
    if (
      input.trigger === "daemon_session_heartbeat" &&
      this.isExpectedRouteReconciliationReadCacheFresh({
        leaseSetKey,
        nowMs,
        sessionKey,
      })
    ) {
      return;
    }
    const db = getPostgresDatabase(this.env);
    if (!db) {
      console.warn("[core.runtime_transport.route_reconciliation_skipped]", {
        connectionGeneration: input.connectionGeneration,
        daemonSessionId: input.daemonSessionId,
        deviceId: input.deviceId,
        event: "core.runtime_transport.route_reconciliation_skipped",
        lane: input.lane,
        ownerUserId: input.ownerUserId,
        reason: SERVER_ROUTE_RECONCILIATION_REASON,
        reasonCode: "agent_profile_binding.store_unavailable",
        trigger: input.trigger,
      });
      return;
    }
    const routesResult = await readLocalRuntimeExpectedRoutes({
      authWorker: this.env.OPENMELD_AUTH_WORKER,
      db,
      deviceId: input.deviceId,
      lane: input.lane,
      ownerUserId: input.ownerUserId,
    });
    if (routesResult.status !== "ok") {
      console.warn("[core.runtime_transport.route_reconciliation_skipped]", {
        connectionGeneration: input.connectionGeneration,
        daemonSessionId: input.daemonSessionId,
        deviceId: input.deviceId,
        event: "core.runtime_transport.route_reconciliation_skipped",
        lane: input.lane,
        ownerUserId: input.ownerUserId,
        reason: SERVER_ROUTE_RECONCILIATION_REASON,
        reasonCode:
          routesResult.status === "invalid_identity"
            ? "runtime_identity_invalid"
            : "profile_facts_unavailable",
        trigger: input.trigger,
      });
      return;
    }
    if (routesResult.response.runtimeResolution !== "resolved") {
      return;
    }
    const expectedProfileIds = normalizeRuntimeTransportProfileIds(
      routesResult.response.expectedRoutes
        .filter((route) => route.routable)
        .map((route) => route.agentProfileId)
    );
    if (input.trigger === "daemon_session_heartbeat") {
      this.recordExpectedRouteReconciliationReadCache({
        leaseSetKey,
        nowMs,
        sessionKey,
      });
    }
    const reportAccountedProfileIds =
      this.collectRouteCatalogReportAccountedProfileIds(session);
    const missingProfileIds = expectedProfileIds.filter(
      (profileId) =>
        !(
          reportAccountedProfileIds.has(profileId) ||
          this.hasFreshRouteLeaseForSession({
            nowMs,
            profileId,
            session,
          })
        )
    );
    if (missingProfileIds.length === 0) {
      this.routeCatalogReconciliationSignalsBySessionKey.delete(sessionKey);
      return;
    }
    const reportFingerprint =
      this.resolveRouteCatalogReconciliationReportFingerprint(session);
    if (
      this.isRouteCatalogReconciliationSignalThrottled({
        missingProfileIds,
        nowMs,
        reportFingerprint,
        sessionKey,
      })
    ) {
      return;
    }
    const payload =
      runtimeTransportRouteCatalogChangedFramePayloadSchema.safeParse({
        reason: SERVER_ROUTE_RECONCILIATION_REASON,
      });
    if (!payload.success) {
      throw new Error("server route reconciliation reason is invalid");
    }
    this.sendFrame(session.socket, {
      code: "daemon.route_catalog.changed",
      payload: payload.data,
    });
    this.recordRouteCatalogReconciliationSignal({
      missingProfileIds,
      nowMs,
      reportFingerprint,
      sessionKey,
    });
    this.publishAgentReadinessInvalidated({
      profileIds: missingProfileIds,
      reason: payload.data.reason,
    });
    console.info(
      "[core.runtime_transport.route_catalog_reconciliation_signal_sent]",
      {
        openMeldServiceRuntimeId:
          routesResult.response.openMeldServiceRuntimeId,
        connectionGeneration: input.connectionGeneration,
        daemonSessionId: input.daemonSessionId,
        deviceId: input.deviceId,
        event:
          "core.runtime_transport.route_catalog_reconciliation_signal_sent",
        expectedRouteCount: expectedProfileIds.length,
        lane: input.lane,
        missingRouteCount: missingProfileIds.length,
        ownerUserId: input.ownerUserId,
        reason: payload.data.reason,
        trigger: input.trigger,
      }
    );
  }
  private hasFreshRouteLeaseForSession(input: {
    nowMs: number;
    profileId: string;
    session: RuntimeTransportSessionState;
  }): boolean {
    if (!input.session.profileIds.has(input.profileId)) {
      return false;
    }
    const lease = this.state.profileLeasesByProfileId.get(input.profileId);
    return (
      lease?.daemonSessionId === input.session.daemonSessionId &&
      lease.deviceId === input.session.deviceId &&
      lease.lane === input.session.lane &&
      input.nowMs - lease.lastHeartbeatMs <= LEASE_TTL_MS &&
      isDaemonExecutionCompatible(lease.executionCompatibility)
    );
  }
  private collectRouteCatalogReportAccountedProfileIds(
    session: RuntimeTransportSessionState
  ): Set<string> {
    return new Set(
      normalizeRuntimeTransportProfileIds([
        ...(session.localWakeRouteReport?.skippedProfiles.map(
          (profile) => profile.profileId
        ) ?? []),
        ...session.rejectedProfileRegistrationsByProfileId.keys(),
      ])
    );
  }
  private resolveExpectedRouteReconciliationLeaseSetKey(input: {
    nowMs: number;
    session: RuntimeTransportSessionState;
  }): string {
    const entries: string[] = [];
    for (const profileId of input.session.profileIds) {
      const lease = this.state.profileLeasesByProfileId.get(profileId);
      if (
        lease?.daemonSessionId !== input.session.daemonSessionId ||
        lease.deviceId !== input.session.deviceId ||
        lease.lane !== input.session.lane ||
        input.nowMs - lease.lastHeartbeatMs > LEASE_TTL_MS ||
        !isDaemonExecutionCompatible(lease.executionCompatibility)
      ) {
        continue;
      }
      entries.push(`${profileId}:${String(lease.leaseEpoch)}`);
    }
    return entries.sort((left, right) => left.localeCompare(right)).join("\0");
  }
  private isExpectedRouteReconciliationReadCacheFresh(input: {
    leaseSetKey: string;
    nowMs: number;
    sessionKey: string;
  }): boolean {
    const previous = this.expectedRouteReconciliationReadCacheBySessionKey.get(
      input.sessionKey
    );
    return (
      previous?.leaseSetKey === input.leaseSetKey &&
      input.nowMs - previous.completedAtMs <=
        EXPECTED_ROUTE_RECONCILIATION_READ_CACHE_MAX_AGE_MS
    );
  }
  private recordExpectedRouteReconciliationReadCache(input: {
    leaseSetKey: string;
    nowMs: number;
    sessionKey: string;
  }): void {
    this.expectedRouteReconciliationReadCacheBySessionKey.set(
      input.sessionKey,
      {
        completedAtMs: input.nowMs,
        leaseSetKey: input.leaseSetKey,
      }
    );
  }
  private invalidateExpectedRouteReconciliationReadCacheForSession(input: {
    connectionGeneration: number;
    daemonSessionId: string;
    deviceId: string;
    lane: DaemonServiceLane;
    ownerUserId: string;
  }): void {
    this.expectedRouteReconciliationReadCacheBySessionKey.delete(
      this.resolveRouteCatalogReconciliationSessionKey(input)
    );
  }
  private invalidateExpectedRouteReconciliationReadCachesForOwner(
    ownerUserId: string
  ): void {
    for (const session of this.state.sessionsById.values()) {
      if (session.ownerUserId !== ownerUserId) {
        continue;
      }
      this.invalidateExpectedRouteReconciliationReadCacheForSession({
        connectionGeneration: session.connectionGeneration,
        daemonSessionId: session.daemonSessionId,
        deviceId: session.deviceId,
        lane: session.lane,
        ownerUserId: session.ownerUserId,
      });
    }
  }
  private resolveRouteCatalogReconciliationReportFingerprint(
    session: RuntimeTransportSessionState
  ): string {
    const includedProfileIds = normalizeRuntimeTransportProfileIds(
      session.localWakeRouteReport?.includedProfileIds ?? []
    );
    const skippedProfiles = [
      ...(session.localWakeRouteReport?.skippedProfiles ?? []),
    ]
      .map(
        (profile) =>
          `${profile.profileId}:${profile.skipReason}:${profile.profileName ?? ""}`
      )
      .sort((left, right) => left.localeCompare(right));
    const rejectedProfiles = [
      ...session.rejectedProfileRegistrationsByProfileId.values(),
    ]
      .map(
        (profile) =>
          `${profile.profileId}:${profile.reasonCode}:${profile.serviceVersion ?? ""}`
      )
      .sort((left, right) => left.localeCompare(right));
    return JSON.stringify({
      includedProfileIds,
      rejectedProfiles,
      skippedProfiles,
    });
  }
  private isRouteCatalogReconciliationSignalThrottled(input: {
    missingProfileIds: readonly string[];
    nowMs: number;
    reportFingerprint: string;
    sessionKey: string;
  }): boolean {
    this.pruneRouteCatalogReconciliationSignals(input.nowMs);
    const missingProfileIdsKey = buildRouteCatalogReconciliationMissingKey(
      input.missingProfileIds
    );
    const previous = this.routeCatalogReconciliationSignalsBySessionKey.get(
      input.sessionKey
    );
    if (
      previous?.missingProfileIdsKey === missingProfileIdsKey &&
      previous.reportFingerprint === input.reportFingerprint
    ) {
      return true;
    }
    if (
      previous?.missingProfileIdsKey === missingProfileIdsKey &&
      input.nowMs - previous.notifiedAtMs <
        resolveRouteCatalogReconciliationThrottleMs(previous.backoffLevel)
    ) {
      return true;
    }
    return false;
  }
  private recordRouteCatalogReconciliationSignal(input: {
    missingProfileIds: readonly string[];
    nowMs: number;
    reportFingerprint: string;
    sessionKey: string;
  }): void {
    const missingProfileIdsKey = buildRouteCatalogReconciliationMissingKey(
      input.missingProfileIds
    );
    const previous = this.routeCatalogReconciliationSignalsBySessionKey.get(
      input.sessionKey
    );
    const backoffLevel = nextRouteCatalogReconciliationBackoffLevel({
      missingProfileIdsKey,
      previousBackoffLevel: previous?.backoffLevel ?? null,
      previousMissingProfileIdsKey: previous?.missingProfileIdsKey ?? null,
    });
    this.routeCatalogReconciliationSignalsBySessionKey.set(input.sessionKey, {
      backoffLevel,
      missingProfileIdsKey,
      notifiedAtMs: input.nowMs,
      reportFingerprint: input.reportFingerprint,
    });
  }
  private pruneRouteCatalogReconciliationSignals(nowMs: number): void {
    const currentSessionKeys = new Set(
      [...this.state.sessionsById.values()].map((session) =>
        this.resolveRouteCatalogReconciliationSessionKey({
          connectionGeneration: session.connectionGeneration,
          daemonSessionId: session.daemonSessionId,
          deviceId: session.deviceId,
          lane: session.lane,
          ownerUserId: session.ownerUserId,
        })
      )
    );
    for (const [sessionKey, signal] of this
      .routeCatalogReconciliationSignalsBySessionKey) {
      if (
        !currentSessionKeys.has(sessionKey) &&
        nowMs - signal.notifiedAtMs >
          ROUTE_CATALOG_RECONCILIATION_SIGNAL_THROTTLE_MAX_MS + LEASE_TTL_MS
      ) {
        this.routeCatalogReconciliationSignalsBySessionKey.delete(sessionKey);
      }
    }
  }
  private resolveRouteCatalogReconciliationSessionKey(input: {
    connectionGeneration: number;
    daemonSessionId: string;
    deviceId: string;
    lane: DaemonServiceLane;
    ownerUserId: string;
  }): string {
    return [
      input.ownerUserId,
      input.daemonSessionId,
      String(input.connectionGeneration),
      input.deviceId,
      input.lane,
    ].join("\0");
  }
  private publishAgentReadinessInvalidated(input: {
    profileIds: readonly string[];
    reason: string;
  }): void {
    const profileIds = normalizeRuntimeTransportProfileIds(input.profileIds);
    if (profileIds.length === 0) {
      return;
    }
    // Buffer instead of publishing immediately: a burst of call sites (one per
    // affected profile, plus reconciliation) collapses into one deduplicated
    // publish per reason once the short coalescing window elapses.
    const reason =
      input.reason.trim() || AGENT_READINESS_INVALIDATION_DEFAULT_REASON;
    const pending =
      this.pendingAgentReadinessInvalidationsByReason.get(reason) ??
      new Set<string>();
    for (const profileId of profileIds) {
      pending.add(profileId);
    }
    this.pendingAgentReadinessInvalidationsByReason.set(reason, pending);
    this.scheduleLiveInvalidationFlush();
  }
  private scheduleLiveInvalidationFlush(): void {
    if (this.liveInvalidationFlushTimer) {
      return;
    }
    // A single keepalive promise spans the whole window so the DO is not
    // evicted mid-coalesce; flushing settles it. If the window is somehow
    // lost, the periodic reconciliation and client-side reconcile still
    // converge state, so a dropped notification never leaves a stuck verdict.
    let resolveFlush: () => void = () => {
      // reassigned synchronously by the Promise executor below
    };
    const flushSettled = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });
    this.ctx.waitUntil(flushSettled);
    this.liveInvalidationFlushTimer = setTimeout(() => {
      this.liveInvalidationFlushTimer = null;
      Promise.all([
        this.flushAgentReadinessInvalidations(),
        this.flushWakeProgressInvalidations(),
      ]).finally(resolveFlush);
    }, LIVE_INVALIDATION_COALESCE_WINDOW_MS);
  }
  private async flushAgentReadinessInvalidations(): Promise<void> {
    const pending = this.pendingAgentReadinessInvalidationsByReason;
    this.pendingAgentReadinessInvalidationsByReason = new Map();
    await Promise.all(
      [...pending.entries()].map(([reason, profileIds]) =>
        this.publishAgentReadinessInvalidations({
          profileIds: [...profileIds],
          reason,
        })
      )
    );
  }
  private async publishAgentReadinessInvalidations(input: {
    profileIds: readonly string[];
    reason: string;
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      console.warn("[core.agent_readiness.invalidation_skipped]", {
        event: "core.agent_readiness.invalidation_skipped",
        profileIds: input.profileIds,
        reason: input.reason,
        reasonCode: "agent.readiness.invalidation.projections_db_missing",
      });
      return;
    }
    await publishAgentReadinessInvalidationToSpaces({
      profileIds: input.profileIds,
      reason: input.reason,
      ports: {
        listActiveSpaceIdsForProfile: ({ limit, profileId }) =>
          listActiveSpaceIdsForProfileFromSpaceIndex({
            db,
            limit,
            profileId,
          }),
        broadcastSpaceAgentReadinessInvalidated: async ({
          agentProfileIds,
          reason,
          spaceId,
        }) => {
          const spaceStub = resolveSpaceStub(this.env.OPENMELD_SPACES, spaceId);
          if (!spaceStub) {
            throw new Error(
              "Space stub unavailable for readiness invalidation"
            );
          }
          await spaceStub.rpcBroadcastAgentReadinessInvalidated({
            agentProfileIds,
            reason,
            spaceId,
          });
        },
        warn: (warning) => {
          console.warn("[core.agent_readiness.invalidation_failed]", {
            event: "core.agent_readiness.invalidation_failed",
            error: normalizeAgentReadinessInvalidationError(warning.error),
            profileId: warning.profileId,
            profileIds: input.profileIds,
            reason: input.reason,
            reasonCode: warning.reasonCode,
            spaceId: warning.spaceId,
          });
        },
      },
    });
  }
  private publishWakeProgressChanged(input: {
    agentProfileId: string;
    clientMessageId: string | null;
    spaceId: string;
  }): void {
    const spaceId = input.spaceId.trim();
    const agentProfileId = input.agentProfileId.trim();
    const clientMessageId = input.clientMessageId?.trim() ?? "";
    if (!(spaceId && (agentProfileId || clientMessageId))) {
      return;
    }
    const pending = this.pendingWakeProgressInvalidationsBySpaceId.get(
      spaceId
    ) ?? {
      agentProfileIds: new Set<string>(),
      clientMessageIds: new Set<string>(),
      failedAttempts: 0,
    };
    if (agentProfileId) {
      pending.agentProfileIds.add(agentProfileId);
    }
    if (clientMessageId) {
      pending.clientMessageIds.add(clientMessageId);
    }
    this.pendingWakeProgressInvalidationsBySpaceId.set(spaceId, pending);
    this.scheduleLiveInvalidationFlush();
  }
  private requeueWakeProgressInvalidation(
    spaceId: string,
    failed: {
      agentProfileIds: Set<string>;
      clientMessageIds: Set<string>;
      failedAttempts: number;
    }
  ): void {
    const pending = this.pendingWakeProgressInvalidationsBySpaceId.get(spaceId);
    if (pending) {
      for (const agentProfileId of failed.agentProfileIds) {
        pending.agentProfileIds.add(agentProfileId);
      }
      for (const clientMessageId of failed.clientMessageIds) {
        pending.clientMessageIds.add(clientMessageId);
      }
      pending.failedAttempts = Math.max(
        pending.failedAttempts,
        failed.failedAttempts
      );
    } else {
      this.pendingWakeProgressInvalidationsBySpaceId.set(spaceId, failed);
    }
    this.scheduleLiveInvalidationFlush();
  }
  private async flushWakeProgressInvalidations(): Promise<void> {
    const pending = this.pendingWakeProgressInvalidationsBySpaceId;
    this.pendingWakeProgressInvalidationsBySpaceId = new Map();
    await Promise.all(
      [...pending.entries()].map(async ([spaceId, targets]) => {
        try {
          const spaceStub = resolveSpaceStub(this.env.OPENMELD_SPACES, spaceId);
          if (!spaceStub) {
            throw new Error(
              "Space stub unavailable for Wake progress invalidation"
            );
          }
          await spaceStub.rpcBroadcastWakeProgressChanged({
            agentProfileIds: [...targets.agentProfileIds],
            clientMessageIds: [...targets.clientMessageIds],
            reason: "runtime_coordinator.wake_progress_changed",
            spaceId,
          });
        } catch (error) {
          const failedAttempts = targets.failedAttempts + 1;
          const willRetry =
            failedAttempts < WAKE_PROGRESS_INVALIDATION_MAX_ATTEMPTS;
          if (willRetry) {
            this.requeueWakeProgressInvalidation(spaceId, {
              ...targets,
              failedAttempts,
            });
          }
          console.warn("[core.wake_progress.invalidation_failed]", {
            error: error instanceof Error ? error.message : String(error),
            failedAttempts,
            reasonCode: "wake.progress.invalidation_failed",
            spaceId,
            willRetry,
          });
        }
      })
    );
  }
  private async processAgentProfileContextMigrationAlarm(
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    for (const profile of await listDrainingAgentProfileContextMigrations(
      this.ctx.storage
    )) {
      if (
        !(await isAgentProfileContextMigrationRetryDue({
          nowMs: Date.now(),
          storage: this.ctx.storage,
          targetProfileId: profile.targetProfileId,
        }))
      ) {
        continue;
      }
      if (
        run &&
        !this.reserveHousekeepingAlarmWorkUnit(run, "context_migration")
      ) {
        return;
      }
      await this.attemptAgentProfileContextMigration(profile);
    }
  }
  private async processAgentProfileWorkPromotionAlarm(
    nowMs: number,
    run?: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    const pendingPromotions = (
      await readPendingAgentProfileWorkPromotions(this.ctx.storage)
    ).sort(
      (left, right) =>
        left.nextAttemptAtMs - right.nextAttemptAtMs ||
        left.targetProfileId.localeCompare(right.targetProfileId)
    );
    for (const pendingPromotion of pendingPromotions) {
      if (pendingPromotion.nextAttemptAtMs > nowMs) {
        break;
      }
      if (
        run &&
        !this.reserveHousekeepingAlarmWorkUnit(
          run,
          "runtime_coordinator_agent_profile_work_promotion"
        )
      ) {
        return;
      }
      await this.requestSpaceDispatchOutboxRedriveForPromotion(
        pendingPromotion,
        "alarm_recovery"
      );
    }
  }
  private async requestSpaceDispatchOutboxRedriveForPromotion(
    pendingPromotion: PendingAgentProfileWorkPromotion,
    trigger: AgentProfileWorkPromotionRedriveTrigger
  ): Promise<void> {
    const nowMs = Date.now();
    try {
      const head = await this.readRuntimeCoordinatorHeadLifecycleRecord(
        pendingPromotion.targetWakeLifecycleId
      );
      if (
        !head ||
        head.primaryDispatchId !== pendingPromotion.dispatchId ||
        head.targetWakeLifecycleIdentity.targetProfileId !==
          pendingPromotion.targetProfileId
      ) {
        throw new Error(
          "runtime_coordinator.agent_profile_work_promotion_head_mismatch"
        );
      }
      if (head.status !== "accepted") {
        if (head.status === "queued") {
          throw new Error(
            "runtime_coordinator.agent_profile_work_promotion_not_accepted"
          );
        }
        await clearPendingAgentProfileWorkPromotion(
          this.ctx.storage,
          pendingPromotion
        );
        await this.syncHousekeepingAlarm();
        return;
      }
      const parsedBody = postSpaceDispatchOutboxRedriveBodySchema.safeParse({
        reason: AGENT_PROFILE_WORK_COORDINATOR_PROMOTION_REDRIVE_REASON,
        targetProfileId: pendingPromotion.targetProfileId,
        targetWakeLifecycleId: pendingPromotion.targetWakeLifecycleId,
      });
      if (!parsedBody.success) {
        throw new Error(
          "runtime_coordinator.agent_profile_work_promotion_request_invalid"
        );
      }
      const identity = head.targetWakeLifecycleIdentity;
      const spaceStub = resolveSpaceStub(
        this.env.OPENMELD_SPACES,
        identity.spaceId
      );
      if (!spaceStub) {
        throw new Error(
          "runtime_coordinator.agent_profile_work_promotion_space_unavailable"
        );
      }
      const redriveUrl = new URL(
        `https://openmeld.internal/internal/dispatches/${encodeURIComponent(pendingPromotion.dispatchId)}/redrive`
      );
      redriveUrl.searchParams.set("space", identity.spaceId);
      const response = await spaceStub.fetch(
        new Request(redriveUrl.toString(), {
          body: JSON.stringify(parsedBody.data),
          headers: {
            "content-type": "application/json",
            [RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_HEADER]:
              AGENT_PROFILE_WORK_COORDINATOR_PROMOTION_REDRIVE_REASON,
          },
          method: "POST",
        })
      );
      const parsedResponse =
        postSpaceDispatchOutboxRedriveResponseSchema.safeParse(
          await response.json().catch(() => null)
        );
      if (!(response.ok && parsedResponse.success && parsedResponse.data.ok)) {
        throw new Error(
          parsedResponse.success && !parsedResponse.data.ok
            ? parsedResponse.data.reasonCode
            : "runtime_coordinator.agent_profile_work_promotion_response_invalid"
        );
      }
      await this.settleAcceptedAgentProfileWorkPromotionRedrive({
        head,
        nowMs,
        pendingPromotion,
        redriveStatus: parsedResponse.data.status,
        spaceId: identity.spaceId,
        trigger,
      });
    } catch (error) {
      const deferred = await deferPendingAgentProfileWorkPromotion({
        expected: pendingPromotion,
        nowMs,
        storage: this.ctx.storage,
      });
      console.warn(
        "[core.runtime_transport.agent_profile_work_promotion_redrive_failed]",
        {
          attemptCount: deferred?.attemptCount ?? pendingPromotion.attemptCount,
          dispatchId: pendingPromotion.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          nextAttemptAtMs: deferred?.nextAttemptAtMs ?? null,
          targetProfileId: pendingPromotion.targetProfileId,
          targetWakeLifecycleId: pendingPromotion.targetWakeLifecycleId,
          trigger,
        }
      );
    }
    await this.syncHousekeepingAlarm();
  }
  private async settleAcceptedAgentProfileWorkPromotionRedrive(input: {
    head: RuntimeCoordinatorHeadLifecycleRecord;
    nowMs: number;
    pendingPromotion: PendingAgentProfileWorkPromotion;
    redriveStatus: "cancelled" | "enqueued" | "retry_scheduled" | "submitted";
    spaceId: string;
    trigger: AgentProfileWorkPromotionRedriveTrigger;
  }): Promise<void> {
    const requiresIdentityReacceptance =
      (input.redriveStatus === "enqueued" ||
        input.redriveStatus === "submitted") &&
      !input.head.acceptedDispatchSnapshot;
    if (
      input.redriveStatus === "retry_scheduled" ||
      requiresIdentityReacceptance
    ) {
      const deferred = await deferPendingAgentProfileWorkPromotion({
        expected: input.pendingPromotion,
        nowMs: input.nowMs,
        storage: this.ctx.storage,
      });
      console.info(
        input.redriveStatus === "retry_scheduled"
          ? "[core.runtime_transport.agent_profile_work_promotion_retry_scheduled]"
          : "[core.runtime_transport.agent_profile_work_promotion_identity_reacceptance_pending]",
        {
          attemptCount:
            deferred?.attemptCount ?? input.pendingPromotion.attemptCount,
          dispatchId: input.pendingPromotion.dispatchId,
          nextAttemptAtMs: deferred?.nextAttemptAtMs ?? null,
          spaceId: input.spaceId,
          targetProfileId: input.pendingPromotion.targetProfileId,
          targetWakeLifecycleId: input.pendingPromotion.targetWakeLifecycleId,
          trigger: input.trigger,
        }
      );
      return;
    }
    await clearPendingAgentProfileWorkPromotion(
      this.ctx.storage,
      input.pendingPromotion
    );
    console.info(
      "[core.runtime_transport.agent_profile_work_promotion_redriven]",
      {
        dispatchId: input.pendingPromotion.dispatchId,
        redriveStatus: input.redriveStatus,
        spaceId: input.spaceId,
        targetProfileId: input.pendingPromotion.targetProfileId,
        targetWakeLifecycleId: input.pendingPromotion.targetWakeLifecycleId,
        trigger: input.trigger,
      }
    );
  }
  private async triggerRuntimeCoordinatorHeadWaitingRecovery(input: {
    ownerUserId: string;
    profileIds: readonly string[] | null;
    trigger:
      | "daemon_session_heartbeat"
      | "daemon_session_registered"
      | "route_catalog_changed";
  }): Promise<void> {
    const nowMs = Date.now();
    await this.processRuntimeCoordinatorHeadWaitingAlarm(nowMs);
    const profileIdSet =
      input.profileIds === null
        ? null
        : new Set(
            input.profileIds.filter(
              (profileId) => typeof profileId === "string" && profileId
            )
          );
    if (profileIdSet && profileIdSet.size === 0) {
      return;
    }
    const records =
      await this.readRuntimeCoordinatorHeadLifecycleRecordsFromIndex();
    for (const record of records) {
      if (
        !isRuntimeCoordinatorHeadWaitingRecoveryCandidate({
          nowMs,
          ownerUserId: input.ownerUserId,
          profileIdSet,
          record,
        })
      ) {
        continue;
      }
      await this.requestSpaceDispatchOutboxRedriveForWaitingHead({
        nowMs,
        record,
        trigger: input.trigger,
      });
    }
  }
  private async requestSpaceDispatchOutboxRedriveForWaitingHead(input: {
    nowMs: number;
    record: RuntimeCoordinatorHeadLifecycleRecord;
    trigger:
      | "daemon_session_heartbeat"
      | "daemon_session_registered"
      | "route_catalog_changed";
  }): Promise<void> {
    const identity = input.record.targetWakeLifecycleIdentity;
    const parsedBody = postSpaceDispatchOutboxRedriveBodySchema.safeParse({
      reason: RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_REASON,
      targetProfileId: identity.targetProfileId,
      targetWakeLifecycleId: input.record.targetWakeLifecycleId,
    });
    if (!parsedBody.success) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_waiting_recovery_invalid]",
        {
          dispatchId: input.record.primaryDispatchId,
          reasonCode:
            "runtime_coordinator.head_waiting_recovery_request_invalid",
          targetWakeLifecycleId: input.record.targetWakeLifecycleId,
          targetProfileId: identity.targetProfileId,
        }
      );
      return;
    }
    const spaceStub = resolveSpaceStub(
      this.env.OPENMELD_SPACES,
      identity.spaceId
    );
    if (!spaceStub) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_waiting_recovery_unavailable]",
        {
          dispatchId: input.record.primaryDispatchId,
          reasonCode: "runtime_coordinator.head_waiting_space_unavailable",
          spaceId: identity.spaceId,
          targetWakeLifecycleId: input.record.targetWakeLifecycleId,
          targetProfileId: identity.targetProfileId,
          trigger: input.trigger,
        }
      );
      return;
    }
    const redriveUrl = new URL(
      `https://openmeld.internal/internal/dispatches/${encodeURIComponent(input.record.primaryDispatchId)}/redrive`
    );
    redriveUrl.searchParams.set("space", identity.spaceId);
    let parsedResponse: PostSpaceDispatchOutboxRedriveResponse | null = null;
    try {
      const response = await spaceStub.fetch(
        new Request(redriveUrl.toString(), {
          body: JSON.stringify(parsedBody.data),
          headers: {
            "content-type": "application/json",
            [RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_HEADER]:
              RUNTIME_COORDINATOR_HEAD_WAITING_RECOVERY_REDRIVE_REASON,
          },
          method: "POST",
        })
      );
      const raw = await response.json().catch(() => null);
      const parsed =
        postSpaceDispatchOutboxRedriveResponseSchema.safeParse(raw);
      if (parsed.success) {
        parsedResponse = parsed.data;
      }
      if (!(response.ok && parsedResponse?.ok)) {
        console.warn(
          "[core.runtime_transport.runtime_coordinator_head_waiting_recovery_failed]",
          {
            dispatchId: input.record.primaryDispatchId,
            httpStatus: response.status,
            reasonCode:
              parsedResponse && !parsedResponse.ok
                ? parsedResponse.reasonCode
                : "runtime_coordinator.head_waiting_recovery_response_invalid",
            spaceId: identity.spaceId,
            targetWakeLifecycleId: input.record.targetWakeLifecycleId,
            targetProfileId: identity.targetProfileId,
            trigger: input.trigger,
          }
        );
        return;
      }
    } catch (error) {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_head_waiting_recovery_failed]",
        {
          dispatchId: input.record.primaryDispatchId,
          error: error instanceof Error ? error.message : String(error),
          reasonCode:
            "runtime_coordinator.head_waiting_recovery_request_failed",
          spaceId: identity.spaceId,
          targetWakeLifecycleId: input.record.targetWakeLifecycleId,
          targetProfileId: identity.targetProfileId,
          trigger: input.trigger,
        }
      );
      return;
    }
    console.info(
      "[core.runtime_transport.runtime_coordinator_head_waiting_recovery_triggered]",
      {
        dispatchId: input.record.primaryDispatchId,
        reasonCode: `runtime_coordinator.head_waiting_recovery_redrive_${parsedResponse.status}`,
        softDeadlineAtMs: input.record.waitingBoundary?.softDeadlineAtMs,
        deadlineAtMs: input.record.waitingBoundary?.deadlineAtMs,
        redriveStatus: parsedResponse.status,
        spaceId: identity.spaceId,
        targetWakeLifecycleId: input.record.targetWakeLifecycleId,
        targetProfileId: identity.targetProfileId,
        trigger: input.trigger,
        triggeredAtMs: input.nowMs,
      }
    );
  }
  private async upsertRuntimeCoordinatorPreExecutionHandoffRecord(input: {
    nowMs: number;
    request: RuntimeTransportPreExecutionHandoffRequest;
  }): Promise<RuntimeCoordinatorPreExecutionHandoffRecord> {
    const existing = await this.readRuntimeCoordinatorPreExecutionHandoffRecord(
      input.request.dispatchId
    );
    if (
      existing?.publicationStatus === "published" ||
      existing?.publicationStatus === "recovered"
    ) {
      return existing;
    }
    const firstSeenAtMs = existing
      ? existing.firstSeenAtMs
      : input.request.firstSeenAtMs;
    const deadlineAtMs = existing
      ? existing.deadlineAtMs
      : firstSeenAtMs + RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_DEADLINE_MS;
    const record: RuntimeCoordinatorPreExecutionHandoffRecord = {
      attemptId: input.request.attemptId ?? existing?.attemptId ?? null,
      autoRelayDepth:
        input.request.autoRelayDepth ?? existing?.autoRelayDepth ?? null,
      createdAtMs: existing?.createdAtMs ?? input.nowMs,
      deadlineAtMs,
      dispatchChainId:
        normalizeOptionalText(input.request.dispatchChainId) ??
        existing?.dispatchChainId ??
        null,
      dispatchId: input.request.dispatchId,
      firstSeenAtMs,
      idempotencyKey: input.request.idempotencyKey,
      modelVersion: RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION,
      nextAlarmAtMs: deadlineAtMs,
      nextPublicationRetryAtMs: existing?.nextPublicationRetryAtMs ?? null,
      observedAtMs: input.request.observedAtMs,
      publicationErrorCode: existing?.publicationErrorCode ?? null,
      publicationStatus: existing?.publicationStatus ?? "waiting_for_recovery",
      publishedSignalId: existing?.publishedSignalId ?? null,
      reasonCode: input.request.reasonCode,
      resultRef: buildPreExecutionHandoffFailureResultRef(
        input.request.dispatchId
      ),
      sourceClientMessageId:
        input.request.sourceClientMessageId ??
        existing?.sourceClientMessageId ??
        null,
      sourceEventId: input.request.sourceEventId,
      spaceId: input.request.spaceId,
      spacePassword:
        input.request.spacePassword ?? existing?.spacePassword ?? null,
      targetProfileId: input.request.targetProfileId,
      targetProfileMentionLabel:
        input.request.targetProfileMentionLabel ??
        existing?.targetProfileMentionLabel ??
        null,
      targetProfileName:
        input.request.targetProfileName ?? existing?.targetProfileName ?? null,
      taskId: input.request.taskId,
      threadContext:
        input.request.threadContext ?? existing?.threadContext ?? null,
      updatedAtMs: input.nowMs,
      visitedProfileIds:
        input.request.visitedProfileIds ?? existing?.visitedProfileIds ?? [],
      visitedProfileIdsHash:
        normalizeOptionalText(input.request.visitedProfileIdsHash) ??
        existing?.visitedProfileIdsHash ??
        null,
    };
    await this.writeRuntimeCoordinatorPreExecutionHandoffRecord(record);
    return record;
  }
  private async markRuntimeCoordinatorPreExecutionHandoffRecovered(
    dispatchId: string
  ): Promise<void> {
    const existing =
      await this.readRuntimeCoordinatorPreExecutionHandoffRecord(dispatchId);
    if (!existing || existing.publicationStatus === "published") {
      return;
    }
    await this.writeRuntimeCoordinatorPreExecutionHandoffRecord({
      ...existing,
      publicationStatus: "recovered",
      updatedAtMs: Date.now(),
    });
  }
  private async markRuntimeCoordinatorPreExecutionHandoffLegacyEvidenceOnly(input: {
    nowMs: number;
    record: RuntimeCoordinatorPreExecutionHandoffRecord;
  }): Promise<RuntimeCoordinatorPreExecutionHandoffRecord> {
    const record: RuntimeCoordinatorPreExecutionHandoffRecord = {
      ...input.record,
      nextPublicationRetryAtMs: null,
      publicationErrorCode: null,
      publicationStatus: "legacy_evidence_only",
      publishedSignalId: null,
      updatedAtMs: input.nowMs,
    };
    await this.writeRuntimeCoordinatorPreExecutionHandoffRecord(record);
    await this.recordRuntimeCoordinatorPreExecutionHandoffOpsDecision({
      decisionCode:
        "runtime_coordinator.pre_execution_handoff_legacy_evidence_only",
      expectedRecoveryCriteria:
        "Legacy pre-execution handoff remains diagnostic evidence only; RuntimeCoordinator head lifecycle owns waiting boundaries and Phase 6 publication intent.",
      nowMs: input.nowMs,
      record,
    });
    return record;
  }
  private async recordRuntimeCoordinatorPreExecutionHandoffOpsDecision(input: {
    decisionCode: string;
    expectedRecoveryCriteria: string;
    nowMs: number;
    record: RuntimeCoordinatorPreExecutionHandoffRecord;
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: input.decisionCode,
      decisionPayload: {
        deadlineAtMs: input.record.deadlineAtMs,
        dispatchId: input.record.dispatchId,
        firstSeenAtMs: input.record.firstSeenAtMs,
        nextPublicationRetryAtMs: input.record.nextPublicationRetryAtMs,
        publicationErrorCode: input.record.publicationErrorCode,
        publicationStatus: input.record.publicationStatus,
        publishedSignalId: input.record.publishedSignalId,
        reasonCode: input.record.reasonCode,
        resultRef: input.record.resultRef,
        sourceClientMessageId: input.record.sourceClientMessageId,
        sourceEventId: input.record.sourceEventId,
        spaceId: input.record.spaceId,
        targetProfileId: input.record.targetProfileId,
      },
      decidedBy: "runtime_coordinator.pre_execution_handoff",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria: input.expectedRecoveryCriteria,
      source: "runtime_coordinator_pre_execution_handoff",
      correlationId: input.record.dispatchId,
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_pre_execution_handoff_ops_failed]",
        {
          decisionCode: input.decisionCode,
          dispatchId: input.record.dispatchId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    });
  }
  private async writeRuntimeCoordinatorPreExecutionHandoffRecord(
    record: RuntimeCoordinatorPreExecutionHandoffRecord
  ): Promise<void> {
    await writeRuntimeCoordinatorPreExecutionHandoffRecordToStorage(
      this.ctx.storage,
      record
    );
  }
  private async readRuntimeCoordinatorPreExecutionHandoffRecord(
    dispatchId: string
  ): Promise<RuntimeCoordinatorPreExecutionHandoffRecord | null> {
    return await readRuntimeCoordinatorPreExecutionHandoffRecordFromStorage(
      this.ctx.storage,
      dispatchId
    );
  }
  private async deleteRuntimeCoordinatorPreExecutionHandoffRecord(
    dispatchId: string
  ): Promise<void> {
    await deleteRuntimeCoordinatorPreExecutionHandoffRecordFromStorage(
      this.ctx.storage,
      dispatchId
    );
  }
  private async readRuntimeCoordinatorPreExecutionHandoffRecordsFromIndex(): Promise<
    RuntimeCoordinatorPreExecutionHandoffRecord[]
  > {
    return await readRuntimeCoordinatorPreExecutionHandoffRecordsFromStorageIndex(
      this.ctx.storage
    );
  }
  private async resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMs(): Promise<
    number | null
  > {
    const records =
      await this.readRuntimeCoordinatorPreExecutionHandoffRecordsFromIndex();
    return resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMsFromRecords(
      {
        nowMs: Date.now(),
        records,
      }
    );
  }
  private createHousekeepingAlarmRun(
    nowMs: number
  ): RuntimeTransportHubHousekeepingAlarmRun {
    return {
      continuationReasonCode: null,
      continuationRequired: false,
      deadlineAtMs: nowMs + RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_MAX_RUN_MS,
      processedWorkUnits: 0,
    };
  }
  private async runHousekeepingAlarmPhase(
    run: RuntimeTransportHubHousekeepingAlarmRun,
    phase: RuntimeTransportHubHousekeepingAlarmPhase,
    execute: () => Promise<void>
  ): Promise<void> {
    if (
      run.continuationRequired ||
      !(await this.getAlarmFailureBackoff().canRun(phase, Date.now()))
    ) {
      return;
    }
    try {
      await execute();
      await this.getAlarmFailureBackoff().succeeded(phase);
    } catch (error) {
      const retryAtMs = await this.getAlarmFailureBackoff().failed(
        phase,
        Date.now()
      );
      console.warn("[core.runtime_transport.housekeeping_alarm_phase_failed]", {
        error: error instanceof Error ? error.message : String(error),
        phase,
        retryAtMs,
      });
    }
  }

  private alarmFailureBackoff: AlarmFailureBackoff | undefined;
  private getAlarmFailureBackoff(): AlarmFailureBackoff {
    this.alarmFailureBackoff ??= new AlarmFailureBackoff(this.ctx.storage);
    return this.alarmFailureBackoff;
  }
  private reserveHousekeepingAlarmWorkUnit(
    run: RuntimeTransportHubHousekeepingAlarmRun,
    phase: RuntimeTransportHubHousekeepingAlarmPhase
  ): boolean {
    if (run.continuationRequired) {
      return false;
    }
    if (Date.now() >= run.deadlineAtMs) {
      this.requestHousekeepingAlarmContinuation(
        run,
        "runtime_coordinator.housekeeping_time_budget_exhausted"
      );
      console.warn(
        "[core.runtime_transport.housekeeping_alarm_budget_exhausted]",
        {
          phase,
          processedWorkUnits: run.processedWorkUnits,
          reasonCode: run.continuationReasonCode,
        }
      );
      return false;
    }
    if (
      run.processedWorkUnits >=
      RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_MAX_WORK_UNITS
    ) {
      this.requestHousekeepingAlarmContinuation(
        run,
        "runtime_coordinator.housekeeping_work_budget_exhausted"
      );
      console.warn(
        "[core.runtime_transport.housekeeping_alarm_budget_exhausted]",
        {
          phase,
          processedWorkUnits: run.processedWorkUnits,
          reasonCode: run.continuationReasonCode,
        }
      );
      return false;
    }
    run.processedWorkUnits += 1;
    return true;
  }
  private requestHousekeepingAlarmContinuation(
    run: RuntimeTransportHubHousekeepingAlarmRun,
    reasonCode: string
  ): void {
    if (run.continuationRequired) {
      return;
    }
    run.continuationRequired = true;
    run.continuationReasonCode = reasonCode;
  }
  private async settleHousekeepingAlarmRun(
    run: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    if (run.continuationRequired) {
      await this.scheduleHousekeepingAlarmContinuation(run);
      return;
    }
    try {
      await this.syncHousekeepingAlarm();
      await this.getAlarmFailureBackoff().succeeded("alarm");
    } catch (error) {
      this.requestHousekeepingAlarmContinuation(
        run,
        "runtime_coordinator.housekeeping_sync_failed"
      );
      console.warn("[core.runtime_transport.housekeeping_alarm_sync_failed]", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.scheduleHousekeepingAlarmContinuation(run);
    }
  }
  private async scheduleHousekeepingAlarmContinuation(
    run: RuntimeTransportHubHousekeepingAlarmRun
  ): Promise<void> {
    const failed =
      run.continuationReasonCode ===
        "runtime_coordinator.housekeeping_alarm_failed" ||
      run.continuationReasonCode ===
        "runtime_coordinator.housekeeping_sync_failed";
    const alarmAtMs = failed
      ? await this.getAlarmFailureBackoff().failed("alarm", Date.now())
      : Date.now() +
        RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_CONTINUATION_DELAY_MS;
    if (!failed) {
      await this.getAlarmFailureBackoff().succeeded("alarm");
    }
    await this.ctx.storage.setAlarm(alarmAtMs);
    this.scheduledHousekeepingAlarmAtMs = alarmAtMs;
    console.warn(
      "[core.runtime_transport.housekeeping_alarm_continuation_scheduled]",
      {
        alarmAtMs,
        processedWorkUnits: run.processedWorkUnits,
        reasonCode:
          run.continuationReasonCode ??
          "runtime_coordinator.housekeeping_continuation_required",
      }
    );
  }
  private async syncHousekeepingAlarm(): Promise<void> {
    const nowMs = Date.now();
    const ownerAlarmAtMs = await this.getAlarmFailureBackoff().nextAlarmAt({
      alarm: null,
      runtime_coordinator_finalization_retry:
        await this.resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMs(),
      local_agent_stream_closure_retry:
        await this.resolveNextLocalAgentStreamClosureRetryAlarmAtMs(),
      runtime_coordinator_agent_profile_work_recovery_inbox:
        await readNextAgentProfileWorkRecoveryInboxProjectionAlarmAtMs(
          this.ctx.storage,
          nowMs
        ),
      runtime_coordinator_watchdog:
        await this.resolveNextRuntimeCoordinatorWatchdogAlarmAtMs(),
      runtime_coordinator_agent_profile_work_promotion:
        await readNextPendingAgentProfileWorkPromotionAlarmAtMs(
          this.ctx.storage
        ),
      runtime_coordinator_agent_profile_execution_index:
        await readRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarmAtMs(
          this.ctx.storage,
          nowMs
        ),
      runtime_coordinator_head_accepted_handoff:
        await this.resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMs(),
      runtime_coordinator_head_waiting:
        await this.resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMs(),
      runtime_coordinator_head_failure_publication:
        await this.resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMs(),
      runtime_coordinator_pre_execution_handoff:
        await this.resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMs(),
      runtime_coordinator_agent_task_observation_delivery:
        await this.resolveNextRuntimeCoordinatorAgentTaskObservationDeliveryAlarmAtMs(),
      runtime_coordinator_stopped_task_projection:
        await this.resolveNextRuntimeCoordinatorStoppedTaskProjectionAlarmAtMs(),
      runtime_coordinator_interaction_inbox_projection:
        await this.resolveNextRuntimeCoordinatorInteractionInboxRepairAlarmAtMs(),
      transport: resolveNextRuntimeTransportAlarmAtMs(this.state),
      computer_connection_incidents:
        (await this.getComputerConnectionIncidents()?.nextAlarmAtMs()) ?? null,
      context_migration: await resolveNextAgentProfileContextMigrationAlarmAtMs(
        {
          storage: this.ctx.storage,
          nowMs,
        }
      ),
    });
    const alarmRetryAtMs = await this.getAlarmFailureBackoff().retryAt("alarm");
    const nextAlarmAtMs =
      ownerAlarmAtMs === null
        ? alarmRetryAtMs
        : Math.max(ownerAlarmAtMs, alarmRetryAtMs ?? 0);
    const scheduledAlarmAtMs = await this.readScheduledHousekeepingAlarmAtMs();
    const nextMutation = reconcileRuntimeTransportAlarmAtMs({
      nowMs,
      nextRequiredAlarmAtMs: nextAlarmAtMs,
      scheduledAlarmAtMs,
    });
    if (nextMutation.kind === "keep") {
      this.scheduledHousekeepingAlarmAtMs = nextMutation.alarmAtMs;
      return;
    }
    if (nextMutation.kind === "delete") {
      await this.ctx.storage.deleteAlarm();
      this.scheduledHousekeepingAlarmAtMs = null;
      return;
    }
    await this.ctx.storage.setAlarm(nextMutation.alarmAtMs);
    this.scheduledHousekeepingAlarmAtMs = nextMutation.alarmAtMs;
  }
  private queueHousekeepingAlarmSync(): void {
    this.ctx.waitUntil(this.syncHousekeepingAlarm());
  }
  private queueRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarm(): void {
    const alarmAtMs =
      Date.now() +
      RUNTIME_TRANSPORT_HUB_HOUSEKEEPING_ALARM_CONTINUATION_DELAY_MS;
    this.ctx.waitUntil(
      (async () => {
        const scheduledAlarmAtMs =
          await this.readScheduledHousekeepingAlarmAtMs();
        if (scheduledAlarmAtMs !== null && scheduledAlarmAtMs <= alarmAtMs) {
          return;
        }
        await this.ctx.storage.setAlarm(alarmAtMs);
        this.scheduledHousekeepingAlarmAtMs = alarmAtMs;
      })()
    );
  }
  private async readScheduledHousekeepingAlarmAtMs(): Promise<number | null> {
    if (this.scheduledHousekeepingAlarmAtMs !== undefined) {
      return this.scheduledHousekeepingAlarmAtMs;
    }
    const scheduledAlarmAtMs = await this.ctx.storage.getAlarm();
    this.scheduledHousekeepingAlarmAtMs = scheduledAlarmAtMs;
    return scheduledAlarmAtMs;
  }
  private async resolveNextRuntimeCoordinatorStoppedTaskProjectionAlarmAtMs(): Promise<
    number | null
  > {
    const publicationIds =
      await this.readRuntimeCoordinatorStoppedTaskProjectionPublicationIds();
    return publicationIds.length > 0 ? Date.now() : null;
  }
  private async resolveNextRuntimeCoordinatorAgentTaskObservationDeliveryAlarmAtMs(): Promise<
    number | null
  > {
    const deliveries =
      await readRuntimeCoordinatorAgentTaskObservationDeliveriesFromIndex(
        this.ctx.storage
      );
    return deliveries.length > 0 ? Date.now() : null;
  }
  private async resolveNextRuntimeCoordinatorInteractionInboxRepairAlarmAtMs(): Promise<
    number | null
  > {
    const storedRecords =
      await this.ctx.storage.list<RuntimeCoordinatorInteractionInboxRepairRecord>(
        {
          prefix: RUNTIME_COORDINATOR_INTERACTION_INBOX_REPAIR_STORAGE_PREFIX,
        }
      );
    let nextAlarmAtMs: number | null = null;
    for (const record of storedRecords.values()) {
      if (record.v !== 1) {
        continue;
      }
      nextAlarmAtMs = minNullableTimestamp(
        nextAlarmAtMs,
        record.nextAttemptAtMs
      );
    }
    return nextAlarmAtMs;
  }
  private async resolveNextRuntimeCoordinatorWatchdogAlarmAtMs(): Promise<
    number | null
  > {
    return await readNextRuntimeCoordinatorWatchdogAlarmAtMs(
      this.ctx.storage,
      Date.now()
    );
  }
  private async resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMs(): Promise<
    number | null
  > {
    const retryEntries = await this.readRuntimeCoordinatorFinalizationRetries();
    return resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMsFromEntries({
      nowMs: Date.now(),
      retryEntries,
    });
  }
  private async resolveNextLocalAgentStreamClosureRetryAlarmAtMs(): Promise<
    number | null
  > {
    return await readNextLocalAgentStreamClosureRetryAtMs(this.ctx.storage);
  }
  private readonly persistRuntimeRecords = (): void => {
    persistServiceRuntimeRecords(this.ctx, this.state);
    this.ctx.waitUntil(
      this.observeComputerConnectionIncidents().then(() =>
        this.syncHousekeepingAlarm()
      )
    );
  };
  private computerConnectionIncidents:
    | ReturnType<typeof createComputerConnectionIncidents>
    | undefined;
  private getComputerConnectionIncidents() {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return undefined;
    }
    this.computerConnectionIncidents ??= createComputerConnectionIncidents({
      storage: this.ctx.storage,
      db,
    });
    return this.computerConnectionIncidents;
  }
  private async observeComputerConnectionIncidents(
    propagateFailure = false
  ): Promise<void> {
    try {
      await this.getComputerConnectionIncidents()?.observe(
        this.state.sessionsById.values()
      );
    } catch (error) {
      console.warn("[core.computer_connection.incident_observation_failed]", {
        error,
      });
      if (propagateFailure) {
        throw error;
      }
    }
  }
  private readonly cleanupExpiredPendingDispatches = (nowMs: number): void => {
    cleanupExpiredPendingDispatches(this.state, nowMs);
  };
  private readonly publishReapedReadinessProfiles = (result: {
    expiredProfileIds: readonly string[];
    removedSessionProfileIds: readonly string[];
  }): void => {
    this.publishAgentReadinessInvalidated({
      profileIds: [
        ...result.expiredProfileIds,
        ...result.removedSessionProfileIds,
      ],
      reason: "daemon.route_lease.expired",
    });
  };
  private readonly cleanupCompletedResults = (nowMs: number): void => {
    cleanupCompletedResults(this.state, nowMs);
  };
  private readonly resolvePendingResultWaiters = (
    dispatchAttemptKey: string,
    response: WaitDispatchResultResponse
  ): void => {
    resolvePendingResultWaiters(this.state, dispatchAttemptKey, response);
  };
  private readonly failPendingDispatchResultWaitersForConnectionGeneration = (
    daemonSessionId: string,
    connectionGeneration: number,
    response: WaitDispatchResultResponse
  ): void => {
    failPendingDispatchResultWaitersForConnectionGeneration(
      this.state,
      daemonSessionId,
      connectionGeneration,
      response
    );
  };
  private readonly reapExpiredLeases = (nowMs: number): void => {
    reapExpiredLeases(this.state, nowMs, {
      persistRuntimeRecords: this.persistRuntimeRecords,
      cleanupExpiredPendingDispatches: this.cleanupExpiredPendingDispatches,
      recordReapedReadinessProfiles: this.publishReapedReadinessProfiles,
    });
  };
  private resolveRuntimeCoordinatorWakeStopControlSession(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    controlMode: RuntimeCoordinatorWakeStopControlMode;
  }):
    | {
        ok: true;
        session: RuntimeTransportSessionState & {
          socket: WebSocket;
        };
      }
    | {
        ok: false;
        reasonCode: string;
      } {
    const provenance = input.commandState.lastDeliveryProvenance;
    const session = this.state.sessionsById.get(provenance.daemonSessionId);
    if (!session?.socket) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.wake_stop_service_offline",
      };
    }
    if (
      session.ownerUserId !== input.commandState.ownerUserId ||
      session.connectionGeneration !== provenance.connectionGeneration ||
      !session.profileIds.has(input.commandState.profileId)
    ) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.wake_stop_route_mismatch",
      };
    }
    const lease = this.state.profileLeasesByProfileId.get(
      input.commandState.profileId
    );
    if (
      !lease ||
      lease.daemonSessionId !== session.daemonSessionId ||
      lease.deviceId !== session.deviceId ||
      lease.lane !== session.lane ||
      lease.leaseEpoch !== provenance.leaseEpoch
    ) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.wake_stop_stale_lease",
      };
    }
    if (!isDaemonExecutionCompatible(session.executionCompatibility)) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.wake_stop_service_update_required",
      };
    }
    if (session.capabilities.localAgentControl?.[input.controlMode] !== true) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.wake_stop_transport_unsupported",
      };
    }
    return {
      ok: true,
      session: session as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private async recordRuntimeCoordinatorWakeStopDeliveryEvent(input: {
    commandState: RuntimeCoordinatorRunCommandState;
    controlMode: RuntimeCoordinatorWakeStopControlMode;
    errorMessage?: string;
    eventType:
      | "cancellation_delivery_accepted"
      | "cancellation_delivery_rejected";
    nowMs: number;
    reasonCode: string;
    reliability: RuntimeCoordinatorWakeStopControlReliability;
    requestId: string;
  }): Promise<void> {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db,
      eventType: input.eventType,
      idempotencyKey: `wake-stop-delivery:${input.eventType}:${input.requestId}`,
      observedAtMs: input.nowMs,
      payload: {
        connectionGeneration:
          input.commandState.lastDeliveryProvenance.connectionGeneration,
        controlMode: input.controlMode,
        daemonSessionId:
          input.commandState.lastDeliveryProvenance.daemonSessionId,
        errorMessage: input.errorMessage ?? null,
        leaseEpoch: input.commandState.lastDeliveryProvenance.leaseEpoch,
        reliability: input.reliability,
        requestId: input.requestId,
      },
      reasonCode: input.reasonCode,
      runtimeCoordinatorExecutionId:
        input.commandState.runtimeCoordinatorExecutionId,
      statusAfter: "cancellation_requested",
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_wake_stop_delivery_event_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          eventType: input.eventType,
          requestId: input.requestId,
          runtimeCoordinatorExecutionId:
            input.commandState.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private async settleRuntimeCoordinatorWakeStopLocalControlResult(input: {
    daemonSessionId: string;
    payload: RuntimeCoordinatorWakeStopControlPayload;
    requestId: string;
  }): Promise<void> {
    const runtimeCoordinatorExecutionId =
      parseRuntimeCoordinatorWakeStopControlRequestId(input.requestId);
    if (!runtimeCoordinatorExecutionId) {
      return;
    }
    const db = getPostgresDatabase(this.env);
    if (!db) {
      return;
    }
    const [commandState, projection, authority] = await Promise.all([
      this.readRuntimeCoordinatorRunCommandState(runtimeCoordinatorExecutionId),
      readRuntimeCoordinatorExecutionProjectionById({
        db,
        runtimeCoordinatorExecutionId,
      }).catch(() => null),
      this.readRuntimeCoordinatorTokenAuthority(
        runtimeCoordinatorExecutionId
      ).catch(() => null),
    ]);
    if (projection?.status === "cancelled") {
      await this.publishAlreadyCancelledRuntimeCoordinatorWakeStopNotice({
        commandState,
        payload: input.payload,
      });
      return;
    }
    const nowMs = Date.now();
    const effectivePayload = resolveEffectiveRuntimeCoordinatorWakeStopPayload({
      commandState,
      payload: input.payload,
      projection,
    });
    if (!effectivePayload.accepted) {
      await this.recordRuntimeCoordinatorWakeStopControlResultEvent({
        db,
        daemonSessionId: input.daemonSessionId,
        eventType: "cancellation_control_rejected",
        nowMs,
        payload: effectivePayload,
        reasonCode:
          effectivePayload.reasonCode ??
          "runtime_coordinator.wake_stop_local_control_rejected",
        requestId: input.requestId,
        runtimeCoordinatorExecutionId,
        statusAfter: projection?.status ?? null,
      });
      return;
    }
    // A truthful withdrawal acknowledgement is worth keeping even when the Wake
    // Stop lifecycle cannot advance. Core may have already closed this
    // execution on stale evidence, and discarding the one fact that proves the
    // local attempt is gone would leave replacement work nothing to verify.
    await this.recordRuntimeCoordinatorLocalAttemptWithdrawn({
      daemonSessionId: input.daemonSessionId,
      nowMs,
      payload: effectivePayload,
      runtimeCoordinatorExecutionId,
    });
    const rejectionReasonCode =
      resolveRuntimeCoordinatorWakeStopAcceptedControlRejectionReason({
        authority,
        commandState,
        daemonSessionId: input.daemonSessionId,
        payload: effectivePayload,
        projection,
        runtimeCoordinatorExecutionId,
      });
    if (rejectionReasonCode) {
      await this.recordRuntimeCoordinatorWakeStopControlResultEvent({
        db,
        daemonSessionId: input.daemonSessionId,
        eventType: "cancellation_control_rejected",
        nowMs,
        payload: effectivePayload,
        reasonCode: rejectionReasonCode,
        requestId: input.requestId,
        runtimeCoordinatorExecutionId,
        statusAfter: projection?.status ?? null,
      });
      return;
    }
    if (!(commandState && projection && authority)) {
      return;
    }
    const reasonCode =
      effectivePayload.reasonCode ??
      RUNTIME_COORDINATOR_WAKE_STOP_LOCAL_CONTROL_ACCEPTED_REASON_CODE;
    const settlement =
      await this.settleRuntimeCoordinatorWakeStopAuthorityAndCommand({
        authority,
        commandState,
        nowMs,
        reasonCode,
      });
    if (settlement.status !== "settled") {
      return;
    }
    const settledCommandState = settlement.commandState;
    this.publishAgentReadinessInvalidated({
      profileIds: [authority.executionScope.targetProfileId],
      reason: "agent_profile_work_coordinator.changed",
    });
    if (settlement.pendingPromotion) {
      await this.requestSpaceDispatchOutboxRedriveForPromotion(
        settlement.pendingPromotion,
        "terminal_transaction"
      );
    }
    await writeRuntimeCoordinatorTerminalExecutionProjectionWithoutRead({
      db,
      record: buildRuntimeCoordinatorCancelledExecutionRecord({
        nowMs,
        reasonCode,
        record: projection,
      }),
    });
    const publication = await this.publishRuntimeCoordinatorWakeStoppedNotice({
      commandState: settledCommandState,
      nowMs,
      reasonCode,
      stopReason: settledCommandState.stopReason ?? null,
    });
    if (!publication.ok) {
      const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
        clientMessageId: settledCommandState.sourceClientMessageId,
        dispatchId: settledCommandState.dispatchId,
        sourceSignalId:
          settledCommandState.sanitizedDeliveryRequest.payload.sourceEventId,
        spaceId: settledCommandState.sanitizedDeliveryRequest.payload.spaceId,
        targetProfileId: settledCommandState.targetProfileId,
      });
      await this.writeRuntimeCoordinatorPublicationBlocker({
        blockerId: buildRuntimeCoordinatorWakeStoppedNoticePublicationId(
          runtimeCoordinatorExecutionId
        ),
        blockerKind: "publication_unavailable",
        db,
        dispatchId: settledCommandState.dispatchId,
        nowMs,
        publicationKind: "stopped_notice",
        reasonCode: publication.reasonCode,
        runtimeCoordinatorExecutionId,
        spaceId: settledCommandState.sanitizedDeliveryRequest.payload.spaceId,
        targetProfileId: settledCommandState.targetProfileId,
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
      });
    }
    await this.closeLocalAgentStreamOrScheduleRetry({
      attemptId: settledCommandState.sanitizedDeliveryRequest.attemptId,
      dispatchId: settledCommandState.dispatchId,
      runtimeCoordinatorExecutionId,
      spaceId: settledCommandState.sanitizedDeliveryRequest.payload.spaceId,
      terminal: buildStoppedLocalAgentStreamTerminal(reasonCode),
    });
    await this.recordRuntimeCoordinatorWakeStopControlResultEvent({
      db,
      daemonSessionId: input.daemonSessionId,
      eventType: "cancellation_control_accepted",
      nowMs,
      payload: effectivePayload,
      publication,
      reasonCode,
      requestId: input.requestId,
      runtimeCoordinatorExecutionId,
      statusAfter: "cancelled",
    });
  }
  /**
   * Keeps the Service's acknowledgement that one exact attempt is gone.
   *
   * Identity is checked against this run rather than the Wake Stop lifecycle:
   * the same session that received the delivery, the same execution, dispatch
   * and task, and the run the token authority still calls current. A stale
   * acknowledgement from an earlier run therefore cannot retire a newer one.
   */
  private async recordRuntimeCoordinatorLocalAttemptWithdrawn(input: {
    daemonSessionId: string;
    nowMs: number;
    payload: RuntimeCoordinatorWakeStopControlPayload;
    runtimeCoordinatorExecutionId: string;
  }): Promise<void> {
    if (
      input.payload.resolvedRuntimeCoordinatorExecutionId !==
        input.runtimeCoordinatorExecutionId ||
      !(input.payload.resolvedDispatchId && input.payload.resolvedTaskId)
    ) {
      return;
    }
    // Accepting a cancellation is not the same fact as the attempt being gone.
    // A signal can be registered before the provider turn is acknowledged, and
    // interrupting a started turn leaves its result and effects standing. Only
    // an adapter that states it withdrew the attempt before any turn began has
    // supplied what replacement work needs; a Service that predates this says
    // only `accepted`, which stays unproven rather than becoming permission.
    if (
      input.payload.reasonCode !==
      OPENMELD_DAEMON_CANCEL_WITHDRAWN_BEFORE_START_REASON_CODE
    ) {
      return;
    }
    const withdrawn =
      await recordRuntimeCoordinatorLocalAttemptWithdrawnInStorage({
        daemonSessionId: input.daemonSessionId,
        nowMs: input.nowMs,
        reasonCode: input.payload.reasonCode ?? null,
        resolvedDispatchId: input.payload.resolvedDispatchId,
        resolvedTaskId: input.payload.resolvedTaskId,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        storage: this.ctx.storage,
      }).catch((error) => {
        console.warn(
          "[core.runtime_transport.local_attempt_withdrawal_unrecorded]",
          {
            error: error instanceof Error ? error.message : String(error),
            runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
          }
        );
        return null;
      });
    if (withdrawn) {
      this.publishWakeProgressChanged({
        agentProfileId: withdrawn.targetProfileId,
        clientMessageId: withdrawn.sourceClientMessageId,
        spaceId: withdrawn.sanitizedDeliveryRequest.payload.spaceId,
      });
    }
  }
  private async publishAlreadyCancelledRuntimeCoordinatorWakeStopNotice(input: {
    commandState: RuntimeCoordinatorRunCommandState | null;
    payload: RuntimeCoordinatorWakeStopControlPayload;
  }): Promise<void> {
    if (!(input.payload.accepted && input.commandState)) {
      return;
    }
    await this.publishRuntimeCoordinatorWakeStoppedNotice({
      commandState: input.commandState,
      nowMs: Date.now(),
      reasonCode:
        input.payload.reasonCode ??
        RUNTIME_COORDINATOR_WAKE_STOP_LOCAL_CONTROL_ACCEPTED_REASON_CODE,
      stopReason: input.commandState.stopReason ?? null,
    });
  }
  private async settleRuntimeCoordinatorWakeStopAuthorityAndCommand(input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    commandState: RuntimeCoordinatorRunCommandState;
    nowMs: number;
    reasonCode: string;
  }): Promise<
    | {
        commandState: RuntimeCoordinatorRunCommandState;
        pendingPromotion: PendingAgentProfileWorkPromotion | null;
        status: "settled";
      }
    | {
        status: "stale";
      }
  > {
    return await this.ctx.storage.transaction(async (transaction) => {
      const [currentCommandState, currentAuthority] = await Promise.all([
        readRuntimeCoordinatorRunCommandStateFromStorage(
          transaction,
          input.commandState.runtimeCoordinatorExecutionId
        ),
        readRuntimeCoordinatorTokenAuthorityFromStorage(
          transaction,
          input.authority.runtimeCoordinatorExecutionId
        ),
      ]);
      const activeTokenRun = currentAuthority?.currentRunId
        ? currentAuthority.runsById[currentAuthority.currentRunId]
        : null;
      if (
        !(currentCommandState && currentAuthority) ||
        currentCommandState.activeRunId !== input.commandState.activeRunId ||
        currentCommandState.attemptId !== input.commandState.attemptId ||
        currentAuthority.currentRunId !== input.authority.currentRunId ||
        currentAuthority.terminalOutcome !== null ||
        !activeTokenRun ||
        activeTokenRun.tokenStatus !== "active" ||
        ![
          RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
          "runtime_coordinator.wake_stop_delivery_pending",
        ].includes(currentCommandState.lastCommandReasonCode ?? "")
      ) {
        return { status: "stale" as const };
      }
      const nextAuthority =
        settleRuntimeCoordinatorAuthorityForCancellationAccepted({
          authority: currentAuthority,
          nowMs: input.nowMs,
          reasonCode: input.reasonCode,
        });
      const nextCommandState: RuntimeCoordinatorRunCommandState = {
        ...currentCommandState,
        lastCommandReasonCode: input.reasonCode,
        lastWatchdogCheckAtMs: null,
        updatedAtMs: input.nowMs,
      };
      const pendingPromotion =
        await writeRuntimeCoordinatorTokenAuthorityInTransaction(
          transaction,
          nextAuthority,
          input.nowMs
        );
      await writeRuntimeCoordinatorRunCommandStateInTransaction(
        transaction,
        nextCommandState
      );
      return {
        commandState: nextCommandState,
        pendingPromotion,
        status: "settled" as const,
      };
    });
  }
  private async recordRuntimeCoordinatorWakeStopControlResultEvent(input: {
    daemonSessionId: string;
    db: PostgresDatabase;
    eventType:
      | "cancellation_control_accepted"
      | "cancellation_control_rejected";
    nowMs: number;
    payload: RuntimeCoordinatorWakeStopControlPayload;
    publication?: RuntimeCoordinatorWakeStoppedNoticePublicationResult;
    reasonCode: string;
    requestId: string;
    runtimeCoordinatorExecutionId: string;
    statusAfter: RuntimeCoordinatorExecutionStatus | null;
  }): Promise<void> {
    await writeRuntimeCoordinatorExecutionEventFromParts({
      db: input.db,
      eventType: input.eventType,
      idempotencyKey: `wake-stop-control:${input.eventType}:${input.requestId}`,
      observedAtMs: input.nowMs,
      payload: {
        accepted: input.payload.accepted,
        daemonSessionId: input.daemonSessionId,
        note: input.payload.note ?? null,
        requestId: input.requestId,
        resolvedDispatchId: input.payload.resolvedDispatchId ?? null,
        resolvedRuntimeCoordinatorExecutionId:
          input.payload.resolvedRuntimeCoordinatorExecutionId ?? null,
        resolvedTaskId: input.payload.resolvedTaskId ?? null,
        ...(input.publication
          ? {
              stoppedNoticePublication: input.publication.ok
                ? {
                    publishedSignalId: input.publication.publishedSignalId,
                    status: input.publication.status,
                  }
                : {
                    reasonCode: input.publication.reasonCode,
                    status: input.publication.status,
                  },
            }
          : {}),
        target: input.payload.target,
      },
      reasonCode: input.reasonCode,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      statusAfter: input.statusAfter,
    }).catch((error) => {
      console.warn(
        "[core.runtime_transport.runtime_coordinator_wake_stop_control_event_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          eventType: input.eventType,
          requestId: input.requestId,
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        }
      );
    });
  }
  private handleCurrentComputerControlRequest(
    request: Request,
    pathname: string
  ): Promise<Response> | undefined {
    const localFolderPickerOperation =
      LOCAL_FOLDER_PICKER_OPERATIONS_BY_PATH[pathname];
    if (localFolderPickerOperation) {
      return this.handleLocalFolderPickerRequest(
        request,
        localFolderPickerOperation
      );
    }
    const localProjectControlOperation =
      LOCAL_PROJECT_CONTROL_OPERATIONS_BY_PATH[pathname];
    if (localProjectControlOperation) {
      return this.handleLocalProjectControlRequest(
        request,
        localProjectControlOperation
      );
    }
    const computerFileAccessOperation =
      COMPUTER_FILE_ACCESS_OPERATIONS_BY_PATH[pathname];
    if (computerFileAccessOperation) {
      return this.handleComputerFileAccessRequest(
        request,
        computerFileAccessOperation
      );
    }
    if (pathname === "/computer-power") {
      return this.handleComputerPowerRequest(request);
    }
    if (pathname === "/session-history") {
      return this.handleSessionHistoryRequest(request);
    }
    return undefined;
  }
  private async handleSessionHistoryRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportSessionHistoryRequestSchema.safeParse(
      await readJsonBody(request)
    );
    const failure = (
      code: "denied" | "unavailable" | "unsupported" | "failed",
      message: string
    ) => Response.json({ kind: "error", code, message });
    if (!parsed.success) {
      return failure("denied", "Invalid session history request.");
    }
    const input = parsed.data;
    const session = [...this.state.sessionsById.values()]
      .filter(
        (candidate) =>
          candidate.ownerUserId === input.ownerUserId &&
          candidate.deviceId === input.deviceId &&
          candidate.lane === input.lane
      )
      .sort(compareRuntimeTransportSessionsByFreshness)[0];
    if (!session?.socket) {
      return failure(
        "unavailable",
        "Reconnect this Computer to read history or change access."
      );
    }
    if (
      !isDaemonExecutionCompatible(session.executionCompatibility) ||
      session.capabilities.sessionHistory !== true
    ) {
      return failure(
        "unsupported",
        "Update OpenMeld Service to use session history."
      );
    }
    if (
      input.request.requester.ownerUserId !== input.ownerUserId ||
      input.request.expectedDeviceId !== input.deviceId
    ) {
      return failure("denied", "Session history target does not match.");
    }
    try {
      const result = await this.sendCurrentDeviceOperationAndWait({
        code: "daemon.session_history.request",
        expectedResponseCode: "daemon.session_history.request_result",
        isExpectedPayload: (payload) =>
          sessionHistoryResultSchema.safeParse(payload).success,
        payload: { request: input.request, requestId: input.requestId },
        requestId: input.requestId,
        session: session as RuntimeTransportSessionState & {
          socket: WebSocket;
        },
        timeoutMs: CURRENT_DEVICE_CONTROL_RESPONSE_TIMEOUT_MS,
      });
      const valid = sessionHistoryResultSchema.safeParse(result);
      return valid.success
        ? Response.json(valid.data, {
            headers: { "Cache-Control": "no-store" },
          })
        : failure("failed", "Session history did not return a valid result.");
    } catch {
      return failure(
        "unavailable",
        "Session history did not respond. Check the Computer before retrying."
      );
    }
  }
  private async handleOpenMeldToolsControlRequest(
    request: Request
  ): Promise<Response> {
    const parsed = runtimeTransportOpenMeldToolsControlRequestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          message:
            parsed.error.issues[0]?.message ??
            "The OpenMeld Tools request is invalid.",
          reasonCode: "openmeld_tools_control.invalid_request",
          status: "rejected",
        } satisfies RuntimeTransportOpenMeldToolsControlResponse,
        { status: 400 }
      );
    }
    this.reapExpiredLeases(Date.now());
    const capability: keyof OpenMeldToolsControlCapability =
      parsed.data.request.operation === "request_update"
        ? "requestUpdate"
        : "setAutomaticUpdates";
    const session = this.resolveOpenMeldToolsControlSession({
      capability,
      deviceId: parsed.data.deviceId,
      lane: parsed.data.lane,
      ownerUserId: parsed.data.ownerUserId,
    });
    if (!session.ok) {
      return Response.json(
        {
          message: session.message,
          reasonCode: session.reasonCode,
          status: "rejected",
        } satisfies RuntimeTransportOpenMeldToolsControlResponse,
        { status: session.reasonCode.endsWith("service_offline") ? 503 : 409 }
      );
    }
    try {
      const result = await this.sendCurrentDeviceOperationAndWait({
        code: "daemon.openmeld_tools_control.request",
        expectedResponseCode: "daemon.openmeld_tools_control.result",
        isExpectedPayload: (payload) =>
          openMeldToolsControlResultSchema.safeParse(payload).success,
        payload: {
          requestId: parsed.data.requestId,
          request: parsed.data.request,
        },
        requestId: parsed.data.requestId,
        session: session.session,
        timeoutMs: CURRENT_DEVICE_CONTROL_RESPONSE_TIMEOUT_MS,
      });
      const response: RuntimeTransportOpenMeldToolsControlResponse = {
        result: openMeldToolsControlResultSchema.parse(result),
        status: "accepted",
      };
      return Response.json(
        runtimeTransportOpenMeldToolsControlResponseSchema.parse(response)
      );
    } catch (error) {
      const operationError =
        error instanceof CurrentDeviceOperationError ? error : null;
      const reasonCode =
        operationError?.kind === "send_failed"
          ? "openmeld_tools_control.service_offline"
          : `openmeld_tools_control.${operationError?.kind ?? "internal_error"}`;
      return Response.json(
        {
          message:
            error instanceof Error
              ? error.message
              : "OpenMeld Tools could not be changed.",
          reasonCode,
          status: "rejected",
        } satisfies RuntimeTransportOpenMeldToolsControlResponse,
        { status: operationError?.kind === "timeout" ? 504 : 502 }
      );
    }
  }
  private async restoreAutomaticToolsUpdateUnavailableRetries(): Promise<void> {
    const entries = await this.ctx.storage
      .list<unknown>({
        prefix: AUTOMATIC_TOOLS_UPDATE_UNAVAILABLE_RETRY_STORAGE_PREFIX,
      })
      .catch((error: unknown) => {
        console.warn(
          "[core.openmeld_tools.automatic_update_retry_restore_failed]",
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        return new Map<string, unknown>();
      });
    for (const [storageKey, value] of entries) {
      const retry = parseStoredAutomaticToolsUpdateUnavailableRetry(value);
      if (
        !retry ||
        storageKey !==
          buildAutomaticToolsUpdateUnavailableRetryStorageKey(
            retry.computerKey,
            retry
          )
      ) {
        this.ctx.storage.delete(storageKey).catch(() => undefined);
        continue;
      }
      this.automaticToolsUpdateUnavailableRetryByComputer.set(
        retry.computerKey,
        retry
      );
    }
  }
  private async persistAutomaticToolsUpdateUnavailableRetry(input: {
    computerKey: string;
    retry: AutomaticToolsUpdateUnavailableRetry;
  }): Promise<void> {
    await this.ctx.storage.put(
      buildAutomaticToolsUpdateUnavailableRetryStorageKey(
        input.computerKey,
        input.retry
      ),
      {
        ...input.retry,
        computerKey: input.computerKey,
        v: 1,
      } satisfies StoredAutomaticToolsUpdateUnavailableRetry
    );
  }
  private async deleteAutomaticToolsUpdateUnavailableRetry(
    computerKey: string,
    retry: Pick<
      AutomaticToolsUpdateUnavailableRetry,
      "daemonSessionId" | "targetVersion"
    >
  ): Promise<void> {
    await this.ctx.storage.delete(
      buildAutomaticToolsUpdateUnavailableRetryStorageKey(computerKey, retry)
    );
  }
  private queueReleaseTriggeredOpenMeldToolsUpdate(input: {
    connection: Pick<
      RuntimeTransportSessionState,
      "daemonSessionId" | "deviceId" | "lane" | "ownerUserId"
    >;
    release: CoreLocalComponentsRelease;
    session: RuntimeTransportSessionState | null;
    socket: WebSocket;
    trigger: "heartbeat" | "register";
  }): void {
    if (input.session?.socket !== input.socket) {
      this.recordReleaseTriggeredOpenMeldToolsUpdateSkip({
        ...input,
        reasonCode: "automatic_update.session_socket_mismatch",
      });
      return;
    }
    const session = input.session as RuntimeTransportSessionState & {
      socket: WebSocket;
    };
    const decision = resolveReleaseTriggeredOpenMeldToolsUpdateDecision({
      capabilities: session.capabilities,
      generatedAt: new Date().toISOString(),
      lane: session.lane,
      release: input.release,
      serviceVersion: session.serviceVersion ?? null,
    });
    if (decision.status === "skipped") {
      this.recordReleaseTriggeredOpenMeldToolsUpdateSkip({
        ...input,
        reasonCode: decision.reasonCode,
      });
      return;
    }
    const update = decision.update;
    const computerKey = [
      session.ownerUserId,
      session.deviceId,
      session.lane,
    ].join(":");
    const unavailableRetry =
      this.automaticToolsUpdateUnavailableRetryByComputer.get(computerKey);
    const retryMatchesCurrentCondition =
      unavailableRetry?.daemonSessionId === session.daemonSessionId &&
      unavailableRetry.targetVersion === update.targetVersion;
    if (
      retryMatchesCurrentCondition &&
      Date.now() < unavailableRetry.retryAtMs
    ) {
      this.recordReleaseTriggeredOpenMeldToolsUpdateSkip({
        ...input,
        reasonCode: "automatic_update.unavailable_retry_backoff",
        targetVersion: update.targetVersion,
      });
      return;
    }
    if (unavailableRetry && !retryMatchesCurrentCondition) {
      this.automaticToolsUpdateUnavailableRetryByComputer.delete(computerKey);
      this.ctx.waitUntil(
        this.deleteAutomaticToolsUpdateUnavailableRetry(
          computerKey,
          unavailableRetry
        ).catch((error) => {
          console.warn(
            "[core.openmeld_tools.automatic_update_retry_delete_failed]",
            {
              error: error instanceof Error ? error.message : String(error),
              targetVersion: update.targetVersion,
            }
          );
        })
      );
    }
    const existingMarker =
      this.automaticToolsUpdateTargetByComputer.get(computerKey);
    if (
      existingMarker?.daemonSessionId === session.daemonSessionId &&
      existingMarker.targetVersion === update.targetVersion
    ) {
      this.recordReleaseTriggeredOpenMeldToolsUpdateSkip({
        ...input,
        reasonCode: "automatic_update.target_already_coalesced",
        targetVersion: update.targetVersion,
      });
      return;
    }
    const requestId = crypto.randomUUID();
    const coalescingMarker: AutomaticToolsUpdateCoalescingMarker = {
      daemonSessionId: session.daemonSessionId,
      requestId,
      targetVersion: update.targetVersion,
    };
    this.automaticToolsUpdateTargetByComputer.set(
      computerKey,
      coalescingMarker
    );
    console.info("[core.openmeld_tools.automatic_update_queued]", {
      daemonSessionId: session.daemonSessionId,
      deviceId: session.deviceId,
      event: "core.openmeld_tools.automatic_update_queued",
      lane: session.lane,
      ownerUserId: session.ownerUserId,
      requestId,
      targetVersion: update.targetVersion,
      trigger: input.trigger,
    });
    this.ctx.waitUntil(
      this.sendCurrentDeviceOperationAndWait<OpenMeldToolsControlResult>({
        code: "daemon.openmeld_tools_control.request",
        expectedResponseCode: "daemon.openmeld_tools_control.result",
        isExpectedPayload: (payload) => {
          const parsed = openMeldToolsControlResultSchema.safeParse(payload);
          return parsed.success && parsed.data.operation === "request_update";
        },
        payload: {
          requestId,
          request: update.request,
        },
        requestId,
        session,
        timeoutMs: CURRENT_DEVICE_CONTROL_RESPONSE_TIMEOUT_MS,
      })
        .then(async (result) => {
          const operationStatus =
            result.operation === "request_update"
              ? result.result.status
              : "invalid_response";
          const handledTargetVersion =
            resolveHandledOpenMeldToolsUpdateTargetVersion(result);
          const requestHandledTarget =
            handledTargetVersion !== null &&
            isLocalComponentVersionAtLeast(
              handledTargetVersion,
              update.targetVersion
            );
          const requestStillOwnsMarker =
            this.automaticToolsUpdateTargetByComputer.get(computerKey) ===
            coalescingMarker;
          if (!requestHandledTarget && requestStillOwnsMarker) {
            this.automaticToolsUpdateTargetByComputer.delete(computerKey);
            if (operationStatus === "unavailable") {
              const previousRetry =
                this.automaticToolsUpdateUnavailableRetryByComputer.get(
                  computerKey
                );
              const attempts =
                previousRetry?.daemonSessionId === session.daemonSessionId &&
                previousRetry.targetVersion === update.targetVersion
                  ? previousRetry.attempts + 1
                  : 1;
              const retry: AutomaticToolsUpdateUnavailableRetry = {
                attempts,
                daemonSessionId: session.daemonSessionId,
                retryAtMs:
                  Date.now() +
                  resolveAutomaticToolsUpdateUnavailableRetryDelayMs(attempts),
                targetVersion: update.targetVersion,
              };
              this.automaticToolsUpdateUnavailableRetryByComputer.set(
                computerKey,
                retry
              );
              await this.persistAutomaticToolsUpdateUnavailableRetry({
                computerKey,
                retry,
              });
            } else {
              this.automaticToolsUpdateUnavailableRetryByComputer.delete(
                computerKey
              );
              await this.deleteAutomaticToolsUpdateUnavailableRetry(
                computerKey,
                unavailableRetry ?? {
                  daemonSessionId: session.daemonSessionId,
                  targetVersion: update.targetVersion,
                }
              );
            }
          } else if (requestHandledTarget && requestStillOwnsMarker) {
            this.automaticToolsUpdateUnavailableRetryByComputer.delete(
              computerKey
            );
            await this.deleteAutomaticToolsUpdateUnavailableRetry(
              computerKey,
              unavailableRetry ?? {
                daemonSessionId: session.daemonSessionId,
                targetVersion: update.targetVersion,
              }
            );
          }
          console.info("[core.openmeld_tools.automatic_update_requested]", {
            daemonSessionId: session.daemonSessionId,
            deviceId: session.deviceId,
            event: "core.openmeld_tools.automatic_update_requested",
            lane: session.lane,
            operationStatus,
            ownerUserId: session.ownerUserId,
            targetVersion: update.targetVersion,
            trigger: input.trigger,
          });
        })
        .catch((error) => {
          if (
            this.automaticToolsUpdateTargetByComputer.get(computerKey) ===
            coalescingMarker
          ) {
            this.automaticToolsUpdateTargetByComputer.delete(computerKey);
          }
          console.warn("[core.openmeld_tools.automatic_update_failed]", {
            daemonSessionId: session.daemonSessionId,
            deviceId: session.deviceId,
            error: error instanceof Error ? error.message : String(error),
            event: "core.openmeld_tools.automatic_update_failed",
            lane: session.lane,
            ownerUserId: session.ownerUserId,
            targetVersion: update.targetVersion,
            trigger: input.trigger,
          });
        })
    );
  }
  private recordReleaseTriggeredOpenMeldToolsUpdateSkip(input: {
    connection: Pick<
      RuntimeTransportSessionState,
      "daemonSessionId" | "deviceId" | "lane" | "ownerUserId"
    >;
    reasonCode:
      | Extract<
          ReturnType<typeof resolveReleaseTriggeredOpenMeldToolsUpdateDecision>,
          {
            status: "skipped";
          }
        >["reasonCode"]
      | "automatic_update.session_socket_mismatch"
      | "automatic_update.target_already_coalesced"
      | "automatic_update.unavailable_retry_backoff";
    release: CoreLocalComponentsRelease;
    session: RuntimeTransportSessionState | null;
    socket: WebSocket;
    targetVersion?: string;
    trigger: "heartbeat" | "register";
  }): void {
    // Register is the one-shot decision boundary. Heartbeats reuse the same
    // decision and would turn a stable skip reason into recurring log noise.
    if (input.trigger !== "register" || input.connection.lane !== "prod") {
      return;
    }
    console.info("[core.openmeld_tools.automatic_update_skipped]", {
      automaticUpdatesEnabled:
        input.session?.capabilities.localComponents?.maintenance
          ?.automaticUpdatesEnabled ?? null,
      daemonSessionId: input.connection.daemonSessionId,
      deviceId: input.connection.deviceId,
      event: "core.openmeld_tools.automatic_update_skipped",
      lane: input.connection.lane,
      maintenanceStatus:
        input.session?.capabilities.localComponents?.maintenance?.status ??
        null,
      operationPhase:
        input.session?.capabilities.localComponents?.updateOperation?.phase ??
        null,
      operationTargetVersion:
        input.session?.capabilities.localComponents?.updateOperation
          ?.targetVersion ?? null,
      ownerUserId: input.connection.ownerUserId,
      reasonCode: input.reasonCode,
      releaseCliVersion:
        input.release.manifest?.components.cli.packageVersion ?? null,
      releaseServiceVersion:
        input.release.manifest?.components.service.bundleVersion ?? null,
      requestAutomaticUpdateSupported:
        input.session?.capabilities.openMeldToolsControl
          ?.requestAutomaticUpdate === true,
      requestUpdateSupported:
        input.session?.capabilities.openMeldToolsControl?.requestUpdate ===
        true,
      serviceVersion: input.session?.serviceVersion ?? null,
      sessionPresent: input.session !== null,
      sessionSocketMatches: input.session?.socket === input.socket,
      targetVersion: input.targetVersion ?? null,
      trigger: input.trigger,
    });
  }
  private resolveOpenMeldToolsControlSession(input: {
    capability: keyof OpenMeldToolsControlCapability;
    deviceId: string;
    lane: string;
    ownerUserId: string;
  }):
    | {
        ok: true;
        session: RuntimeTransportSessionState & {
          socket: WebSocket;
        };
      }
    | {
        ok: false;
        message: string;
        reasonCode: string;
      } {
    const latestSession = [...this.state.sessionsById.values()]
      .filter(
        (session) =>
          session.ownerUserId === input.ownerUserId &&
          session.deviceId === input.deviceId &&
          session.lane === input.lane
      )
      .sort(compareRuntimeTransportSessionsByFreshness)[0];
    if (!latestSession?.socket) {
      return {
        message: "OpenMeld Service is offline.",
        ok: false,
        reasonCode: "openmeld_tools_control.service_offline",
      };
    }
    if (
      !isDaemonExecutionCompatible(latestSession.executionCompatibility) ||
      latestSession.capabilities.openMeldToolsControl?.[input.capability] !==
        true
    ) {
      return {
        message: "Reconnect Computer to use this action.",
        ok: false,
        reasonCode: "openmeld_tools_control.service_update_required",
      };
    }
    return {
      ok: true,
      session: latestSession as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private handleOpenMeldToolsControlResultFrame(
    webSocket: WebSocket,
    payload: unknown
  ): void {
    const parsed =
      runtimeTransportOpenMeldToolsControlResultFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid OpenMeld Tools control result",
      });
      return;
    }
    this.resolveCurrentDeviceOperationResultFrame({
      code: "daemon.openmeld_tools_control.result",
      invalidMessage: "Received an invalid OpenMeld Tools response.",
      payload: parsed.data,
      webSocket,
    });
  }
  private async handleLocalFolderPickerRequest(
    request: Request,
    operation: LocalFolderPickerOperation
  ): Promise<Response> {
    const parsed = operation.requestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          code: "local.folder_picker.invalid_request",
          message:
            parsed.error.issues[0]?.message ??
            "The Local Folder Picker request is invalid.",
          status: "unavailable",
        },
        { status: 400 }
      );
    }
    const input = parsed.data as {
      deviceId: string;
      lane: string;
      ownerUserId: string;
      request: unknown;
      requestId: string;
    };
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalFolderPickerSession(input);
    if (!session.ok) {
      return Response.json({
        code: session.code,
        message: session.message,
        status: "unavailable",
      });
    }
    try {
      const result = await this.sendCurrentDeviceOperationAndWait({
        code: operation.requestCode,
        expectedResponseCode:
          "daemon.local_folder_picker.select_folders_result",
        isExpectedPayload: (payload) =>
          localFolderPickerResultSchema.safeParse(payload).success,
        payload: {
          request: input.request,
          requestId: input.requestId,
        },
        requestId: input.requestId,
        session: session.session,
        timeoutMs: LOCAL_FOLDER_PICKER_RESPONSE_TIMEOUT_MS,
      });
      return Response.json(result);
    } catch (error) {
      const code = resolveLocalFolderPickerOperationErrorCode(error);
      return Response.json({
        code,
        message:
          error instanceof Error
            ? error.message
            : "Folder selection failed unexpectedly.",
        status: "unavailable",
      });
    }
  }
  private resolveLocalFolderPickerSession(input: {
    deviceId: string;
    lane: string;
    ownerUserId: string;
  }):
    | {
        ok: true;
        session: RuntimeTransportSessionState & {
          socket: WebSocket;
        };
      }
    | {
        code:
          | "local.folder_picker.service_offline"
          | "local.folder_picker.service_update_required";
        message: string;
        ok: false;
      } {
    const matchingSessions = [...this.state.sessionsById.values()]
      .filter(
        (session) =>
          session.ownerUserId === input.ownerUserId &&
          session.deviceId === input.deviceId &&
          session.lane === input.lane
      )
      .sort(compareRuntimeTransportSessionsByFreshness);
    const latestSession = matchingSessions[0] ?? null;
    if (!latestSession?.socket) {
      return {
        code: "local.folder_picker.service_offline",
        message: "The current local OpenMeld Service is not connected.",
        ok: false,
      };
    }
    if (
      !isDaemonExecutionCompatible(latestSession.executionCompatibility) ||
      latestSession.capabilities.localFolderPicker?.selectFolders !== true
    ) {
      return {
        code: "local.folder_picker.service_update_required",
        message: "Update OpenMeld Service to choose folders on this computer.",
        ok: false,
      };
    }
    return {
      ok: true,
      session: latestSession as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private handleLocalFolderPickerResultFrame(
    webSocket: WebSocket,
    frame: unknown
  ): void {
    const parsed = localFolderPickerDaemonFrameSchema.safeParse(frame);
    if (
      !(
        parsed.success &&
        parsed.data.code === "daemon.local_folder_picker.select_folders_result"
      )
    ) {
      this.rejectInvalidCurrentDeviceOperationResultFrame({
        frame,
        message: "Received an invalid Local Folder Picker result payload.",
        webSocket,
      });
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid Local Folder Picker result frame",
      });
      return;
    }
    this.resolveCurrentDeviceOperationResultFrame({
      code: parsed.data.code,
      invalidMessage: "Received an invalid Local Folder Picker result payload.",
      payload: parsed.data.payload,
      webSocket,
    });
  }
  private async handleComputerPowerRequest(
    request: Request
  ): Promise<Response> {
    const parsed = computerPowerTransportSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          status: "rejected",
          code: "computer.power.invalid_request",
          message: "Invalid computer power request.",
        },
        { status: 400 }
      );
    }
    const input = parsed.data;
    this.reapExpiredLeases(Date.now());
    const session = [...this.state.sessionsById.values()]
      .filter(
        (entry) =>
          entry.ownerUserId === input.ownerUserId &&
          entry.deviceId === input.deviceId &&
          entry.lane === input.lane
      )
      .sort(compareRuntimeTransportSessionsByFreshness)[0];
    if (!session?.socket) {
      return Response.json(
        {
          status: "rejected",
          code: "computer.power.offline",
          message:
            "Reconnect OpenMeld Service on this computer to manage sleep prevention.",
        },
        { status: 503 }
      );
    }
    if (
      !isDaemonExecutionCompatible(session.executionCompatibility) ||
      session.capabilities.computerPower !== true
    ) {
      return Response.json(
        {
          status: "rejected",
          code: "computer.power.unsupported",
          message:
            "Update OpenMeld Service on this computer to manage sleep prevention.",
        },
        { status: 409 }
      );
    }
    const result = await this.sendCurrentDeviceOperationAndWait({
      code: "daemon.computer_power.request",
      expectedResponseCode: "daemon.computer_power.request_result",
      isExpectedPayload: (value) =>
        computerPowerResultSchema.safeParse(value).success,
      payload: {
        deviceId: input.deviceId,
        requestId: input.requestId,
        request: input.request,
      },
      requestId: input.requestId,
      session: session as typeof session & { socket: WebSocket },
      timeoutMs: CURRENT_DEVICE_CONTROL_RESPONSE_TIMEOUT_MS,
    });
    return Response.json(result);
  }
  private async handleComputerFileAccessRequest(
    request: Request,
    operation: ComputerFileAccessOperation
  ): Promise<Response> {
    const parsed = operation.requestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          code: "computer.file_access.invalid_request",
          message:
            parsed.error.issues[0]?.message ??
            "The Computer file access request is invalid.",
          status: "rejected",
        },
        { status: 400 }
      );
    }
    const input = parsed.data as {
      deviceId: string;
      lane: string;
      ownerUserId: string;
      request: unknown;
      requestId: string;
    };
    this.reapExpiredLeases(Date.now());
    const session = this.resolveComputerFileAccessSession({
      capability: operation.capability,
      deviceId: input.deviceId,
      lane: input.lane,
      ownerUserId: input.ownerUserId,
    });
    if (!session.ok) {
      return Response.json(
        {
          code: session.code,
          message: session.message,
          status: "rejected",
        },
        {
          status:
            session.code === "computer.file_access.service_offline" ? 503 : 409,
        }
      );
    }
    try {
      const result = await this.sendCurrentDeviceOperationAndWait({
        code: operation.requestCode,
        expectedResponseCode: `${operation.requestCode}_result`,
        isExpectedPayload: (payload) =>
          computerFileAccessPolicyResultSchema.safeParse(payload).success,
        payload: {
          request: input.request,
          requestId: input.requestId,
        },
        requestId: input.requestId,
        session: session.session,
        timeoutMs: CURRENT_DEVICE_CONTROL_RESPONSE_TIMEOUT_MS,
      });
      return Response.json(result, {
        status:
          isRejectedLocalProjectControlResult(result) &&
          result.code === "computer.file_access.timeout"
            ? 504
            : 200,
      });
    } catch (error) {
      const code = resolveComputerFileAccessOperationErrorCode(error);
      const status = resolveCurrentDeviceOperationHttpStatus(code);
      return Response.json(
        {
          code,
          message:
            error instanceof Error
              ? error.message
              : "The current-device operation failed unexpectedly.",
          status: "rejected",
        },
        { status }
      );
    }
  }
  private resolveComputerFileAccessSession(input: {
    capability: ComputerFileAccessCapability;
    deviceId: string;
    lane: string;
    ownerUserId: string;
  }):
    | {
        ok: true;
        session: RuntimeTransportSessionState & {
          socket: WebSocket;
        };
      }
    | {
        ok: false;
        code:
          | "computer.file_access.service_offline"
          | "computer.file_access.service_update_required"
          | "computer.file_access.unsupported";
        message: string;
      } {
    const matchingSessions = [...this.state.sessionsById.values()]
      .filter(
        (session) =>
          session.ownerUserId === input.ownerUserId &&
          session.deviceId === input.deviceId &&
          session.lane === input.lane
      )
      .sort(compareRuntimeTransportSessionsByFreshness);
    const latestSession = matchingSessions[0] ?? null;
    if (!latestSession?.socket) {
      return {
        code: "computer.file_access.service_offline",
        message: "The current local OpenMeld Service is not connected.",
        ok: false,
      };
    }
    if (!isDaemonExecutionCompatible(latestSession.executionCompatibility)) {
      return {
        code: "computer.file_access.service_update_required",
        message:
          "Update the current local OpenMeld Service before managing file access.",
        ok: false,
      };
    }
    if (
      latestSession.capabilities.computerFileAccess?.[input.capability] !== true
    ) {
      return {
        code: "computer.file_access.unsupported",
        message:
          "The current local OpenMeld Service does not support this file access operation.",
        ok: false,
      };
    }
    return {
      ok: true,
      session: latestSession as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private handleComputerFileAccessResultFrame(
    webSocket: WebSocket,
    frame: unknown
  ): void {
    const parsed = computerFileAccessDaemonFrameSchema.safeParse(frame);
    if (
      !(
        parsed.success &&
        parsed.data.code.endsWith("_result") &&
        "result" in parsed.data.payload
      )
    ) {
      this.rejectInvalidCurrentDeviceOperationResultFrame({
        frame,
        message: "Received an invalid Computer file access result payload.",
        webSocket,
      });
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid Computer file access result frame",
      });
      return;
    }
    this.resolveCurrentDeviceOperationResultFrame({
      code: parsed.data.code,
      invalidMessage:
        "Received an invalid Computer file access result payload.",
      payload: parsed.data.payload,
      webSocket,
    });
  }
  private async handleLocalProjectControlRequest(
    request: Request,
    operation: LocalProjectControlOperation
  ): Promise<Response> {
    const parsed = operation.requestSchema.safeParse(
      await readJsonBody(request)
    );
    if (!parsed.success) {
      return Response.json(
        {
          status: "rejected",
          code: "invalid_request",
          message:
            parsed.error.issues[0]?.message ??
            "The local Project control request is invalid.",
        },
        { status: 400 }
      );
    }
    const input = parsed.data as {
      deviceId: string;
      lane: string;
      ownerUserId: string;
      request: unknown;
      requestId: string;
    };
    this.reapExpiredLeases(Date.now());
    const session = this.resolveLocalProjectControlSession({
      capability: operation.capability,
      deviceId: input.deviceId,
      lane: input.lane,
      ownerUserId: input.ownerUserId,
    });
    if (!session.ok) {
      return Response.json(
        {
          status: "rejected",
          code: session.code,
          message: session.message,
        },
        { status: session.code === "service_offline" ? 503 : 409 }
      );
    }
    const responseCode = `${operation.requestCode}_result`;
    try {
      const result = await this.sendCurrentDeviceOperationAndWait({
        code: operation.requestCode,
        expectedResponseCode: responseCode,
        isExpectedPayload: (payload) =>
          operation.resultSchema.safeParse(payload).success,
        payload: {
          requestId: input.requestId,
          request: projectControlRequestForSession(
            operation,
            input.request,
            session.session.capabilities
          ),
        },
        requestId: input.requestId,
        session: session.session,
        timeoutMs: CURRENT_DEVICE_CONTROL_RESPONSE_TIMEOUT_MS,
      });
      return Response.json(result, {
        status:
          isRejectedLocalProjectControlResult(result) &&
          result.code === "timeout"
            ? 504
            : 200,
      });
    } catch (error) {
      const operationError =
        error instanceof CurrentDeviceOperationError ? error : null;
      const code =
        operationError?.kind === "send_failed"
          ? "service_offline"
          : (operationError?.kind ?? "internal_error");
      let status = 502;
      if (code === "service_offline") {
        status = 503;
      } else if (code === "timeout") {
        status = 504;
      }
      return Response.json(
        {
          status: "rejected",
          code,
          message:
            error instanceof Error
              ? error.message
              : "The current-device operation failed unexpectedly.",
        },
        { status }
      );
    }
  }
  private resolveLocalProjectControlSession(input: {
    capability: LocalProjectControlCapability;
    ownerUserId: string;
    deviceId: string;
    lane: string;
  }):
    | {
        ok: true;
        session: RuntimeTransportSessionState & {
          socket: WebSocket;
        };
      }
    | {
        ok: false;
        code: "service_offline" | "service_update_required" | "unsupported";
        message: string;
      } {
    const matchingSessions = [...this.state.sessionsById.values()]
      .filter(
        (session) =>
          session.ownerUserId === input.ownerUserId &&
          session.deviceId === input.deviceId &&
          session.lane === input.lane
      )
      .sort(compareRuntimeTransportSessionsByFreshness);
    const latestSession = matchingSessions[0] ?? null;
    if (!latestSession?.socket) {
      return {
        ok: false,
        code: "service_offline",
        message: "The current local OpenMeld Service is not connected.",
      };
    }
    if (!isDaemonExecutionCompatible(latestSession.executionCompatibility)) {
      return {
        ok: false,
        code: "service_update_required",
        message:
          "Update the current local OpenMeld Service before managing Project connections.",
      };
    }
    if (
      latestSession.capabilities.localProjectControl?.[input.capability] !==
      true
    ) {
      return {
        ok: false,
        code: "unsupported",
        message:
          "The current local OpenMeld Service does not support this Project connection operation.",
      };
    }
    return {
      ok: true,
      session: latestSession as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private async sendCurrentDeviceOperationAndWait<T>(input: {
    code: string;
    expectedResponseCode: string;
    isExpectedPayload: (payload: unknown) => boolean;
    payload: Record<string, unknown>;
    requestId: string;
    session: RuntimeTransportSessionState & {
      socket: WebSocket;
    };
    timeoutMs: number;
  }): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.currentDeviceOperationWaiters.delete(input.requestId);
        reject(
          new CurrentDeviceOperationError(
            "timeout",
            "Timed out waiting for the local OpenMeld Service response."
          )
        );
      }, input.timeoutMs);
      this.currentDeviceOperationWaiters.set(input.requestId, {
        daemonSessionId: input.session.daemonSessionId,
        expectedResponseCode: input.expectedResponseCode,
        isExpectedPayload: input.isExpectedPayload,
        reject,
        resolve: (payload) => resolve(payload as T),
        socket: input.session.socket,
        timeoutId,
      });
      try {
        this.sendFrame(input.session.socket, {
          code: input.code,
          payload: input.payload,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        this.currentDeviceOperationWaiters.delete(input.requestId);
        reject(
          new CurrentDeviceOperationError(
            "send_failed",
            error instanceof Error
              ? error.message
              : "Failed to send current-device operation frame."
          )
        );
      }
    });
  }
  private failCurrentDeviceOperationWaitersForSocket(socket: WebSocket): void {
    for (const [requestId, waiter] of this.currentDeviceOperationWaiters) {
      if (waiter.socket !== socket) {
        continue;
      }
      clearTimeout(waiter.timeoutId);
      this.currentDeviceOperationWaiters.delete(requestId);
      waiter.reject(
        new CurrentDeviceOperationError(
          "send_failed",
          "The local OpenMeld Service disconnected before it responded."
        )
      );
    }
  }
  private handleLocalProjectControlResultFrame(
    webSocket: WebSocket,
    frame: unknown
  ): void {
    const parsed = localProjectControlDaemonFrameSchema.safeParse(frame);
    if (
      !(
        parsed.success &&
        parsed.data.code.endsWith("_result") &&
        "result" in parsed.data.payload
      )
    ) {
      this.rejectInvalidLocalProjectControlResultFrame(webSocket, frame);
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid local Project control result frame",
      });
      return;
    }
    const daemonSessionId = this.state.sessionIdBySocket.get(webSocket);
    const waiter = this.currentDeviceOperationWaiters.get(
      parsed.data.payload.requestId
    );
    if (!(waiter && daemonSessionId === waiter.daemonSessionId)) {
      return;
    }
    clearTimeout(waiter.timeoutId);
    this.currentDeviceOperationWaiters.delete(parsed.data.payload.requestId);
    if (waiter.expectedResponseCode !== parsed.data.code) {
      waiter.reject(
        new CurrentDeviceOperationError(
          "invalid_response",
          `Received ${parsed.data.code} while waiting for ${waiter.expectedResponseCode}.`
        )
      );
      return;
    }
    if (!waiter.isExpectedPayload(parsed.data.payload.result)) {
      waiter.reject(
        new CurrentDeviceOperationError(
          "invalid_response",
          "Received an invalid local Project control result payload."
        )
      );
      return;
    }
    waiter.resolve(parsed.data.payload.result);
  }
  private resolveCurrentDeviceOperationResultFrame(input: {
    code: string;
    invalidMessage: string;
    payload: {
      requestId: string;
      result: unknown;
    };
    webSocket: WebSocket;
  }): void {
    const daemonSessionId = this.state.sessionIdBySocket.get(input.webSocket);
    const waiter = this.currentDeviceOperationWaiters.get(
      input.payload.requestId
    );
    if (!(waiter && daemonSessionId === waiter.daemonSessionId)) {
      return;
    }
    clearTimeout(waiter.timeoutId);
    this.currentDeviceOperationWaiters.delete(input.payload.requestId);
    if (
      waiter.expectedResponseCode !== input.code ||
      !waiter.isExpectedPayload(input.payload.result)
    ) {
      waiter.reject(
        new CurrentDeviceOperationError(
          "invalid_response",
          input.invalidMessage
        )
      );
      return;
    }
    waiter.resolve(input.payload.result);
  }
  private rejectInvalidCurrentDeviceOperationResultFrame(input: {
    frame: unknown;
    message: string;
    webSocket: WebSocket;
  }): void {
    const frame = input.frame;
    if (
      !(
        frame &&
        typeof frame === "object" &&
        "code" in frame &&
        "payload" in frame
      )
    ) {
      return;
    }
    const code = frame.code;
    const payload = frame.payload;
    if (
      !(
        typeof code === "string" &&
        code.endsWith("_result") &&
        payload &&
        typeof payload === "object" &&
        "requestId" in payload &&
        typeof payload.requestId === "string"
      )
    ) {
      return;
    }
    const daemonSessionId = this.state.sessionIdBySocket.get(input.webSocket);
    const waiter = this.currentDeviceOperationWaiters.get(payload.requestId);
    if (!(waiter && daemonSessionId === waiter.daemonSessionId)) {
      return;
    }
    clearTimeout(waiter.timeoutId);
    this.currentDeviceOperationWaiters.delete(payload.requestId);
    waiter.reject(
      new CurrentDeviceOperationError("invalid_response", input.message)
    );
  }
  private handleExecutionRecoveryResultFrame(
    webSocket: WebSocket,
    payload: unknown
  ): void {
    const parsed =
      runtimeTransportResumeControllerConversationResultFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid execution recovery result frame",
      });
      return;
    }
    const daemonSessionId = this.state.sessionIdBySocket.get(webSocket);
    const waiter = this.currentDeviceOperationWaiters.get(
      parsed.data.requestId
    );
    if (!(waiter && daemonSessionId === waiter.daemonSessionId)) {
      return;
    }
    clearTimeout(waiter.timeoutId);
    this.currentDeviceOperationWaiters.delete(parsed.data.requestId);
    if (
      waiter.expectedResponseCode !==
        "daemon.execution_recovery.resume_controller_conversation_result" ||
      !waiter.isExpectedPayload(parsed.data.result)
    ) {
      waiter.reject(
        new CurrentDeviceOperationError(
          "invalid_response",
          "Received an invalid execution recovery result payload."
        )
      );
      return;
    }
    waiter.resolve(parsed.data.result);
  }
  private rejectInvalidLocalProjectControlResultFrame(
    webSocket: WebSocket,
    frame: unknown
  ): void {
    if (
      !(
        frame &&
        typeof frame === "object" &&
        "code" in frame &&
        "payload" in frame
      )
    ) {
      return;
    }
    const code = frame.code;
    const payload = frame.payload;
    if (
      !(
        typeof code === "string" &&
        code.endsWith("_result") &&
        payload &&
        typeof payload === "object" &&
        "requestId" in payload &&
        typeof payload.requestId === "string"
      )
    ) {
      return;
    }
    const daemonSessionId = this.state.sessionIdBySocket.get(webSocket);
    const waiter = this.currentDeviceOperationWaiters.get(payload.requestId);
    if (!(waiter && daemonSessionId === waiter.daemonSessionId)) {
      return;
    }
    clearTimeout(waiter.timeoutId);
    this.currentDeviceOperationWaiters.delete(payload.requestId);
    waiter.reject(
      new CurrentDeviceOperationError(
        "invalid_response",
        "Received an invalid local Project control result payload."
      )
    );
  }
  private resolveLocalAgentControlSession(input: {
    capability:
      | "forkSession"
      | "manageInstallations"
      | "manageInstallationsSafely"
      | "updateInstallations"
      | "setupInstallations"
      | "refreshCatalog"
      | "setEnabled"
      | "initializeProfileWorkspace"
      | "setProfileWorkspace"
      | "readProfileWorkspace"
      | "manageProfileFolders"
      | "repairProfileFolders";
    ownerUserId: string;
    deviceId: string;
    lane: string;
    unsupportedMessage: string;
    updateRequiredMessage: string;
  }):
    | {
        ok: true;
        session: RuntimeTransportSessionState & {
          socket: WebSocket;
        };
      }
    | {
        ok: false;
        reasonCode: string;
        message: string;
      } {
    const matchingSessions = [...this.state.sessionsById.values()]
      .filter(
        (session) =>
          session.ownerUserId === input.ownerUserId &&
          session.deviceId === input.deviceId &&
          session.lane === input.lane
      )
      .sort(compareRuntimeTransportSessionsByFreshness);
    const latestSession = matchingSessions[0] ?? null;
    if (!latestSession?.socket) {
      return {
        ok: false,
        reasonCode: "local_agent_control.service_offline",
        message: "The current local OpenMeld Service is not connected.",
      };
    }
    if (!isDaemonExecutionCompatible(latestSession.executionCompatibility)) {
      return {
        ok: false,
        reasonCode: "local_agent_control.service_update_required",
        message: input.updateRequiredMessage,
      };
    }
    if (
      latestSession.capabilities.localAgentControl?.[input.capability] !== true
    ) {
      return {
        ok: false,
        reasonCode: "local_agent_control.unsupported",
        message: input.unsupportedMessage,
      };
    }
    return {
      ok: true,
      session: latestSession as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  private async sendLocalAgentControlSetEnabledAndWait(input: {
    requestId: string;
    session: RuntimeTransportSessionState & {
      socket: WebSocket;
    };
    payload: RuntimeTransportLocalAgentControlSetEnabledFramePayload;
  }): Promise<OpenMeldDaemonSetLocalAgentEnabledPayload> {
    return await this.sendCurrentDeviceOperationAndWait({
      code: "daemon.local_agent_control.set_enabled",
      expectedResponseCode: "daemon.local_agent_control.result",
      isExpectedPayload: isOpenMeldDaemonSetLocalAgentEnabledPayload,
      payload: input.payload as unknown as Record<string, unknown>,
      requestId: input.requestId,
      session: input.session,
      timeoutMs: resolveLocalAgentControlResponseTimeoutMs("set_enabled"),
    });
  }
  private async sendLocalAgentControlForkSessionAndWait(input: {
    requestId: string;
    session: RuntimeTransportSessionState & {
      socket: WebSocket;
    };
    payload: RuntimeTransportLocalAgentControlForkSessionFramePayload;
  }): Promise<RuntimeTransportForkAgentSessionResult> {
    return await this.sendCurrentDeviceOperationAndWait({
      code: "daemon.local_agent_control.fork_session",
      expectedResponseCode: "daemon.local_agent_control.result",
      isExpectedPayload: (value) =>
        runtimeTransportForkAgentSessionResultSchema.safeParse(value).success,
      payload: input.payload as unknown as Record<string, unknown>,
      requestId: input.requestId,
      session: input.session,
      timeoutMs: resolveLocalAgentControlResponseTimeoutMs("fork_session"),
    });
  }
  private async sendLocalAgentControlManageInstallationAndWait(input: {
    requestId: string;
    session: RuntimeTransportSessionState & {
      socket: WebSocket;
    };
    payload: RuntimeTransportLocalAgentControlManageInstallationFramePayload;
  }): Promise<OpenMeldDaemonManageLocalAgentInstallationPayload> {
    return await this.sendCurrentDeviceOperationAndWait({
      code: "daemon.local_agent_control.manage_installation",
      expectedResponseCode: "daemon.local_agent_control.result",
      isExpectedPayload: (value) =>
        openMeldDaemonManageLocalAgentInstallationPayloadSchema.safeParse(value)
          .success,
      payload: input.payload as unknown as Record<string, unknown>,
      requestId: input.requestId,
      session: input.session,
      timeoutMs: resolveLocalAgentControlResponseTimeoutMs(
        "manage_installation"
      ),
    });
  }
  private async sendLocalAgentControlSetProfileWorkspaceAndWait(input: {
    requestId: string;
    session: RuntimeTransportSessionState & {
      socket: WebSocket;
    };
    payload: RuntimeTransportLocalAgentControlSetProfileWorkspaceFramePayload;
  }): Promise<OpenMeldDaemonSetProfileWorkspacePayload> {
    return await this.sendCurrentDeviceOperationAndWait({
      code: "daemon.local_agent_control.set_profile_workspace",
      expectedResponseCode: "daemon.local_agent_control.result",
      isExpectedPayload: isOpenMeldDaemonSetProfileWorkspacePayload,
      payload: input.payload as unknown as Record<string, unknown>,
      requestId: input.requestId,
      session: input.session,
      timeoutMs: resolveLocalAgentControlResponseTimeoutMs(
        "set_profile_workspace"
      ),
    });
  }
  private async sendLocalAgentControlRefreshCatalogAndWait(input: {
    requestId: string;
    session: RuntimeTransportSessionState & {
      socket: WebSocket;
    };
    payload: RuntimeTransportLocalAgentControlRefreshCatalogFramePayload;
  }): Promise<OpenMeldDaemonSyncRouteCatalogPayload> {
    return await this.sendCurrentDeviceOperationAndWait({
      code: "daemon.local_agent_control.refresh_catalog",
      expectedResponseCode: "daemon.local_agent_control.result",
      isExpectedPayload: isOpenMeldDaemonSyncRouteCatalogPayload,
      payload: input.payload as unknown as Record<string, unknown>,
      requestId: input.requestId,
      session: input.session,
      timeoutMs: resolveLocalAgentControlResponseTimeoutMs("refresh_catalog"),
    });
  }
  private handleLocalAgentControlResultFrame(
    webSocket: WebSocket,
    payload: unknown
  ): void {
    const parsed =
      runtimeTransportLocalAgentControlResultFramePayloadSchema.safeParse(
        payload
      );
    if (!parsed.success) {
      this.sendErrorFrame(webSocket, {
        code: "schema.invalid",
        message: "invalid local agent control result payload",
      });
      return;
    }
    const daemonSessionId = this.state.sessionIdBySocket.get(webSocket);
    if (
      isRuntimeCoordinatorWakeStopControlRequestId(parsed.data.requestId) &&
      isRuntimeCoordinatorWakeStopControlPayload(parsed.data.payload)
    ) {
      if (!daemonSessionId) {
        return;
      }
      this.ctx.waitUntil(
        this.settleRuntimeCoordinatorWakeStopLocalControlResult({
          daemonSessionId,
          payload: parsed.data.payload,
          requestId: parsed.data.requestId,
        }).catch((error) => {
          console.warn(
            "[core.runtime_transport.runtime_coordinator_wake_stop_control_result_failed]",
            {
              error: error instanceof Error ? error.message : String(error),
              requestId: parsed.data.requestId,
            }
          );
        })
      );
      return;
    }
    const waiter = this.currentDeviceOperationWaiters.get(
      parsed.data.requestId
    );
    if (
      !(
        waiter &&
        daemonSessionId === waiter.daemonSessionId &&
        waiter.expectedResponseCode === "daemon.local_agent_control.result"
      )
    ) {
      return;
    }
    clearTimeout(waiter.timeoutId);
    this.currentDeviceOperationWaiters.delete(parsed.data.requestId);
    if (!waiter.isExpectedPayload(parsed.data.payload)) {
      waiter.reject(
        new Error("Received an unexpected local agent control result payload.")
      );
      return;
    }
    waiter.resolve(parsed.data.payload);
  }
  private readonly sendFrame = (
    webSocket: WebSocket,
    input: {
      code: string;
      payload: Record<string, unknown>;
    }
  ): void => {
    webSocket.send(
      JSON.stringify(
        toLegacySpaceAddressingWireValue({
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          code: input.code,
          payload: input.payload,
        })
      )
    );
  };
  private sendErrorFrame(
    webSocket: WebSocket,
    input: {
      code: string;
      message: string;
    }
  ): void {
    this.sendFrame(webSocket, {
      code: "daemon.error",
      payload: {
        code: input.code,
        message: input.message,
      },
    });
  }
}
const hasRuntimeCoordinatorLocalProgress = (
  pending: PendingDispatchState
): boolean =>
  pending.acceptedLocalAtMs !== null ||
  pending.runningAtMs !== null ||
  pending.completedLocalAtMs !== null ||
  pending.phase === "accepted_local" ||
  pending.phase === "running" ||
  pending.phase === "completed_local" ||
  pending.phase === "result_received";
const buildRuntimeCoordinatorTokenValidationContextFromPending = (
  pending: PendingDispatchState
): RuntimeCoordinatorTokenValidationContext => ({
  authorityScope: {
    bindingId: pending.executionIdentity.core.bindingId,
    agentControllerRef: pending.executionIdentity.core.agentControllerRef,
    openMeldServiceRuntimeId:
      pending.executionIdentity.core.openMeldServiceRuntimeId.value,
  },
  executionScope: {
    dispatchId: pending.dispatchId,
    runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
    sourceClientMessageId: pending.sourceClientMessageId,
    spaceId: pending.spaceId,
    targetProfileId: pending.profileId,
  },
  runtimeCoordinatorExecutionId: pending.runtimeCoordinatorExecutionId,
});
const buildRuntimeCoordinatorTokenValidationContextFromCompleted = (
  completed: CompletedDispatchResultState
): RuntimeCoordinatorTokenValidationContext => ({
  authorityScope: {
    bindingId: completed.executionIdentity.core.bindingId,
    agentControllerRef: completed.executionIdentity.core.agentControllerRef,
    openMeldServiceRuntimeId:
      completed.executionIdentity.core.openMeldServiceRuntimeId.value,
  },
  executionScope: {
    dispatchId: completed.dispatchId,
    runtimeCoordinatorExecutionId: completed.runtimeCoordinatorExecutionId,
    sourceClientMessageId: completed.sourceClientMessageId,
    spaceId: completed.executionIdentity.core.spaceId,
    targetProfileId: completed.targetProfileId,
  },
  runtimeCoordinatorExecutionId: completed.runtimeCoordinatorExecutionId,
});
const buildRuntimeCoordinatorExecutionRecordFromPending = (input: {
  nowMs: number;
  pending: PendingDispatchState;
  status: RuntimeCoordinatorExecutionStatus;
}): RuntimeCoordinatorExecutionRecord => {
  return {
    bindingId: input.pending.executionIdentity.core.bindingId,
    agentControllerRef: input.pending.executionIdentity.core.agentControllerRef,
    createdAtMs: input.pending.createdAtMs,
    dispatchId: input.pending.dispatchId,
    legacyPointers: {
      attemptId: input.pending.attemptId,
      claimLeaseId: null,
      connectionGeneration: input.pending.connectionGeneration,
      daemonSessionId: input.pending.daemonSessionId,
      leaseEpoch: input.pending.leaseEpoch,
    },
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
    runtimeCoordinatorExecutionId: input.pending.runtimeCoordinatorExecutionId,
    openMeldServiceRuntimeId:
      input.pending.executionIdentity.core.openMeldServiceRuntimeId,
    sourceClientMessageId: input.pending.sourceClientMessageId,
    spaceId: input.pending.spaceId,
    status: input.status,
    targetProfileId: input.pending.profileId,
    terminalOutcome: null,
    updatedAtMs: input.nowMs,
  };
};
const buildRuntimeCoordinatorExecutionRecordFromCompleted = (input: {
  completed: CompletedDispatchResultState;
  nowMs: number;
  status: RuntimeCoordinatorExecutionStatus;
}): RuntimeCoordinatorExecutionRecord => {
  return {
    bindingId: input.completed.executionIdentity.core.bindingId,
    agentControllerRef:
      input.completed.executionIdentity.core.agentControllerRef,
    createdAtMs: input.completed.receivedAtMs,
    dispatchId: input.completed.dispatchId,
    legacyPointers: {
      attemptId: input.completed.attemptId,
      claimLeaseId: null,
      connectionGeneration: input.completed.connectionGeneration,
      daemonSessionId: input.completed.daemonSessionId,
      leaseEpoch: input.completed.leaseEpoch,
    },
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
    runtimeCoordinatorExecutionId:
      input.completed.runtimeCoordinatorExecutionId,
    openMeldServiceRuntimeId:
      input.completed.executionIdentity.core.openMeldServiceRuntimeId,
    sourceClientMessageId: input.completed.sourceClientMessageId,
    spaceId: input.completed.executionIdentity.core.spaceId,
    status: input.status,
    targetProfileId: input.completed.targetProfileId,
    terminalOutcome: null,
    updatedAtMs: input.nowMs,
  };
};
const buildRuntimeCoordinatorExecutionRecordFromDelivery = (input: {
  nowMs: number;
  request: Parameters<typeof deliverDispatch>[1];
  status: RuntimeCoordinatorExecutionStatus;
}): RuntimeCoordinatorExecutionRecord => {
  return {
    bindingId: input.request.payload.executionIdentity.core.bindingId,
    agentControllerRef:
      input.request.payload.executionIdentity.core.agentControllerRef,
    createdAtMs: input.nowMs,
    dispatchId: input.request.dispatchId,
    legacyPointers: {
      attemptId: input.request.attemptId,
      claimLeaseId: null,
      connectionGeneration: input.request.connectionGeneration,
      daemonSessionId: input.request.daemonSessionId,
      leaseEpoch: input.request.leaseEpoch,
    },
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
    runtimeCoordinatorExecutionId:
      input.request.payload.runtimeCoordinatorExecutionId,
    openMeldServiceRuntimeId:
      input.request.payload.executionIdentity.core.openMeldServiceRuntimeId,
    sourceClientMessageId: input.request.payload.sourceClientMessageId ?? null,
    spaceId: input.request.payload.spaceId,
    status: input.status,
    targetProfileId: input.request.payload.targetProfileId,
    terminalOutcome: null,
    updatedAtMs: input.nowMs,
  };
};
type RuntimeCoordinatorRedeliveryRoute = {
  commandState: RuntimeCoordinatorRunCommandState;
  lease: RuntimeTransportProfileLeaseState;
  session: RuntimeTransportSessionState & {
    socket: WebSocket;
  };
};
const resolveRuntimeCoordinatorRedeliveryRoute = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  lease: RuntimeTransportProfileLeaseState | null | undefined;
  session: RuntimeTransportSessionState | null | undefined;
}): RuntimeCoordinatorRedeliveryRoute | null => {
  if (!(input.lease && input.session?.socket)) {
    return null;
  }
  if (
    input.session.profileIds.has(input.commandState.profileId) &&
    input.session.ownerUserId === input.commandState.ownerUserId &&
    isDaemonExecutionCompatible(input.lease.executionCompatibility) &&
    isDaemonExecutionCompatible(input.session.executionCompatibility)
  ) {
    return {
      commandState: input.commandState,
      lease: input.lease,
      session: input.session as RuntimeTransportSessionState & {
        socket: WebSocket;
      },
    };
  }
  return null;
};
const collectReadinessProfileIdsForSession = (
  session: RuntimeTransportSessionState | null | undefined
): string[] => {
  if (!session) {
    return [];
  }
  return normalizeRuntimeTransportProfileIds([
    ...session.profileIds,
    ...collectLocalWakeRouteReportProfileIds(session.localWakeRouteReport),
    ...session.rejectedProfileRegistrationsByProfileId.keys(),
  ]);
};
const collectLocalWakeRouteReportProfileIds = (
  report: LocalWakeRouteReport | null | undefined
): string[] => {
  if (!report) {
    return [];
  }
  return normalizeRuntimeTransportProfileIds([
    ...report.includedProfileIds,
    ...report.skippedProfiles.map((profile) => profile.profileId),
    ...(report && "workingFolderObservations" in report
      ? report.workingFolderObservations.map(
          (observation) => observation.profileId
        )
      : []),
  ]);
};
const normalizeRuntimeTransportProfileIds = (
  values: Iterable<string>
): string[] => {
  const normalized = new Set<string>();
  for (const value of values) {
    const profileId = normalizeOptionalText(value);
    if (profileId) {
      normalized.add(profileId);
    }
  }
  return [...normalized];
};
const normalizeAgentReadinessInvalidationError = (
  error: unknown
): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error) {
    return String(error);
  }
  return undefined;
};
// Core time of the execution's latest interaction change: a request reaching
// Core, its answer, or its expiry. Wake progress folds it into the item
// revision; otherwise an older copy at the same lifecycle revision can hide a
// new request, or keep showing an answered one, until the next lifecycle write.
const resolveRuntimeCoordinatorInteractionUpdatedAtMs = (input: {
  commandState: RuntimeCoordinatorRunCommandState | null;
  nowMs: number;
}): number | null => {
  const commandState = input.commandState;
  const pending = commandState?.pendingInteraction ?? null;
  if (commandState && pending) {
    if (pending.respondedAtMs !== null) {
      return pending.respondedAtMs;
    }
    // A request stored before its arrival was recorded falls back to the
    // command state's Core write time, never the Service's clock. Later writes
    // only move it forward, which still orders the request correctly.
    const receivedAtMs =
      pending.requestReceivedAtMs ?? commandState.updatedAtMs;
    return pending.request.expiresAtMs <= input.nowMs
      ? Math.max(receivedAtMs, pending.request.expiresAtMs)
      : receivedAtMs;
  }
  const receipts = Object.values(
    input.commandState?.interactionResponseReceipts ?? {}
  );
  return receipts.length > 0
    ? Math.max(...receipts.map((receipt) => receipt.respondedAtMs))
    : null;
};
const readDispatchIdForFrameOrdering = (payload: unknown): string | null => {
  if (!(payload && typeof payload === "object" && "dispatchId" in payload)) {
    return null;
  }
  return normalizeOptionalText(payload.dispatchId);
};
const isRuntimeCoordinatorWakeStopScopeMatch = (input: {
  input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
  commandState: RuntimeCoordinatorRunCommandState;
  projection: RuntimeCoordinatorExecutionRecord;
}): boolean => {
  return (
    isRuntimeCoordinatorWakeStopCommandScopeMatch(input) &&
    input.projection.runtimeCoordinatorExecutionId ===
      input.input.runtimeCoordinatorExecutionId &&
    input.projection.dispatchId === input.input.dispatchId &&
    input.projection.spaceId === input.input.spaceId &&
    input.projection.targetProfileId === input.input.targetProfileId &&
    input.projection.sourceClientMessageId ===
      input.input.sourceClientMessageId &&
    input.projection.sourceClientMessageId ===
      input.commandState.sourceClientMessageId
  );
};
const resolveRuntimeCoordinatorWakeStopProjectionResponse = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
  projection: RuntimeCoordinatorExecutionRecord | null;
}): RuntimeTransportRuntimeCoordinatorWakeStopResponse | null => {
  if (
    !(
      input.projection &&
      isRuntimeCoordinatorWakeStopScopeMatch({
        commandState: input.commandState,
        input: input.input,
        projection: input.projection,
      })
    )
  ) {
    return buildWakeStopFailureResponse({
      reasonCode: "runtime_coordinator.wake_stop_scope_missing",
      runtimeCoordinatorExecutionId: input.input.runtimeCoordinatorExecutionId,
      status: "retry_later",
      targetProfileId: input.input.targetProfileId,
    });
  }
  if (input.projection.status === "cancelled") {
    return buildWakeStopSuccessResponse({
      runtimeCoordinatorExecutionId: input.input.runtimeCoordinatorExecutionId,
      status: "already_cancelled",
      targetProfileId: input.input.targetProfileId,
    });
  }
  return input.projection.status === "reply_published" ||
    input.projection.status === "failed_terminal" ||
    input.projection.terminalOutcome !== null
    ? buildWakeStopFailureResponse({
        reasonCode: "runtime_coordinator.wake_stop_execution_terminal",
        runtimeCoordinatorExecutionId:
          input.input.runtimeCoordinatorExecutionId,
        status: "not_stoppable",
        targetProfileId: input.input.targetProfileId,
      })
    : null;
};
const resolveEffectiveRuntimeCoordinatorWakeStopPayload = (input: {
  commandState: RuntimeCoordinatorRunCommandState | null;
  payload: RuntimeCoordinatorWakeStopControlPayload;
  projection: RuntimeCoordinatorExecutionRecord | null;
}): RuntimeCoordinatorWakeStopControlPayload => {
  const taskAlreadyAbsentAfterRequestedCancellation =
    input.payload.accepted === false &&
    input.payload.reasonCode === "task.not_found" &&
    input.projection?.status === "cancellation_requested" &&
    input.commandState !== null &&
    input.payload.target.by === "task" &&
    input.payload.target.taskId ===
      input.commandState.sanitizedDeliveryRequest.payload.taskId;
  if (!(taskAlreadyAbsentAfterRequestedCancellation && input.commandState)) {
    return input.payload;
  }
  return {
    ...input.payload,
    accepted: true,
    resolvedDispatchId: input.commandState.dispatchId,
    resolvedRuntimeCoordinatorExecutionId:
      input.commandState.runtimeCoordinatorExecutionId,
    resolvedTaskId: input.commandState.sanitizedDeliveryRequest.payload.taskId,
  };
};
const isRuntimeCoordinatorWakeStopCommandScopeMatch = (input: {
  input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
  commandState: RuntimeCoordinatorRunCommandState;
}): boolean =>
  input.commandState.ownerUserId === input.input.ownerUserId &&
  input.commandState.runtimeCoordinatorExecutionId ===
    input.input.runtimeCoordinatorExecutionId &&
  input.commandState.dispatchId === input.input.dispatchId &&
  input.commandState.targetProfileId === input.input.targetProfileId &&
  input.commandState.sanitizedDeliveryRequest.payload.spaceId ===
    input.input.spaceId &&
  input.commandState.sourceClientMessageId ===
    input.input.sourceClientMessageId;
const isRuntimeCoordinatorWakeStopTokenAuthorityScopeMatch = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
}): boolean =>
  input.authority.runtimeCoordinatorExecutionId ===
    input.input.runtimeCoordinatorExecutionId &&
  input.authority.executionScope.runtimeCoordinatorExecutionId ===
    input.input.runtimeCoordinatorExecutionId &&
  input.authority.executionScope.dispatchId === input.input.dispatchId &&
  input.authority.executionScope.targetProfileId ===
    input.input.targetProfileId;
const buildRuntimeCoordinatorWakeStopControlRequestId = (
  runtimeCoordinatorExecutionId: string
): string => `wake-stop:${runtimeCoordinatorExecutionId}`;
const buildRuntimeCoordinatorWakeStopPreparationFailureResponse = (input: {
  input: RuntimeTransportRuntimeCoordinatorWakeStopRequest;
  status: "scope_missing" | "terminal";
}): RuntimeTransportRuntimeCoordinatorWakeStopResponse =>
  buildWakeStopFailureResponse({
    reasonCode:
      input.status === "terminal"
        ? "runtime_coordinator.wake_stop_execution_terminal"
        : "runtime_coordinator.wake_stop_scope_missing",
    runtimeCoordinatorExecutionId: input.input.runtimeCoordinatorExecutionId,
    status: input.status === "terminal" ? "not_stoppable" : "retry_later",
    targetProfileId: input.input.targetProfileId,
  });
const parseRuntimeCoordinatorWakeStopControlRequestId = (
  requestId: string
): string | null => {
  const prefix = "wake-stop:";
  if (!requestId.startsWith(prefix)) {
    return null;
  }
  const runtimeCoordinatorExecutionId = requestId.slice(prefix.length).trim();
  return runtimeCoordinatorExecutionId.length > 0
    ? runtimeCoordinatorExecutionId
    : null;
};
const buildRuntimeCoordinatorWakeStopControlFramePayload = (input: {
  commandState: RuntimeCoordinatorRunCommandState;
  controlMode: RuntimeCoordinatorWakeStopControlMode;
  reason: string | null;
  requestId: string;
}):
  | RuntimeTransportLocalAgentControlCancelFramePayload
  | RuntimeTransportLocalAgentControlInterruptFramePayload => {
  const commonPayload = {
    runtimeCoordinatorExecutionId:
      input.commandState.runtimeCoordinatorExecutionId,
    target: {
      by: "task" as const,
      taskId: input.commandState.sanitizedDeliveryRequest.payload.taskId,
    },
    ...(input.reason ? { reason: input.reason } : {}),
  };
  if (input.controlMode === "interrupt") {
    return {
      requestId: input.requestId,
      payload: {
        ...commonPayload,
        mode: "force",
      },
    };
  }
  return {
    requestId: input.requestId,
    payload: commonPayload,
  };
};
const resolveRuntimeCoordinatorWakeStopAcceptedControlRejectionReason =
  (input: {
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord | null;
    commandState: RuntimeCoordinatorRunCommandState | null;
    daemonSessionId: string;
    payload: RuntimeCoordinatorWakeStopControlPayload;
    projection: RuntimeCoordinatorExecutionRecord | null;
    runtimeCoordinatorExecutionId: string;
  }): string | null => {
    if (!input.commandState) {
      return "runtime_coordinator.wake_stop_command_state_missing";
    }
    if (!input.projection) {
      return "runtime_coordinator.wake_stop_projection_missing";
    }
    if (!input.authority) {
      return "runtime_coordinator.wake_stop_token_authority_missing";
    }
    if (
      input.projection.status === "reply_published" ||
      input.projection.status === "failed_terminal" ||
      (input.projection.terminalOutcome !== null &&
        input.projection.terminalOutcome.kind !== "cancelled")
    ) {
      return "runtime_coordinator.wake_stop_execution_terminal";
    }
    if (input.projection.status !== "cancellation_requested") {
      return "runtime_coordinator.wake_stop_state_mismatch";
    }
    if (
      input.commandState.lastDeliveryProvenance.daemonSessionId !==
      input.daemonSessionId
    ) {
      return "runtime_coordinator.wake_stop_daemon_session_mismatch";
    }
    if (
      input.payload.resolvedRuntimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId
    ) {
      return "runtime_coordinator.wake_stop_runtime_coordinator_execution_id_mismatch";
    }
    if (input.payload.resolvedDispatchId !== input.commandState.dispatchId) {
      return "runtime_coordinator.wake_stop_dispatch_id_mismatch";
    }
    if (
      input.payload.resolvedTaskId !==
      input.commandState.sanitizedDeliveryRequest.payload.taskId
    ) {
      return "runtime_coordinator.wake_stop_task_id_mismatch";
    }
    return resolveRuntimeCoordinatorWakeStopAuthorityMismatchReason({
      authority: input.authority,
      commandState: input.commandState,
      projection: input.projection,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    });
  };
const resolveRuntimeCoordinatorWakeStopAuthorityMismatchReason = (input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  commandState: RuntimeCoordinatorRunCommandState;
  projection: RuntimeCoordinatorExecutionRecord;
  runtimeCoordinatorExecutionId: string;
}): string | null => {
  if (
    input.authority.runtimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId ||
    input.authority.executionScope.runtimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId ||
    input.commandState.runtimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId ||
    input.projection.runtimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId
  ) {
    return "runtime_coordinator.wake_stop_authority_execution_id_mismatch";
  }
  if (
    input.authority.executionScope.dispatchId !==
      input.commandState.dispatchId ||
    input.authority.executionScope.dispatchId !== input.projection.dispatchId ||
    input.authority.executionScope.spaceId !== input.projection.spaceId ||
    input.authority.executionScope.targetProfileId !==
      input.projection.targetProfileId ||
    input.authority.executionScope.sourceClientMessageId !==
      input.projection.sourceClientMessageId
  ) {
    return "runtime_coordinator.wake_stop_authority_scope_mismatch";
  }
  if (
    input.authority.authorityScope.bindingId !== input.projection.bindingId ||
    input.authority.authorityScope.agentControllerRef !==
      input.projection.agentControllerRef ||
    input.authority.authorityScope.openMeldServiceRuntimeId !==
      input.projection.openMeldServiceRuntimeId.value
  ) {
    return "runtime_coordinator.wake_stop_authority_identity_mismatch";
  }
  if (
    input.authority.terminalOutcome &&
    input.authority.terminalOutcome.status !== "cancelled"
  ) {
    return "runtime_coordinator.wake_stop_authority_terminal";
  }
  return null;
};
function hasNonCancelledFinalOutcome(
  projection: RuntimeCoordinatorExecutionRecord
): boolean {
  return (
    projection.status === "reply_published" ||
    projection.status === "failed_terminal" ||
    (projection.terminalOutcome !== null &&
      projection.terminalOutcome.kind !== "cancelled" &&
      projection.status !== "failed_retryable")
  );
}
const buildWakeStopSuccessResponse = (input: {
  cancellationStateStatus?: "delivery_pending" | "requested";
  reasonCode?: string;
  runtimeCoordinatorExecutionId: string;
  status: "already_cancelled" | "cancelled" | "cancellation_requested";
  targetProfileId: string;
}): RuntimeTransportRuntimeCoordinatorWakeStopResponse => {
  if (input.status === "already_cancelled" || input.status === "cancelled") {
    return parseWakeStopTransportResponse({
      ok: true,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      status: input.status,
      targetProfileId: input.targetProfileId,
      cancellationState: {
        observedAtMs: Date.now(),
        reasonCode:
          input.status === "already_cancelled"
            ? "runtime_coordinator.wake_already_cancelled"
            : RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
        status: "cancelled",
      },
    });
  }
  return parseWakeStopTransportResponse({
    ok: true,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    status: "cancellation_requested",
    targetProfileId: input.targetProfileId,
    cancellationState: {
      observedAtMs: Date.now(),
      reasonCode:
        input.reasonCode ?? RUNTIME_COORDINATOR_WAKE_STOP_REQUESTED_REASON_CODE,
      status: input.cancellationStateStatus ?? "requested",
    },
  });
};
const buildWakeStopFailureResponse = (input: {
  reasonCode: string;
  runtimeCoordinatorExecutionId: string | null;
  status: "not_found" | "not_stoppable" | "retry_later" | "unsupported";
  targetProfileId: string;
}): RuntimeTransportRuntimeCoordinatorWakeStopResponse =>
  parseWakeStopTransportResponse({
    ok: false,
    reasonCode: input.reasonCode,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    status: input.status,
    targetProfileId: input.targetProfileId,
    cancellationState: {
      observedAtMs: Date.now(),
      reasonCode: input.reasonCode,
      status: resolveWakeStopFailureCancellationStatus(input.status),
    },
  });
const parseWakeStopTransportResponse = (
  response: unknown
): RuntimeTransportRuntimeCoordinatorWakeStopResponse => {
  const parsed =
    runtimeTransportRuntimeCoordinatorWakeStopResponseSchema.safeParse(
      response
    );
  if (!parsed.success) {
    throw new Error("runtime_coordinator.wake_stop_response_invalid");
  }
  return parsed.data;
};
const classifyRuntimeTransportSocketDisconnect = (input: {
  closeCode: number;
  closeReason: string;
}): RuntimeTransportSocketDisconnectClass => {
  if (input.closeCode === 1000 || input.closeCode === 1001) {
    return "normal_shutdown";
  }
  if (input.closeCode === 1006) {
    return "possible_deploy_or_edge_restart";
  }
  return "abnormal_socket_close";
};
const resolveRuntimeTransportSocketCloseReasonCode = (input: {
  closeCode: number;
  event:
    | "core.runtime_transport.socket_closed"
    | "core.runtime_transport.socket_error";
}): RuntimeTransportSocketCloseReasonCode => {
  if (input.event === "core.runtime_transport.socket_error") {
    return "socket_error";
  }
  if (input.closeCode === 1000) {
    return "normal_closure";
  }
  if (input.closeCode === 1001) {
    return "going_away";
  }
  if (input.closeCode === 1006) {
    return "abnormal_closure";
  }
  return "other";
};
const compareSocketDisconnectRateBuckets = (
  left: RuntimeTransportSocketDisconnectRateBucket,
  right: RuntimeTransportSocketDisconnectRateBucket
): number => {
  if (left.hourStartMs !== right.hourStartMs) {
    return left.hourStartMs - right.hourStartMs;
  }
  const classComparison = left.disconnectClass.localeCompare(
    right.disconnectClass
  );
  if (classComparison !== 0) {
    return classComparison;
  }
  return (left.deployAdjacentReason ?? "").localeCompare(
    right.deployAdjacentReason ?? ""
  );
};
const buildSocketDisconnectRateBucketKey = (input: {
  deployAdjacentReason: string | null;
  disconnectClass: RuntimeTransportSocketDisconnectClass;
  hourStartMs: number;
}): string => {
  return [
    SOCKET_DISCONNECT_RATE_STORAGE_PREFIX,
    String(input.hourStartMs),
    input.disconnectClass,
    input.deployAdjacentReason ?? "none",
  ].join(":");
};
const buildSocketDisconnectSessionStorageSlotKey = (slot: number): string => {
  return `${SOCKET_DISCONNECT_SESSION_STORAGE_SLOT_PREFIX}${String(slot).padStart(2, "0")}`;
};
const readSocketDisconnectSessionStorageSequence = (value: unknown): number => {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const nextSequence = (
    value as {
      nextSequence?: unknown;
    }
  ).nextSequence;
  if (
    typeof nextSequence !== "number" ||
    !Number.isSafeInteger(nextSequence) ||
    nextSequence < 0
  ) {
    return 0;
  }
  return nextSequence;
};
const resolveWakeStopFailureCancellationStatus = (
  status: "not_found" | "not_stoppable" | "retry_later" | "unsupported"
): "delivery_rejected" | "not_requested" | "unsupported" => {
  if (status === "unsupported") {
    return "unsupported";
  }
  if (status === "retry_later") {
    return "delivery_rejected";
  }
  return "not_requested";
};
const isOpenMeldDaemonSetLocalAgentEnabledPayload = (
  payload: unknown
): payload is OpenMeldDaemonSetLocalAgentEnabledPayload =>
  typeof payload === "object" &&
  payload !== null &&
  "agentId" in payload &&
  "enabled" in payload;
const isOpenMeldDaemonSetProfileWorkspacePayload = (
  payload: unknown
): payload is OpenMeldDaemonSetProfileWorkspacePayload =>
  typeof payload === "object" &&
  payload !== null &&
  "targetProfileId" in payload &&
  "status" in payload;
const isOpenMeldDaemonSyncRouteCatalogPayload = (
  payload: unknown
): payload is OpenMeldDaemonSyncRouteCatalogPayload =>
  typeof payload === "object" &&
  payload !== null &&
  "profileIds" in payload &&
  "syncStatus" in payload;
const isRuntimeCoordinatorWakeStopControlPayload = (
  payload: unknown
): payload is RuntimeCoordinatorWakeStopControlPayload =>
  typeof payload === "object" &&
  payload !== null &&
  "accepted" in payload &&
  "target" in payload;
const isRuntimeCoordinatorWakeStopControlRequestId = (
  requestId: string
): boolean =>
  parseRuntimeCoordinatorWakeStopControlRequestId(requestId) !== null;
const resolveSubmitResultAttemptId = (
  request: RuntimeTransportSubmitTaskResultRequest
): string | null => {
  const requestAttemptId =
    typeof request.attemptId === "string" ? request.attemptId.trim() : "";
  const payload = request.taskResult.payload as {
    attemptId?: unknown;
  };
  const payloadAttemptId =
    typeof payload.attemptId === "string" ? payload.attemptId.trim() : "";
  return requestAttemptId || payloadAttemptId || null;
};
const mapResultRejectionToCoordinatorEventType = (
  response: Awaited<ReturnType<typeof handleSubmitTaskResult>>
): RuntimeCoordinatorExecutionEventType => {
  if (!("reasonCode" in response)) {
    return "result_late_diagnostic";
  }
  switch (response.reasonCode) {
    case "daemon.session.stale_lease":
      return "result_stale_lease";
    case "daemon.result.identity_mismatch":
      return "result_stale_attempt";
    case "daemon.result.conflict":
      return "result_duplicate";
    case "daemon.session.not_found":
      return "coordinator_pending_state_missing";
    default:
      return "result_late_diagnostic";
  }
};
const mapTokenValidationReasonToCoordinatorEventType = (
  reasonCode: RuntimeCoordinatorTokenReasonCode
): RuntimeCoordinatorExecutionEventType => {
  switch (reasonCode) {
    case "execution_token_superseded":
      return "execution_token_superseded";
    case "execution_token_expired":
      return "execution_token_expired";
    case "execution_token_revoked":
      return "execution_token_revoked";
    case "execution_token_terminal_late":
      return "execution_token_terminal_late";
    default:
      return "execution_token_validation_failed";
  }
};
const mapOwnerConflictTokenClassToCoordinatorEventType = (
  tokenClass: "current" | "missing" | "stale"
): RuntimeCoordinatorExecutionEventType => {
  switch (tokenClass) {
    case "current":
      return "owner_conflict_current_token";
    case "stale":
      return "owner_conflict_stale_token";
    case "missing":
      return "owner_conflict_missing_token";
    default:
      throw new Error("runtime_coordinator.owner_conflict_token_class_invalid");
  }
};
const isRuntimeCoordinatorOwnerConflictResult = (
  request: RuntimeTransportSubmitTaskResultRequest
): boolean => {
  const payload = request.taskResult.payload;
  return (
    payload.status === "failed" &&
    payload.errorCode === "runtime.task.local_owner_conflict"
  );
};
const buildOwnerConflictIgnoredEventSummary = (
  request: RuntimeTransportSubmitTaskResultRequest
): string =>
  `owner_conflict:${request.dispatchId}:${request.attemptId ?? "unknown"}`;
const extractRuntimeCoordinatorLocalOwnerConflictEvidence = (input: {
  attemptId: string | null;
  dispatchId: string;
  run?: RuntimeCoordinatorTokenRunAuthority | null;
  runtimeCoordinatorExecutionId: string | null;
  request?: RuntimeTransportSubmitTaskResultRequest;
}): Record<string, unknown> | null => {
  const payload = input.request?.taskResult.payload;
  if (
    payload &&
    payload.status === "failed" &&
    "localOwnerConflict" in payload &&
    payload.localOwnerConflict
  ) {
    return payload.localOwnerConflict;
  }
  return {
    activeAttemptId: null,
    activeDispatchId: null,
    activeExecutionTokenRunId: null,
    activeRuntimeCoordinatorExecutionId: null,
    activeTaskId: null,
    reason: "task.owner_conflict",
    rejectedAttemptId: input.attemptId,
    rejectedDispatchId: input.dispatchId,
    rejectedExecutionTokenRunId: input.run?.runId ?? null,
    rejectedRuntimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    rejectedTaskId: null,
  };
};
const resolveCoordinatorLifecycleEventType = (
  phase: RuntimeTransportDispatchLifecycleRequest["phase"]
): RuntimeCoordinatorExecutionEventType => {
  if (phase === "accepted_local") {
    return "lifecycle_accepted_local";
  }
  if (phase === "running") {
    return "lifecycle_running";
  }
  return "lifecycle_completed_local";
};
// A Wake held in the Service's local queue records that wait separately, so the
// frame sent when it leaves the queue is not deduplicated into the wait.
const buildCoordinatorLifecycleEventIdempotencyKey = (
  request: RuntimeTransportDispatchLifecycleRequest
): string =>
  [
    "lifecycle",
    request.dispatchId,
    request.attemptId,
    request.phase,
    request.agentControllerConversationOccupancy?.state ?? "progress",
    ...(request.localQueue?.status === "queued" ? ["queued"] : []),
  ].join(":");
const resolveResultIdentityEchoMismatch = (input: {
  authoritative: CompletedDispatchResultState["executionIdentity"];
  echoed: RuntimeTransportSubmitTaskResultRequest["executionIdentityEcho"];
}):
  | "bindingId"
  | "agentControllerRef"
  | "modelVersion"
  | "openMeldServiceRuntimeId"
  | "scope"
  | null => {
  const authoritative = input.authoritative.core;
  const echoed = input.echoed.core;
  if (authoritative.modelVersion !== echoed.modelVersion) {
    return "modelVersion";
  }
  if (
    authoritative.spaceId !== echoed.spaceId ||
    authoritative.dispatchId !== echoed.dispatchId ||
    authoritative.targetProfileId !== echoed.targetProfileId
  ) {
    return "scope";
  }
  if (authoritative.bindingId !== echoed.bindingId) {
    return "bindingId";
  }
  if (
    authoritative.openMeldServiceRuntimeId.value !==
    echoed.openMeldServiceRuntimeId.value
  ) {
    return "openMeldServiceRuntimeId";
  }
  if (authoritative.agentControllerRef !== echoed.agentControllerRef) {
    return "agentControllerRef";
  }
  return null;
};
const parseRuntimeCoordinatorStoppedTaskProjectionIndex = (
  value: unknown
): string[] => {
  if (
    !value ||
    typeof value !== "object" ||
    !("publicationIds" in value) ||
    !Array.isArray(value.publicationIds)
  ) {
    return [];
  }
  return [
    ...new Set(
      value.publicationIds
        .map((publicationId) => normalizeOptionalText(publicationId))
        .filter((publicationId): publicationId is string =>
          Boolean(publicationId)
        )
    ),
  ].sort();
};
const readJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};
const hasSameSerializedValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const isCompletedInteractionReplay = (
  state: RuntimeCoordinatorRunCommandState,
  interactionId: string
): boolean =>
  !state.pendingInteraction &&
  Object.hasOwn(state.interactionResponseReceipts ?? {}, interactionId);

const parseDaemonStreamFrame = (
  rawMessage: string | ArrayBuffer
): DaemonStreamFrame | null => {
  const text = decodeWebSocketMessage(rawMessage);
  let rawFrame: unknown;
  try {
    rawFrame = JSON.parse(text);
  } catch {
    return null;
  }
  const parsedFrame = daemonStreamFrameSchema.safeParse(rawFrame);
  return parsedFrame.success ? parsedFrame.data : null;
};
const parseWaitDispatchResultRequest = (
  value: unknown
): WaitDispatchResultRequest | null => {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!raw) {
    return null;
  }
  const parsed = runtimeTransportWaitDispatchResultRequestSchema.safeParse({
    attemptId: normalizeOptionalText(raw.attemptId),
    dispatchId: normalizeOptionalText(raw.dispatchId),
    daemonSessionId: normalizeOptionalText(raw.daemonSessionId),
    connectionGeneration:
      typeof raw.connectionGeneration === "number" &&
      Number.isInteger(raw.connectionGeneration) &&
      raw.connectionGeneration > 0
        ? raw.connectionGeneration
        : null,
    leaseEpoch:
      typeof raw.leaseEpoch === "number" &&
      Number.isInteger(raw.leaseEpoch) &&
      raw.leaseEpoch > 0
        ? raw.leaseEpoch
        : null,
    timeoutMs:
      typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
        ? Math.trunc(raw.timeoutMs)
        : undefined,
  });
  return parsed.success ? parsed.data : null;
};
const decodeWebSocketMessage = (message: string | ArrayBuffer): string => {
  if (typeof message === "string") {
    return message;
  }
  return new TextDecoder().decode(message);
};
const safeCloseSocket = (
  socket: WebSocket,
  code: number,
  reason: string
): void => {
  try {
    socket.close(code, reason);
  } catch {
    // ignore
  }
};

import {
  type RiskWindowExecutionsResponse,
  riskWindowExecutionsResponseSchema,
  runtimeCoordinatorExecutionAccessRequestSchema,
  runtimeCoordinatorExecutionAccessResponseSchema,
  runtimeCoordinatorExecutionTokenEchoSchema,
  runtimeTransportSessionHistoryRequestSchema,
  SESSION_HISTORY_CAPABILITY_HEADER,
  SESSION_HISTORY_RUNTIME_CAPABILITY,
  sessionHistoryResultFrameSchema,
  sessionHistoryResultSchema,
  type TaskCredentialResolution,
  taskCredentialResolutionSchema,
} from "@openmeld/schemas";
