export type RuntimeTransportStopCause = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport-stop-cause")["runtimeTransportStopCauseSchema"]
>;

export type RuntimeTransportErrorCode = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportErrorCodeSchema"]
>;

export type RuntimeTransportLease = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLeaseSchema"]
>;

export type RuntimeTransportCapabilities = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportCapabilitiesSchema"]
>;

export type RuntimeTransportBaseCapabilities = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportBaseCapabilitiesSchema"]
>;

export type LocalWakeRouteReport = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["localWakeRouteReportSchema"]
>;
export type LocalWakeRouteWorkingFolderObservation = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["localWakeRouteWorkingFolderObservationSchema"]
>;
export type LocalWakeRouteWorkingFolderReasonCode = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["localWakeRouteWorkingFolderReasonCodeSchema"]
>;

export type RuntimeTransportRejectedProfileRegistration =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRejectedProfileRegistrationSchema"]
  >;

export type DaemonRuntimeContract = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["daemonRuntimeContractSchema"]
>;

export type DaemonRuntimeContractReasonCode = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["daemonRuntimeContractReasonCodeSchema"]
>;

export type DaemonExecutionCompatibility = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["daemonExecutionCompatibilitySchema"]
>;

export type RuntimeTransportAgentProfileExecutionStateRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileExecutionStateRequestSchema"]
  >;

export type RuntimeTransportAgentProfileExecutionStateResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileExecutionStateResponseSchema"]
  >;

export type RuntimeTransportAgentProfileOperationalContext =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileOperationalContextSchema"]
  >;

export type RuntimeTransportAgentProfileOperationalContextsRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileOperationalContextsRequestSchema"]
  >;

export type RuntimeTransportAgentProfileOperationalContextsResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileOperationalContextsResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkRecoveryAction =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkRecoveryActionSchema"]
  >;

export type RuntimeTransportAgentProfileWorkRecoveryReadRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkRecoveryReadRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkRecoveryReadResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkRecoveryReadResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkUsageAvailableRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkUsageAvailableRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkUsageAvailableResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkUsageAvailableResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkContinuationAuthorizeRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkContinuationAuthorizeResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkContinuationAuthorizeResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkContinuationNeedsAttentionRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkContinuationNeedsAttentionRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkContinuationNeedsAttentionResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkContinuationNeedsAttentionResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkHandoffRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkHandoffRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkHandoffResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkHandoffResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkQueueApproveRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkQueueApproveRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkQueueApproveResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkQueueApproveResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkSkipRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkSkipRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkSkipResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkSkipResponseSchema"]
  >;

export type RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkLocalAttemptWithdrawalRequestSchema"]
  >;

export type RuntimeTransportAgentProfileWorkLocalAttemptWithdrawalResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileWorkLocalAttemptWithdrawalResponseSchema"]
  >;

export type RuntimeTransportAgentProfileExecutionTargetMutationRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileExecutionTargetMutationRequestSchema"]
  >;

export type RuntimeTransportAgentProfileLegacyConversationMutationRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileLegacyConversationMutationRequestSchema"]
  >;

export type RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema"]
  >;

export type RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema"]
  >;

export type RuntimeTransportRegisterSessionRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRegisterSessionRequestSchema"]
>;

export type RuntimeTransportRegisterSessionResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRegisterSessionResponseSchema"]
>;

export type RuntimeTransportHeartbeatRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportHeartbeatRequestSchema"]
>;

export type RuntimeTransportHeartbeatResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportHeartbeatResponseSchema"]
>;

export type RuntimeTransportSetLocalAgentEnabledRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSetLocalAgentEnabledRequestSchema"]
  >;

export type RuntimeTransportSetLocalAgentEnabledResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSetLocalAgentEnabledResponseSchema"]
  >;

export type RuntimeTransportManageLocalAgentInstallationRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportManageLocalAgentInstallationRequestSchema"]
  >;

export type RuntimeTransportManageLocalAgentInstallationResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportManageLocalAgentInstallationResponseSchema"]
  >;

export type RuntimeTransportOpenMeldToolsControlRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportOpenMeldToolsControlRequestSchema"]
  >;

export type RuntimeTransportOpenMeldToolsControlResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportOpenMeldToolsControlResponseSchema"]
  >;

export type RuntimeTransportOpenMeldToolsControlFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportOpenMeldToolsControlFramePayloadSchema"]
  >;

export type RuntimeTransportOpenMeldToolsControlResultFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportOpenMeldToolsControlResultFramePayloadSchema"]
  >;

export type RuntimeTransportRefreshLocalAgentCatalogRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRefreshLocalAgentCatalogRequestSchema"]
  >;

