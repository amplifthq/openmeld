export const CORE_LOG_EVENTS = {
  coreInternalError: "core_internal_error",
  runtimeTransportClientRequestTimeout:
    "runtime_transport_client_request_timeout",
  runtimeTransportReadAttemptFailed: "runtime_transport_read_attempt_failed",
  runtimeTransportGatePhase: "runtime_transport_gate_phase",
  runtimeTransportConnectionGenerationResultRejected:
    "runtime_transport_connection_generation_result_rejected",
  runtimeTransportDeliveryRouteAssessed:
    "runtime_transport_delivery_route_assessed",
  runtimeTransportStaleLeaseResultRejected:
    "runtime_transport_stale_lease_result_rejected",
  dispatchExecutionDaemonDelivered: "dispatch_execution_daemon_delivered",
  dispatchExecutionRouteBlocked: "dispatch_execution_route_blocked",
  dispatchExecutionRouteResolved: "dispatch_execution_route_resolved",
  dispatchExecutionWaitCompleted: "dispatch_execution_wait_completed",
  dispatchExecutionWaitFailed: "dispatch_execution_wait_failed",
  dispatchExecutionWaitStarted: "dispatch_execution_wait_started",
  agentExecutionReadinessResolved: "agent_execution_readiness_resolved",
  spaceMembersSnapshotBuilt: "space_members_snapshot_built",
  dispatchQueueBindingSource: "dispatch_queue_binding_source",
  dispatchQueueEnsureTablesFailed: "dispatch_queue_ensure_tables_failed",
  dispatchQueueHintEmitFailed: "dispatch_queue_hint_emit_failed",
  dispatchQueueHostedNativeDeliveryReplyingHint:
    "dispatch_queue_hosted_native_delivery_replying_hint",
  dispatchQueueInvalidPayload: "dispatch_queue_invalid_payload",
  dispatchQueueInvalidPayloadAuditFailed:
    "dispatch_queue_invalid_payload_audit_failed",
  dispatchQueueReplyingHintClaimFailed:
    "dispatch_queue_replying_hint_claim_failed",
  dispatchQueueReplyingHintClaimRollbackFailed:
    "dispatch_queue_replying_hint_claim_rollback_failed",
  dispatchQueueReplyingHintClearEmitFailed:
    "dispatch_queue_replying_hint_clear_emit_failed",
  dispatchQueueReplyingHintEmitFailed:
    "dispatch_queue_replying_hint_emit_failed",
  dispatchQueueReplyingHintEmitRetryFailed:
    "dispatch_queue_replying_hint_emit_retry_failed",
  dispatchQueueReplyingHintMissingLedger:
    "dispatch_queue_replying_hint_missing_ledger",
  dispatchQueueRetryFailed: "dispatch_queue_retry_failed",
  dispatchQueueRetryFailedNoOptions: "dispatch_queue_retry_failed_no_options",
  dispatchQueueRisk: "dispatch_queue_risk",
  dispatchQueueStaleLeaseAuditFailed: "dispatch_queue_stale_lease_audit_failed",
  dispatchQueueStaleLeaseAuditFallbackContext:
    "dispatch_queue_stale_lease_audit_fallback_context",
  opsDecisionWriteFailed: "ops_decision_write_failed",
  presencePersistFailed: "presence_persist_failed",
  remoteAgentStreamDeltaRejected: "remote_agent_stream_delta_rejected",
  remoteAgentStreamPartRejected: "remote_agent_stream_part_rejected",
  remoteAgentStreamTerminalSkipped: "remote_agent_stream_terminal_skipped",
  slackRichContextRepro: "core.remote_agent.slack_ingest.rich_context_repro",
  retentionDebt: "retention_debt",
  retentionWarningEmitFailed: "retention_warning_emit_failed",
  spaceMetaInvalidJson: "space_meta_invalid_json",
} as const;

export type CoreLogEvent =
  (typeof CORE_LOG_EVENTS)[keyof typeof CORE_LOG_EVENTS];