export type RuntimeTransportRefreshLocalAgentCatalogResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRefreshLocalAgentCatalogResponseSchema"]
  >;

export type RuntimeTransportSetProfileWorkspaceRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSetProfileWorkspaceRequestSchema"]
>;

export type RuntimeTransportReadProfileWorkspaceRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportReadProfileWorkspaceRequestSchema"]
  >;
export type RuntimeTransportReadProfileWorkspaceResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportReadProfileWorkspaceResponseSchema"]
  >;
export type RuntimeTransportLocalAgentControlReadProfileWorkspaceFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlReadProfileWorkspaceFramePayloadSchema"]
  >;

export type RuntimeTransportSetProfileWorkspaceResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSetProfileWorkspaceResponseSchema"]
  >;

export type RuntimeTransportForkAgentSessionRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportForkAgentSessionRequestSchema"]
>;

export type RuntimeTransportForkAgentSessionResult = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportForkAgentSessionResultSchema"]
>;

export type RuntimeTransportLocalAgentControlSetEnabledFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema"]
  >;

export type RuntimeTransportLocalAgentControlForkSessionFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlForkSessionFramePayloadSchema"]
  >;

export type RuntimeTransportLocalAgentControlManageInstallationFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema"]
  >;

export type RuntimeTransportLocalAgentControlRefreshCatalogFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema"]
  >;

export type RuntimeTransportLocalAgentControlSetProfileWorkspaceFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema"]
  >;

export type RuntimeTransportLocalAgentControlCancelFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlCancelFramePayloadSchema"]
  >;

export type RuntimeTransportLocalAgentControlInterruptFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlInterruptFramePayloadSchema"]
  >;

export type RuntimeTransportLocalAgentControlResultFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLocalAgentControlResultFramePayloadSchema"]
  >;

export type RuntimeTransportInspectExecutionRecoveryRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportInspectExecutionRecoveryRequestSchema"]
  >;

export type RuntimeTransportInspectExecutionRecoveryResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportInspectExecutionRecoveryResponseSchema"]
  >;

export type RuntimeTransportResumeControllerConversationRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportResumeControllerConversationRequestSchema"]
  >;

export type RuntimeTransportResumeControllerConversationFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportResumeControllerConversationFramePayloadSchema"]
  >;

export type RuntimeTransportResumeControllerConversationResult =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportResumeControllerConversationResultSchema"]
  >;

export type RuntimeTransportResumeControllerConversationResultFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportResumeControllerConversationResultFramePayloadSchema"]
  >;

export type RuntimeTransportResumeControllerConversationResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportResumeControllerConversationResponseSchema"]
  >;

export type RuntimeTransportRouteCatalogChangedFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRouteCatalogChangedFramePayloadSchema"]
  >;

export type RuntimeTransportNotifyRouteCatalogChangedRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportNotifyRouteCatalogChangedRequestSchema"]
  >;

export type RuntimeTransportNotifyRouteCatalogChangedResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportNotifyRouteCatalogChangedResponseSchema"]
  >;

export type RuntimeTransportLookupOwnerServiceRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLookupOwnerServiceRequestSchema"]
>;

export type RuntimeTransportLookupOwnerServiceResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLookupOwnerServiceResponseSchema"]
>;

export type RuntimeTransportSocketDisconnectClass = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSocketDisconnectClassSchema"]
>;

export type RuntimeTransportSocketCloseReasonCode = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSocketCloseReasonCodeSchema"]
>;

export type RuntimeTransportSocketDisconnectRateBucket = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSocketDisconnectRateBucketSchema"]
>;

export type RuntimeTransportSessionDisconnectDiagnostic =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSessionDisconnectDiagnosticSchema"]
  >;

export type RuntimeTransportDisconnectRatesResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDisconnectRatesResponseSchema"]
>;

export type RuntimeTransportLookupRouteRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLookupRouteRequestSchema"]
>;

export type RuntimeTransportLookupRouteResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLookupRouteResponseSchema"]
>;

export type RuntimeTransportLookupRoutesBatchRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLookupRoutesBatchRequestSchema"]
>;

export type RuntimeTransportLookupRoutesBatchResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportLookupRoutesBatchResponseSchema"]
>;

export type RuntimeTransportDispatchSourceSignal = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchSourceSignalSchema"]
>;

export type RuntimeTransportDeliverDispatchPayload = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDeliverDispatchPayloadSchema"]
>;

export type RuntimeTransportDeliverDispatchRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDeliverDispatchRequestSchema"]
>;

export type RuntimeTransportDeliverDispatchResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDeliverDispatchResponseSchema"]
>;

export type RuntimeTransportDispatchPreviewRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchPreviewRequestSchema"]
>;

export type RuntimeTransportDispatchPreviewEndRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchPreviewEndRequestSchema"]
>;

export type RuntimeTransportDispatchLifecyclePhase = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchLifecyclePhaseSchema"]
>;

export type RuntimeTransportAgentControllerConversationOccupancy =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportAgentControllerConversationOccupancySchema"]
  >;

export type RuntimeTransportDispatchLocalQueueWaitReason =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchLocalQueueWaitReasonSchema"]
  >;

export type RuntimeTransportDispatchLocalQueueDiagnostics =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchLocalQueueDiagnosticsSchema"]
  >;

export type RuntimeTransportDispatchLifecycleRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchLifecycleRequestSchema"]
>;

export type RuntimeTransportDispatchRuntimeEvidencePhase =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchRuntimeEvidencePhaseSchema"]
  >;

export type RuntimeTransportDispatchRuntimeEvidenceRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchRuntimeEvidenceRequestSchema"]
  >;

export type RuntimeTransportDispatchToolActivityRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchToolActivityRequestSchema"]
  >;

export type RuntimeTransportDispatchReasoningRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchReasoningRequestSchema"]
>;

export type RuntimeTransportDispatchProgressRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchProgressRequestSchema"]
>;

export type RuntimeTransportDispatchReplyRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchReplyRequestSchema"]
>;

export type RuntimeTransportDispatchInteractionRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchInteractionRequestSchema"]
>;

export type RuntimeTransportDispatchInteractionResponseFramePayload =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchInteractionResponseFramePayloadSchema"]
  >;

export type RuntimeTransportDispatchInteractionDeliveredRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchInteractionDeliveredRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorReadInteractionRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorReadInteractionRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorReadInteractionResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorReadInteractionRevisionResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorReadInteractionRevisionResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorRespondInteractionRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorRespondInteractionResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema"]
  >;

export type LocalAgentToolActivityName = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["localAgentToolActivityNameSchema"]
>;

export type RuntimeTransportDispatchLifecycleSnapshot = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDispatchLifecycleSnapshotSchema"]
>;

export type RuntimeTransportWaitDispatchResultRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportWaitDispatchResultRequestSchema"]
>;

export type RuntimeTransportWaitDispatchResultResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportWaitDispatchResultResponseSchema"]
>;

export type RuntimeTransportRuntimeCoordinatorDecisionEventKind =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorDecisionEventKindSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorDecisionTrigger =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorDecisionTriggerSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorDecisionRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorDecisionRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorDecisionResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorDecisionResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorWakeStopRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorWakeStopRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorWakeStopResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorWakeStopResponseSchema"]
  >;

export type RuntimeTransportDeletedAgentProfileWakeCancellationRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDeletedAgentProfileWakeCancellationRequestSchema"]
  >;

export type RuntimeTransportDeletedAgentProfileWakeCancellationResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportDeletedAgentProfileWakeCancellationResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadPreAgentStopReasonCode =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadPreAgentStopReasonCodeSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadPreAgentStopRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadAcceptAction =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadAcceptActionSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadAcceptRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadAcceptResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadLifecycleStatus =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadLifecycleStatusSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceRecord =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRecordSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadNoExecutionDecisionSource =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadNoExecutionDecisionSourceSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadNoExecutionReasonCode =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategory =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategorySchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryAction =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryActionSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadNoExecutionRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadNoExecutionResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadWaitingReasonCode =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadWaitingReasonCodeSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadWaitingCategory =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadWaitingCategorySchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadWaitingRecoveryAction =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadWaitingRecoveryActionSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadWaitingRequest =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema"]
  >;

export type RuntimeTransportRuntimeCoordinatorHeadWaitingResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema"]
  >;

export type RuntimeTransportPreExecutionHandoffReasonCode =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportPreExecutionHandoffReasonCodeSchema"]
  >;

export type RuntimeTransportPreExecutionHandoffRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportPreExecutionHandoffRequestSchema"]
>;

export type RuntimeTransportPreExecutionHandoffResponse =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportPreExecutionHandoffResponseSchema"]
  >;

export type RuntimeTransportSubmitTaskResultRequest = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSubmitTaskResultRequestSchema"]
>;

export type RuntimeTransportSubmitTaskResultResponse = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["runtimeTransportSubmitTaskResultResponseSchema"]
>;

export type DaemonStreamCode = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["daemonStreamCodeSchema"]
>;

export type DaemonStreamFrame = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["daemonStreamFrameSchema"]
>;

export type DaemonStreamErrorFrame = import("zod/v4").infer<
  typeof import("../../schemas/daemon/runtime-transport")["daemonStreamErrorFrameSchema"]
>;
