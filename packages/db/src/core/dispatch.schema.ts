import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";
import {
  agentActivityDailyAggregates,
  agentActivityDailySessionKeys,
  agentActivityDigests,
  agentActivityEvents,
  agentActivitySessionInventory,
  agentActivitySessionInventoryCandidates,
  agentActivitySessionInventoryMemberCleanupRequests,
  agentActivitySessionInventorySources,
  agentActivitySessions,
} from "./agent-activity.schema.ts";
import { openMeldDaemonAgentExecutionReadinessImpacts } from "./agent-execution-readiness-impact.schema.ts";
import { openMeldDaemonAgentProfileBindings } from "./agent-profile-binding.schema.ts";
import { agentProfileCreationDefaults } from "./agent-profile-creation-defaults.schema.ts";
import {
  agentProfileCreationApprovalPreferences,
  agentProfileCreationRequests,
} from "./agent-profile-creation-request.schema.ts";
import {
  agentControllerTaskLifecycleEvents,
  agentControllerTasks,
  agentDelegationChildren,
  agentDelegations,
  agentTaskCompletionSubscriptions,
  agentTaskNeedsAttentionObservations,
  agentTaskTerminalOutcomes,
  centerAgentWakePublications,
} from "./agent-task-coordination.schema.ts";
import {
  centerAgentAttentionRequests,
  centerAgentAuditJournal,
  centerAgentConnectorActionOperations,
  centerAgentContextLoadReceipts,
  centerAgentContextManifestMaterializations,
  centerAgentContextManifests,
  centerAgentDesignations,
} from "./center-agent.schema.ts";
import {
  centerAgentMemberResearchBatches,
  centerAgentMemberResearchComputerFiles,
  centerAgentMemberResearchTasks,
} from "./center-agent-member-research.schema.ts";
import {
  centerAgentMemoryPolicies,
  centerAgentMemorySubjects,
} from "./center-agent-memory.schema.ts";
import { centerAgentPublicationOperations } from "./center-agent-publication.schema.ts";
import {
  centerAgentTaskAdmissionOutbox,
  centerAgentTaskAttempts,
  centerAgentTaskAuthorizedReaders,
  centerAgentTaskEvents,
  centerAgentTasks,
} from "./center-agent-tasks.schema.ts";
import { openMeldDaemonConnectedComputers } from "./connected-computer.schema.ts";
import {
  connectorAppRequests,
  connectorConnections,
  githubAppInstallationStates,
} from "./connector-connection.schema.ts";
import { openMeldDaemonCurrentDeviceTargets } from "./current-device-target.schema.ts";
import { evalReports } from "./eval-report.schema.ts";
import {
  openMeldFeedbackInboxes,
  openMeldFeedbackIssues,
  openMeldFeedbackReportingPolicies,
} from "./feedback.schema.ts";
import { openMeldDaemonForgottenDevices } from "./forgotten-device.schema.ts";
import {
  inboxCenterAgentReadWatermarks,
  inboxEmailDeliveries,
  inboxItems,
  inboxNotificationPreferences,
  inboxSpaceThreadReadWatermarks,
} from "./inbox.schema.ts";
import {
  openMeldRemoteAgentLarkPlatformChannelConnections,
  openMeldRemoteAgentLarkPlatformChannelCredentials,
  openMeldRemoteAgentLarkPlatformContextCursors,
  openMeldRemoteAgentLarkPlatformIdentityLinks,
  openMeldRemoteAgentLarkPlatformRegistrationAttempts,
  openMeldRemoteAgentMessageChannelEventIngress,
  openMeldRemoteAgentMessageChannelIdentityLinkTokens,
  organizationMessageChannelSetupRequests,
} from "./message-channel.schema.ts";
import { organizationOpportunities } from "./opportunity.schema.ts";
import { organizationBindingAuthorizations } from "./organization-binding-authorization.schema.ts";
import { organizationBindingAuthorizationPreferences } from "./organization-binding-authorization-preference.schema.ts";
import { organizationDocuments } from "./organization-document.schema.ts";
import { organizationDocumentFolders } from "./organization-document-folder.schema.ts";
import { centerAgentOrganizationDocumentOperations } from "./organization-document-operation.schema.ts";
import { organizationInformationProtectionPolicies } from "./organization-information-protection.schema.ts";
import { organizationJoinRequests } from "./organization-join-request.schema.ts";
import { organizationMemberActivity } from "./organization-member-activity.schema.ts";
import {
  centerAgentOrganizationSkillOperations,
  organizationSkillActivations,
  organizationSkillMaintainers,
  organizationSkillReleases,
  organizationSkills,
} from "./organization-skill.schema.ts";
import { organizationWorkingLanguagePreferences } from "./organization-working-language.schema.ts";
import { openMeldDaemonOwnedDevices } from "./owned-device.schema.ts";
import { openMeldDaemonPreHeadFailurePublicationOutbox } from "./pre-head-failure-publication-outbox.schema.ts";
import {
  openMeldDaemonPrepareSessionEvents,
  openMeldDaemonPrepareSessions,
  openMeldDaemonPrepareSessionTokens,
} from "./prepare-session.schema.ts";
import {
  centerAgentProjectOperations,
  centerAgentProjectRemoveConfirmations,
  projects,
} from "./project.schema.ts";
import { openMeldDaemonProviderAccessEvidence } from "./provider-access-evidence.schema.ts";
import { openMeldDaemonProviderConversationProofs } from "./provider-conversation-proof.schema.ts";
import { routineRuns, routines } from "./routine.schema.ts";
import { openMeldDaemonRuntimeAgentControllerReports } from "./runtime-agent-controller-report.schema.ts";
import { openMeldDaemonRuntimeRegistryRecords } from "./runtime-registry.schema.ts";
import { spaceAttachments } from "./space-attachment.schema.ts";
import {
  spaceIndexMemberships,
  spaceIndexProjectionEvents,
  spaceIndexSpaces,
  spaceOwnerMemberReferences,
} from "./space-index.schema.ts";
import { spaceInvitations } from "./space-invitation.schema.ts";

export const openMeldDaemonOpsDecisions = sqliteTable(
  "openMeldDaemon_ops_decisions",
  {
    id: text("id").primaryKey(),
    decisionCode: text("decision_code").notNull(),
    decisionPayloadJson: text("decision_payload_json").notNull(),
    decidedBy: text("decided_by").notNull(),
    decidedAtMs: integer("decided_at_ms").notNull(),
    expectedRecoveryCriteria: text("expected_recovery_criteria"),
    source: text("source").notNull(),
    correlationId: text("correlation_id"),
  },
  (table) => [
    // D4 trace contract (physical-db-split.md): per correlation, keep only the
    // latest row per decision code via upsert. NULL correlation rows never
    // conflict (SQLite treats NULLs as distinct) and insert normally.
    uniqueIndex("uq_openMeldDaemon_ops_decisions_correlation_code").on(
      table.correlationId,
      table.decisionCode
    ),
    index("idx_openMeldDaemon_ops_decisions_time").on(desc(table.decidedAtMs)),
    index("idx_openMeldDaemon_ops_decisions_code_time").on(
      table.decisionCode,
      desc(table.decidedAtMs)
    ),
    index("idx_openMeldDaemon_ops_decisions_correlation_time").on(
      table.correlationId,
      desc(table.decidedAtMs)
    ),
    index("idx_openMeldDaemon_ops_decisions_correlation_code_time").on(
      table.correlationId,
      table.decisionCode,
      desc(table.decidedAtMs)
    ),
  ]
);

export const openMeldDaemonDispatchLedger = sqliteTable(
  "openMeldDaemon_dispatch_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    spaceId: text("space_id").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    sourceProfileId: text("source_profile_id"),
    sourceClientMessageId: text("source_client_message_id"),
    dispatchOwnerKind: text("dispatch_owner_kind"),
    dispatchOwnerId: text("dispatch_owner_id"),
    targetProfileId: text("target_profile_id").notNull(),
    status: text("status").notNull(),
    firstSeenAtMs: integer("first_seen_at_ms").notNull(),
    lastAttemptAtMs: integer("last_attempt_at_ms").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    latestAttemptId: text("latest_attempt_id"),
    replyHintSentAtMs: integer("reply_hint_sent_at_ms"),
    finalReplySentAtMs: integer("final_reply_sent_at_ms"),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_dispatch_ledger_idempotency_key_unique").on(
      table.idempotencyKey
    ),
    index("idx_openMeldDaemon_dispatch_ledger_dispatch_id").on(
      table.dispatchId
    ),
    index("idx_openMeldDaemon_dispatch_ledger_space_source_target").on(
      table.spaceId,
      table.sourceEventId,
      table.targetProfileId
    ),
    index("idx_openMeldDaemon_dispatch_ledger_space_source_profile_target").on(
      table.spaceId,
      table.sourceProfileId,
      table.targetProfileId,
      table.dispatchId
    ),
    index("idx_openMeldDaemon_dispatch_ledger_space_client_message_target").on(
      table.spaceId,
      table.sourceClientMessageId,
      table.targetProfileId
    ),
    index("idx_openMeldDaemon_dispatch_ledger_status_last_attempt").on(
      table.status,
      table.lastAttemptAtMs
    ),
  ]
);

export const openMeldDaemonDispatchAttempts = sqliteTable(
  "openMeldDaemon_dispatch_attempts",
  {
    attemptId: text("attempt_id").primaryKey(),
    dispatchId: text("dispatch_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    status: text("status").notNull(),
    daemonSessionId: text("daemon_session_id"),
    connectionGeneration: integer("connection_generation"),
    leaseEpoch: integer("lease_epoch"),
    taskId: text("task_id"),
    targetProfileId: text("target_profile_id"),
    executionIdentityModelVersion: text("execution_identity_model_version"),
    executionBindingId: text("execution_binding_id"),
    executionRuntimeId: text("execution_openmeld_service_runtime_id"),
    executionAgentControllerRef: text("execution_agent_controller_ref"),
    createdAtMs: integer("created_at_ms").notNull(),
    startedAtMs: integer("started_at_ms"),
    finishedAtMs: integer("finished_at_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("idx_openMeldDaemon_dispatch_attempts_dispatch_attempt_no").on(
      table.dispatchId,
      desc(table.attemptNo)
    ),
    index("idx_openMeldDaemon_dispatch_attempts_status_created").on(
      table.status,
      desc(table.createdAtMs)
    ),
  ]
);

export const openMeldDaemonDlq = sqliteTable(
  "openMeldDaemon_dlq",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dispatchId: text("dispatch_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    targetProfileId: text("target_profile_id").notNull(),
    errorCode: text("error_code").notNull(),
    errorMessage: text("error_message"),
    failedAtMs: integer("failed_at_ms").notNull(),
  },
  (table) => [index("idx_openMeldDaemon_dlq_failed_at").on(table.failedAtMs)]
);

export const openMeldDaemonDispatchResults = sqliteTable(
  "openMeldDaemon_dispatch_results",
  {
    resultRef: text("result_ref").primaryKey(),
    dispatchId: text("dispatch_id").notNull(),
    spaceId: text("space_id").notNull(),
    actorProfileId: text("actor_profile_id").notNull(),
    actorName: text("actor_name"),
    replyToSignalId: text("reply_to_signal_id"),
    resultKind: text("result_kind").notNull(),
    finalText: text("final_text"),
    messageEnvelopeJson: text("message_envelope_json"),
    statusType: text("status_type"),
    previewText: text("preview_text"),
    publicOutcome: text("public_outcome").notNull(),
    publishedSignalId: text("published_signal_id"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_dispatch_results_dispatch_id_unique").on(
      table.dispatchId
    ),
    index("idx_openMeldDaemon_dispatch_results_space_created").on(
      table.spaceId,
      desc(table.createdAtMs)
    ),
    index("idx_openMeldDaemon_dispatch_results_actor_created").on(
      table.actorProfileId,
      desc(table.createdAtMs)
    ),
  ]
);

export const openMeldDaemonDispatchResultInbox = sqliteTable(
  "openMeldDaemon_dispatch_result_inbox",
  {
    resultKey: text("result_key").primaryKey(),
    dispatchId: text("dispatch_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    taskId: text("task_id").notNull(),
    targetProfileId: text("target_profile_id").notNull(),
    daemonSessionId: text("daemon_session_id").notNull(),
    leaseEpoch: integer("lease_epoch").notNull(),
    submittedConnectionGeneration: integer(
      "submitted_connection_generation"
    ).notNull(),
    runtimeCoordinatorExecutionId: text("runtime_coordinator_execution_id"),
    executionTokenRunId: text("execution_token_run_id"),
    executionTokenFingerprint: text("execution_token_fingerprint"),
    resultPayloadJson: text("result_payload_json").notNull(),
    acceptedAtMs: integer("accepted_at_ms").notNull(),
    publishState: text("publish_state").notNull(),
    publishedSignalId: text("published_signal_id"),
    publicationErrorCode: text("publication_error_code"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("idx_openMeldDaemon_dispatch_result_inbox_dispatch_attempt").on(
      table.dispatchId,
      table.attemptId
    ),
    index("idx_openMeldDaemon_dispatch_result_inbox_publish_state").on(
      table.publishState,
      desc(table.updatedAtMs)
    ),
    index("idx_openMeldDaemon_dispatch_result_inbox_runtime_coordinator").on(
      table.runtimeCoordinatorExecutionId,
      table.executionTokenRunId
    ),
  ]
);

export const openMeldRemoteAgentNativeDeliveryLedger = sqliteTable(
  "openMeldRemoteAgent_native_delivery_ledger",
  {
    deliveryId: text("delivery_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    conversationKind: text("conversation_kind").notNull().default("space"),
    spaceId: text("space_id").notNull(),
    profileId: text("profile_id").notNull(),
    bindingId: text("binding_id").notNull(),
    controllerStoredAgentControllerRef: text(
      "controller_stored_agent_controller_ref"
    ),
    controllerStoredAgentControllerRefStatus: text(
      "controller_stored_agent_controller_ref_status"
    ),
    controllerBindingUpdatedAtMs: integer("controller_binding_updated_at_ms"),
    triggerMessageId: text("trigger_message_id").notNull(),
    sourceClientMessageId: text("source_client_message_id"),
    triggerText: text("trigger_text"),
    routineRunId: text("routine_run_id"),
    routineNameSnapshot: text("routine_name_snapshot"),
    workerSubmitRequestJson: text("worker_submit_request_json"),
    executionRecoverySubmitRequestJson: text(
      "execution_recovery_submit_request_json"
    ),
    anonymousMemberSpeakerJson: text("anonymous_member_speaker_json"),
    dispatchId: text("dispatch_id").notNull(),
    attemptId: text("attempt_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    submissionId: text("submission_id"),
    workerRequestId: text("worker_request_id"),
    status: text("status").notNull(),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    onBehalfOfProfileId: text("on_behalf_of_profile_id"),
    onBehalfOfUserId: text("on_behalf_of_user_id"),
    onBehalfOfDisplayName: text("on_behalf_of_display_name"),
    threadContextJson: text("thread_context_json"),
    slackTeamId: text("slack_team_id"),
    slackChannelId: text("slack_channel_id"),
    slackThreadTs: text("slack_thread_ts"),
    slackWorkingStatusTurnId: text("slack_working_status_turn_id"),
    messageChannelProvider: text("message_channel_provider"),
    messageChannelConnectionId: text("message_channel_connection_id"),
    messageChannelLocatorJson: text("message_channel_locator_json"),
    providerPublicationIdempotencyKey: text(
      "provider_publication_idempotency_key"
    ),
    providerPublicationResultId: text("provider_publication_result_id"),
    providerProgressState: text("provider_progress_state"),
    providerProgressClaimId: text("provider_progress_claim_id"),
    providerProgressClaimedAtMs: integer("provider_progress_claimed_at_ms"),
    providerProgressClaimExpiresAtMs: integer(
      "provider_progress_claim_expires_at_ms"
    ),
    providerProgressCardId: text("provider_progress_card_id"),
    providerProgressMessageId: text("provider_progress_message_id"),
    providerProgressPublicationIdempotencyKey: text(
      "provider_progress_publication_idempotency_key"
    ),
    providerProgressSequence: integer("provider_progress_sequence"),
    providerProgressPendingSequence: integer(
      "provider_progress_pending_sequence"
    ),
    providerProgressSourceOffset: integer("provider_progress_source_offset")
      .notNull()
      .default(0),
    providerProgressRolloverIndex: integer("provider_progress_rollover_index")
      .notNull()
      .default(0),
    providerProgressPendingSourceOffset: integer(
      "provider_progress_pending_source_offset"
    ),
    providerProgressPendingTextHash: text(
      "provider_progress_pending_text_hash"
    ),
    providerProgressPendingCardId: text("provider_progress_pending_card_id"),
    providerProgressFailureCode: text("provider_progress_failure_code"),
    finalPublicationState: text("final_publication_state"),
    finalPublicationClaimId: text("final_publication_claim_id"),
    finalPublicationClaimedAtMs: integer("final_publication_claimed_at_ms"),
    finalPublicationClaimExpiresAtMs: integer(
      "final_publication_claim_expires_at_ms"
    ),
    finalPublicationPayloadJson: text("final_publication_payload_json"),
    finalPublicationAttemptCount: integer("final_publication_attempt_count")
      .notNull()
      .default(0),
    finalPublicationAmbiguityDeadlineAtMs: integer(
      "final_publication_ambiguity_deadline_at_ms"
    ),
    finalPublicationNextAttemptAtMs: integer(
      "final_publication_next_attempt_at_ms"
    ),
    finalPublicationProviderProgressSequence: integer(
      "final_publication_provider_progress_sequence"
    ),
    inboxProjectionSuppressedReason: text("inbox_projection_suppressed_reason"),
    inboxProjectionSuppressedAtMs: integer("inbox_projection_suppressed_at_ms"),
    inboxProjectionAttemptedAtMs: integer("inbox_projection_attempted_at_ms"),
    publishedSignalId: text("published_signal_id"),
    executionEvidenceAtMs: integer("execution_evidence_at_ms"),
    executionEvidenceSequence: integer("execution_evidence_sequence"),
    centerAgentTaskTerminalProjectionAttemptedAtMs: integer(
      "center_agent_task_terminal_projection_attempted_at_ms"
    ),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    submittedAtMs: integer("submitted_at_ms"),
    acceptedAtMs: integer("accepted_at_ms"),
    callbackReceivedAtMs: integer("callback_received_at_ms"),
    completedAtMs: integer("completed_at_ms"),
    deadlineProbeEnqueuedAtMs: integer("deadline_probe_enqueued_at_ms"),
    acceptedProbeNextDueAtMs: integer("accepted_probe_next_due_at_ms"),
    retiredDeadlineFailureCode: text("retired_deadline_failure_code"),
    retiredDeadlineFailurePublishedSignalId: text(
      "retired_deadline_failure_published_signal_id"
    ),
    retiredDeadlineFailureReconciledAtMs: integer(
      "retired_deadline_failure_reconciled_at_ms"
    ),
    dailyAdmissionDayUtc: text("daily_admission_day_utc"),
  },
  (table) => [
    uniqueIndex(
      "openMeldRemoteAgent_native_delivery_idempotency_key_unique"
    ).on(table.idempotencyKey),
    uniqueIndex("openMeldRemoteAgent_native_delivery_submission_id_unique").on(
      table.submissionId
    ),
    index("idx_openMeldRemoteAgent_native_delivery_routine_run").on(
      table.routineRunId
    ),
    index("idx_openMeldRemoteAgent_native_delivery_org_profile_updated").on(
      table.organizationId,
      table.profileId,
      desc(table.updatedAtMs)
    ),
    index("idx_openMeldRemoteAgent_native_delivery_space_trigger").on(
      table.spaceId,
      table.triggerMessageId,
      table.profileId
    ),
    index("idx_openMeldRemoteAgent_native_delivery_slack_thread").on(
      table.slackTeamId,
      table.slackChannelId,
      table.slackThreadTs
    ),
    index("idx_openMeldRemoteAgent_native_delivery_message_channel").on(
      table.messageChannelProvider,
      table.messageChannelConnectionId
    ),
    uniqueIndex(
      "openMeldRemoteAgent_native_delivery_provider_publication_key_unique"
    ).on(table.providerPublicationIdempotencyKey),
    index("idx_openMeldRemoteAgent_native_delivery_status_updated").on(
      table.status,
      desc(table.updatedAtMs)
    ),
    index(
      "idx_openMeldRemoteAgent_native_delivery_task_terminal_projection"
    ).on(table.centerAgentTaskTerminalProjectionAttemptedAtMs),
    index("idx_openMeldRemoteAgent_native_delivery_inbox_projection").on(
      table.inboxProjectionAttemptedAtMs
    ),
    index("idx_openMeldRemoteAgent_native_delivery_routine_recovery").on(
      table.status,
      table.deadlineProbeEnqueuedAtMs,
      table.updatedAtMs
    ),
    index("idx_openMeldRemoteAgent_native_delivery_accepted_probe_due").on(
      table.status,
      table.acceptedProbeNextDueAtMs,
      table.updatedAtMs
    ),
    check(
      "openMeldRemoteAgent_native_delivery_status_check",
      sql`"status" in ('guardrail_rejected', 'flag_rejected', 'worker_unavailable', 'submitted', 'accepted', 'retry_observed', 'completed', 'callback_rejected', 'failed')`
    ),
  ]
);

export const openMeldRemoteAgentWorkLoopAttempts = sqliteTable(
  "openMeldRemoteAgent_work_loop_attempts",
  {
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => openMeldRemoteAgentNativeDeliveryLedger.deliveryId, {
        onDelete: "cascade",
      }),
    attempt: integer("attempt").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    submissionId: text("submission_id").notNull(),
    workerSubmitRequestJson: text("worker_submit_request_json").notNull(),
    checkpointReason: text("checkpoint_reason").notNull(),
    toolCallLimit: integer("tool_call_limit").notNull(),
    nextIdempotencyKey: text("next_idempotency_key").notNull(),
    continuedAtMs: integer("continued_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.deliveryId, table.attempt],
      name: "openMeldRemoteAgent_work_loop_attempts_pk",
    }),
    uniqueIndex(
      "openMeldRemoteAgent_work_loop_attempts_idempotency_key_unique"
    ).on(table.idempotencyKey),
    uniqueIndex(
      "openMeldRemoteAgent_work_loop_attempts_submission_id_unique"
    ).on(table.submissionId),
    uniqueIndex(
      "openMeldRemoteAgent_work_loop_attempts_next_idempotency_key_unique"
    ).on(table.nextIdempotencyKey),
    check(
      "openMeldRemoteAgent_work_loop_attempts_attempt_positive_check",
      sql`"attempt" > 0`
    ),
    check(
      "openMeldRemoteAgent_work_loop_attempts_reason_check",
      sql`"checkpoint_reason" = 'tool_call_budget_exhausted'`
    ),
    check(
      "openMeldRemoteAgent_work_loop_attempts_tool_call_limit_positive_check",
      sql`"tool_call_limit" > 0`
    ),
    check(
      "openMeldRemoteAgent_work_loop_attempts_continued_at_nonnegative_check",
      sql`"continued_at_ms" >= 0`
    ),
  ]
);

export const openMeldRemoteAgentDailyAdmissions = sqliteTable(
  "openMeldRemoteAgent_daily_admissions",
  {
    organizationId: text("organization_id").notNull(),
    dayUtc: text("day_utc").notNull(),
    admittedCount: integer("admitted_count").notNull(),
    lastAdmissionIdempotencyKey: text(
      "last_admission_idempotency_key"
    ).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.dayUtc],
      name: "openMeldRemoteAgent_daily_admissions_org_day_pk",
    }),
    check(
      "openMeldRemoteAgent_daily_admissions_day_utc_check",
      sql`length("day_utc") = 10`
    ),
    check(
      "openMeldRemoteAgent_daily_admissions_count_positive_check",
      sql`"admitted_count" > 0`
    ),
    check(
      "openMeldRemoteAgent_daily_admissions_idempotency_key_non_empty_check",
      sql`length(trim("last_admission_idempotency_key")) > 0`
    ),
    check(
      "openMeldRemoteAgent_daily_admissions_updated_after_created_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const openMeldRemoteAgentConversationGenerations = sqliteTable(
  "openMeldRemoteAgent_conversation_generations",
  {
    organizationId: text("organization_id").notNull(),
    logicalConversationId: text("logical_conversation_id").notNull(),
    activeGeneration: integer("active_generation").notNull(),
    startedAtMs: integer("started_at_ms"),
    rolloverDeliveryId: text("rollover_delivery_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.logicalConversationId],
      name: "openMeldRemoteAgent_conversation_generations_org_conversation_pk",
    }),
    index("idx_openMeldRemoteAgent_conversation_generations_updated").on(
      desc(table.updatedAtMs)
    ),
    check(
      "openMeldRemoteAgent_conversation_generations_identity_non_empty_check",
      sql`length(trim("organization_id")) > 0 and length(trim("logical_conversation_id")) > 0 and length(trim("rollover_delivery_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_conversation_generations_active_positive_check",
      sql`"active_generation" > 0`
    ),
    check(
      "openMeldRemoteAgent_conversation_generations_time_order_check",
      sql`"updated_at_ms" >= "created_at_ms" and ("started_at_ms" is null or "started_at_ms" >= "created_at_ms")`
    ),
  ]
);

export const openMeldRemoteAgentSlackEventIngress = sqliteTable(
  "openMeldRemoteAgent_slack_event_ingress",
  {
    eventKey: text("event_key").primaryKey(),
    eventId: text("event_id"),
    slackTeamId: text("slack_team_id").notNull(),
    state: text("state").default("queued").notNull(),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    firstReceivedAtMs: integer("first_received_at_ms").notNull(),
    lastReceivedAtMs: integer("last_received_at_ms").notNull(),
    deliveryAttemptCount: integer("delivery_attempt_count")
      .default(0)
      .notNull(),
    slackRetryNum: integer("slack_retry_num"),
    slackRetryReason: text("slack_retry_reason"),
    gatewayRequestId: text("gateway_request_id").notNull(),
    queueMessageId: text("queue_message_id"),
    queueAttempts: integer("queue_attempts"),
    outcomeStatus: text("outcome_status"),
    failureCode: text("failure_code"),
    completedAtMs: integer("completed_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("idx_openMeldRemoteAgent_slack_event_ingress_state_claim").on(
      table.state,
      table.claimExpiresAtMs
    ),
    index("idx_openMeldRemoteAgent_slack_event_ingress_team_received").on(
      table.slackTeamId,
      desc(table.lastReceivedAtMs)
    ),
    check(
      "openMeldRemoteAgent_slack_event_ingress_state_check",
      sql`"state" in ('queued', 'processing', 'completed', 'failed')`
    ),
    check(
      "openMeldRemoteAgent_slack_event_ingress_attempt_count_check",
      sql`"delivery_attempt_count" >= 0`
    ),
  ]
);

export const openMeldRemoteAgentSlackWorkspaceBindings = sqliteTable(
  "openMeldRemoteAgent_slack_workspace_bindings",
  {
    slackTeamId: text("slack_team_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("openMeldRemoteAgent_slack_workspace_org_unique").on(
      table.organizationId
    ),
    check(
      "openMeldRemoteAgent_slack_workspace_team_non_empty_check",
      sql`length(trim("slack_team_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_workspace_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_workspace_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const openMeldRemoteAgentSlackThreadContextCursors = sqliteTable(
  "openMeldRemoteAgent_slack_thread_context_cursors",
  {
    organizationId: text("organization_id").notNull(),
    slackTeamId: text("slack_team_id").notNull(),
    slackChannelId: text("slack_channel_id").notNull(),
    slackThreadTs: text("slack_thread_ts").notNull(),
    connectionCreatedAtMs: integer("connection_created_at_ms").notNull(),
    syncedThroughTs: text("synced_through_ts").notNull(),
    syncedThroughEpochMicros: integer("synced_through_epoch_micros").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.slackTeamId,
        table.slackChannelId,
        table.slackThreadTs,
        table.connectionCreatedAtMs,
      ],
    }),
    check(
      "openMeldRemoteAgent_slack_thread_context_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_thread_context_team_non_empty_check",
      sql`length(trim("slack_team_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_thread_context_channel_non_empty_check",
      sql`length(trim("slack_channel_id")) > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_thread_context_thread_non_empty_check",
      sql`length(trim("slack_thread_ts")) > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_thread_context_connection_created_nonnegative_check",
      sql`"connection_created_at_ms" >= 0`
    ),
    check(
      "openMeldRemoteAgent_slack_thread_context_synced_ts_non_empty_check",
      sql`length(trim("synced_through_ts")) > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_thread_context_synced_micros_positive_check",
      sql`"synced_through_epoch_micros" > 0`
    ),
    check(
      "openMeldRemoteAgent_slack_thread_context_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackWorkspaceTokens = sqliteTable(
  "slack_workspace_tokens",
  {
    slackTeamId: text("slack_team_id").primaryKey(),
    encryptedBotToken: text("encrypted_bot_token").notNull(),
    botUserId: text("bot_user_id").notNull(),
    grantedBotScopes: text("granted_bot_scopes"),
    installedByUserId: text("installed_by_user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("slack_workspace_tokens_org_unique").on(table.organizationId),
    check(
      "slack_workspace_tokens_team_non_empty_check",
      sql`length(trim("slack_team_id")) > 0`
    ),
    check(
      "slack_workspace_tokens_token_non_empty_check",
      sql`length(trim("encrypted_bot_token")) > 0`
    ),
    check(
      "slack_workspace_tokens_bot_user_non_empty_check",
      sql`length(trim("bot_user_id")) > 0`
    ),
    check(
      "slack_workspace_tokens_scopes_non_empty_check",
      sql`"granted_bot_scopes" IS NULL OR length(trim("granted_bot_scopes")) > 0`
    ),
    check(
      "slack_workspace_tokens_installer_non_empty_check",
      sql`length(trim("installed_by_user_id")) > 0`
    ),
    check(
      "slack_workspace_tokens_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "slack_workspace_tokens_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackChannelIntroductionRuns = sqliteTable(
  "slack_channel_introduction_runs",
  {
    interactionId: text("interaction_id").primaryKey(),
    manifestCreationId: text("manifest_creation_id").notNull(),
    slackTeamId: text("slack_team_id").notNull(),
    organizationId: text("organization_id").notNull(),
    requesterSlackUserId: text("requester_slack_user_id").notNull(),
    dmChannelId: text("dm_channel_id").notNull(),
    organizationInviteUrl: text("organization_invite_url"),
    status: text("status", {
      enum: [
        "ack_pending",
        "ready",
        "failed",
        "outcome_unknown",
        "recovery_notice_pending",
        "recovery_notice_submitting",
        "recovery_notice_delivered",
        "recovery_notice_failed",
        "recovery_notice_outcome_unknown",
      ],
    }).notNull(),
    acknowledgementTs: text("acknowledgement_ts"),
    recoveryNoticeTs: text("recovery_notice_ts"),
    recoveryNoticeAttemptCount: integer("recovery_notice_attempt_count")
      .notNull()
      .default(0),
    failureCode: text("failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("idx_slack_channel_introduction_runs_status_updated").on(
      table.status,
      table.updatedAtMs
    ),
    check(
      "slack_channel_introduction_runs_identity_check",
      sql`length(trim("interaction_id")) > 0
        AND length(trim("manifest_creation_id")) > 0
        AND length(trim("slack_team_id")) > 0
        AND length(trim("organization_id")) > 0
        AND length(trim("requester_slack_user_id")) > 0
        AND length(trim("dm_channel_id")) > 0
        AND ("organization_invite_url" IS NULL OR length(trim("organization_invite_url")) > 0)`
    ),
    check(
      "slack_channel_introduction_runs_status_check",
      sql`"status" in ('ack_pending', 'ready', 'failed', 'outcome_unknown', 'recovery_notice_pending', 'recovery_notice_submitting', 'recovery_notice_delivered', 'recovery_notice_failed', 'recovery_notice_outcome_unknown')`
    ),
    check(
      "slack_channel_introduction_runs_outcome_shape_check",
      sql`(
        "recovery_notice_attempt_count" >= 0
        AND (
          ("status" = 'ack_pending' AND "acknowledgement_ts" IS NULL AND "recovery_notice_ts" IS NULL AND "failure_code" IS NULL)
          OR ("status" = 'ready' AND length(trim("acknowledgement_ts")) > 0 AND "recovery_notice_ts" IS NULL AND "failure_code" IS NULL)
          OR ("status" IN ('failed', 'outcome_unknown') AND "acknowledgement_ts" IS NULL AND "recovery_notice_ts" IS NULL AND length(trim("failure_code")) > 0)
          OR ("status" IN ('recovery_notice_pending', 'recovery_notice_submitting', 'recovery_notice_failed', 'recovery_notice_outcome_unknown') AND "acknowledgement_ts" IS NULL AND "recovery_notice_ts" IS NULL AND length(trim("failure_code")) > 0)
          OR ("status" = 'recovery_notice_delivered' AND "acknowledgement_ts" IS NULL AND length(trim("recovery_notice_ts")) > 0 AND length(trim("failure_code")) > 0)
        )
      )`
    ),
    check(
      "slack_channel_introduction_runs_time_check",
      sql`"created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackChannelIntroductionItems = sqliteTable(
  "slack_channel_introduction_items",
  {
    interactionId: text("interaction_id").notNull(),
    slackChannelId: text("slack_channel_id").notNull(),
    slackChannelName: text("slack_channel_name").notNull(),
    position: integer("position").notNull(),
    botWasChannelMember: integer("bot_was_channel_member", {
      mode: "boolean",
    }).notNull(),
    status: text("status", {
      enum: ["ready", "submitting", "submitted", "failed", "outcome_unknown"],
    }).notNull(),
    claimId: text("claim_id"),
    attemptCount: integer("attempt_count").notNull(),
    failureCode: text("failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.interactionId, table.slackChannelId] }),
    uniqueIndex("slack_channel_introduction_items_position_unique").on(
      table.interactionId,
      table.position
    ),
    index("idx_slack_channel_introduction_items_status_updated").on(
      table.status,
      table.updatedAtMs
    ),
    check(
      "slack_channel_introduction_items_identity_check",
      sql`length(trim("interaction_id")) > 0
        AND length(trim("slack_channel_id")) > 0
        AND length(trim("slack_channel_name")) > 0
        AND "position" >= 0`
    ),
    check(
      "slack_channel_introduction_items_status_check",
      sql`"status" in ('ready', 'submitting', 'submitted', 'failed', 'outcome_unknown')`
    ),
    check(
      "slack_channel_introduction_items_attempt_count_check",
      sql`"attempt_count" >= 0`
    ),
    check(
      "slack_channel_introduction_items_outcome_shape_check",
      sql`(
        ("status" = 'ready' AND "claim_id" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'submitting' AND length(trim("claim_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'submitted' AND "claim_id" IS NULL AND "failure_code" IS NULL)
        OR ("status" IN ('failed', 'outcome_unknown') AND "claim_id" IS NULL AND length(trim("failure_code")) > 0)
      )`
    ),
    check(
      "slack_channel_introduction_items_time_check",
      sql`"created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackInstallationWelcomeDeliveries = sqliteTable(
  "slack_installation_welcome_deliveries",
  {
    slackTeamId: text("slack_team_id").notNull(),
    organizationId: text("organization_id").notNull(),
    recipientSlackUserId: text("recipient_slack_user_id").notNull(),
    connectionCreatedAtMs: integer("connection_created_at_ms").notNull(),
    welcomeVersion: integer("welcome_version").notNull(),
    messageKind: text("message_kind", {
      enum: ["connected", "moved"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "delivered", "failed", "outcome_unknown"],
    }).notNull(),
    claimId: text("claim_id").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    messageTs: text("message_ts"),
    failureCode: text("failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.slackTeamId,
        table.organizationId,
        table.recipientSlackUserId,
        table.connectionCreatedAtMs,
        table.welcomeVersion,
      ],
    }),
    index("idx_slack_installation_welcome_status_updated").on(
      table.status,
      table.updatedAtMs
    ),
    check(
      "slack_installation_welcome_team_non_empty_check",
      sql`length(trim("slack_team_id")) > 0`
    ),
    check(
      "slack_installation_welcome_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "slack_installation_welcome_recipient_non_empty_check",
      sql`length(trim("recipient_slack_user_id")) > 0`
    ),
    check(
      "slack_installation_welcome_connection_created_positive_check",
      sql`"connection_created_at_ms" > 0`
    ),
    check(
      "slack_installation_welcome_version_positive_check",
      sql`"welcome_version" > 0`
    ),
    check(
      "slack_installation_welcome_message_kind_check",
      sql`"message_kind" in ('connected', 'moved')`
    ),
    check(
      "slack_installation_welcome_status_check",
      sql`"status" in ('pending', 'delivered', 'failed', 'outcome_unknown')`
    ),
    check(
      "slack_installation_welcome_claim_non_empty_check",
      sql`length(trim("claim_id")) > 0`
    ),
    check(
      "slack_installation_welcome_attempt_count_positive_check",
      sql`"attempt_count" > 0`
    ),
    check(
      "slack_installation_welcome_outcome_shape_check",
      sql`(
        ("status" = 'pending' AND "message_ts" IS NULL AND "failure_code" IS NULL)
        OR (
          "status" = 'delivered'
          AND length(trim("message_ts")) > 0
          AND "failure_code" IS NULL
        )
        OR (
          "status" in ('failed', 'outcome_unknown')
          AND "message_ts" IS NULL
          AND length(trim("failure_code")) > 0
        )
      )`
    ),
    check(
      "slack_installation_welcome_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackInstallationWelcomePreparations = sqliteTable(
  "slack_installation_welcome_preparations",
  {
    slackTeamId: text("slack_team_id").notNull(),
    organizationId: text("organization_id").notNull(),
    recipientSlackUserId: text("recipient_slack_user_id").notNull(),
    connectionCreatedAtMs: integer("connection_created_at_ms").notNull(),
    welcomeVersion: integer("welcome_version").notNull(),
    messageKind: text("message_kind", {
      enum: ["connected", "moved"],
    }).notNull(),
    installedByUserId: text("installed_by_user_id").notNull(),
    installedByProfileId: text("installed_by_profile_id").notNull(),
    status: text("status", {
      enum: ["queued", "researching", "ready", "completed", "failed"],
    }).notNull(),
    claimId: text("claim_id"),
    researchTaskId: text("research_task_id"),
    failureCode: text("failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.slackTeamId,
        table.organizationId,
        table.recipientSlackUserId,
        table.connectionCreatedAtMs,
        table.welcomeVersion,
      ],
    }),
    uniqueIndex("slack_installation_welcome_preparation_task_unique")
      .on(table.researchTaskId)
      .where(sql`"research_task_id" IS NOT NULL`),
    index("idx_slack_installation_welcome_preparation_status_updated").on(
      table.status,
      table.updatedAtMs
    ),
    check(
      "slack_installation_welcome_preparation_identity_check",
      sql`length(trim("slack_team_id")) > 0
        AND length(trim("organization_id")) > 0
        AND length(trim("recipient_slack_user_id")) > 0
        AND length(trim("installed_by_user_id")) > 0
        AND length(trim("installed_by_profile_id")) > 0`
    ),
    check(
      "slack_installation_welcome_preparation_status_check",
      sql`"status" in ('queued', 'researching', 'ready', 'completed', 'failed')`
    ),
    check(
      "slack_installation_welcome_preparation_shape_check",
      sql`(
        ("status" = 'queued' AND "claim_id" IS NULL AND "research_task_id" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'researching' AND length(trim("claim_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'ready' AND length(trim("claim_id")) > 0 AND length(trim("research_task_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'completed' AND length(trim("claim_id")) > 0 AND length(trim("research_task_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'failed' AND length(trim("claim_id")) > 0 AND length(trim("failure_code")) > 0)
      )`
    ),
    check(
      "slack_installation_welcome_preparation_time_check",
      sql`"connection_created_at_ms" > 0
        AND "welcome_version" > 0
        AND "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackTeammateInvitationDeliveries = sqliteTable(
  "slack_teammate_invitation_deliveries",
  {
    interactionId: text("interaction_id").notNull(),
    slackTeamId: text("slack_team_id").notNull(),
    organizationId: text("organization_id").notNull(),
    actorSlackUserId: text("actor_slack_user_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    targetSlackUserId: text("target_slack_user_id").notNull(),
    targetEmail: text("target_email"),
    targetDisplayName: text("target_display_name").notNull(),
    status: text("status", {
      enum: ["pending", "delivered", "failed", "outcome_unknown"],
    }).notNull(),
    messageTs: text("message_ts"),
    failureCode: text("failure_code"),
    onboardingStatus: text("onboarding_status", {
      enum: [
        "waiting_for_join",
        "starting",
        "researching",
        "completed",
        "failed",
      ],
    }),
    joinedUserId: text("joined_user_id"),
    joinedProfileId: text("joined_profile_id"),
    researchTaskId: text("research_task_id"),
    welcomeMessageTs: text("welcome_message_ts"),
    onboardingFailureCode: text("onboarding_failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.interactionId, table.targetSlackUserId],
    }),
    index("idx_slack_teammate_invitation_status_updated").on(
      table.status,
      table.updatedAtMs
    ),
    check(
      "slack_teammate_invitation_identity_check",
      sql`length(trim("interaction_id")) > 0
        AND length(trim("slack_team_id")) > 0
        AND length(trim("organization_id")) > 0
        AND length(trim("actor_slack_user_id")) > 0
        AND length(trim("actor_user_id")) > 0
        AND length(trim("target_slack_user_id")) > 0
        AND length(trim("target_display_name")) > 0`
    ),
    check(
      "slack_teammate_invitation_status_check",
      sql`"status" in ('pending', 'delivered', 'failed', 'outcome_unknown')`
    ),
    check(
      "slack_teammate_invitation_shape_check",
      sql`(
        ("status" = 'pending' AND "message_ts" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'delivered' AND length(trim("message_ts")) > 0 AND "failure_code" IS NULL)
        OR ("status" IN ('failed', 'outcome_unknown') AND "message_ts" IS NULL AND length(trim("failure_code")) > 0)
      )`
    ),
    check(
      "slack_teammate_invitation_onboarding_shape_check",
      sql`(
        ("status" <> 'delivered'
          AND "onboarding_status" IS NULL
          AND "joined_user_id" IS NULL
          AND "joined_profile_id" IS NULL
          AND "research_task_id" IS NULL
          AND "welcome_message_ts" IS NULL
          AND "onboarding_failure_code" IS NULL)
        OR ("status" = 'delivered' AND (
          ("onboarding_status" = 'waiting_for_join'
            AND "joined_user_id" IS NULL
            AND "joined_profile_id" IS NULL
            AND "research_task_id" IS NULL
            AND "welcome_message_ts" IS NULL
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'starting'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND "research_task_id" IS NULL
            AND "welcome_message_ts" IS NULL
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'researching'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND length(trim("research_task_id")) > 0
            AND "welcome_message_ts" IS NULL
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'completed'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND length(trim("research_task_id")) > 0
            AND length(trim("welcome_message_ts")) > 0
            AND "onboarding_failure_code" IS NULL)
          OR ("onboarding_status" = 'failed'
            AND length(trim("joined_user_id")) > 0
            AND length(trim("joined_profile_id")) > 0
            AND length(trim("onboarding_failure_code")) > 0)
        ))
      )`
    ),
    check(
      "slack_teammate_invitation_time_check",
      sql`"created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackInvitedMemberWelcomeDeliveries = sqliteTable(
  "slack_invited_member_welcome_deliveries",
  {
    interactionId: text("interaction_id").notNull(),
    targetSlackUserId: text("target_slack_user_id").notNull(),
    researchTaskId: text("research_task_id"),
    status: text("status", {
      enum: ["pending", "delivered", "failed", "outcome_unknown"],
    }).notNull(),
    claimId: text("claim_id").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    messageTs: text("message_ts"),
    failureCode: text("failure_code"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.interactionId, table.targetSlackUserId],
    }),
    index("idx_slack_invited_member_welcome_status_updated").on(
      table.status,
      table.updatedAtMs
    ),
    check(
      "slack_invited_member_welcome_identity_check",
      sql`length(trim("interaction_id")) > 0
        AND length(trim("target_slack_user_id")) > 0
        AND ("research_task_id" IS NULL OR length(trim("research_task_id")) > 0)
        AND length(trim("claim_id")) > 0`
    ),
    check(
      "slack_invited_member_welcome_status_check",
      sql`"status" in ('pending', 'delivered', 'failed', 'outcome_unknown')`
    ),
    check(
      "slack_invited_member_welcome_attempt_count_check",
      sql`"attempt_count" > 0`
    ),
    check(
      "slack_invited_member_welcome_outcome_shape_check",
      sql`(
        ("status" = 'pending' AND "message_ts" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'delivered' AND length(trim("message_ts")) > 0 AND "failure_code" IS NULL)
        OR ("status" IN ('failed', 'outcome_unknown') AND "message_ts" IS NULL AND length(trim("failure_code")) > 0)
      )`
    ),
    check(
      "slack_invited_member_welcome_time_check",
      sql`"created_at_ms" > 0 AND "updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const slackOAuthStates = sqliteTable(
  "slack_oauth_states",
  {
    stateDigest: text("state_digest").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    actorProfileId: text("actor_profile_id").notNull(),
    returnPath: text("return_path").notNull(),
    moveFromOrganizationId: text("move_from_organization_id"),
    expiresAtMs: integer("expires_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    index("idx_slack_oauth_states_expires").on(table.expiresAtMs),
    check(
      "slack_oauth_states_digest_non_empty_check",
      sql`length(trim("state_digest")) > 0`
    ),
    check(
      "slack_oauth_states_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "slack_oauth_states_user_non_empty_check",
      sql`length(trim("user_id")) > 0`
    ),
    check(
      "slack_oauth_states_actor_non_empty_check",
      sql`length(trim("actor_profile_id")) > 0`
    ),
    check(
      "slack_oauth_states_return_path_check",
      sql`substr("return_path", 1, 1) = '/'`
    ),
    check(
      "slack_oauth_states_expiry_valid_check",
      sql`"expires_at_ms" > "created_at_ms"`
    ),
  ]
);

export const slackUserIdentityLinks = sqliteTable(
  "slack_user_identity_links",
  {
    organizationId: text("organization_id").notNull(),
    slackTeamId: text("slack_team_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    openmeldUserId: text("openmeld_user_id").notNull(),
    source: text("source", { enum: ["explicit", "email_auto"] }).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("slack_user_identity_links_slack_user_unique").on(
      table.slackTeamId,
      table.slackUserId
    ),
    index("idx_slack_user_identity_links_openmeld_user").on(
      table.organizationId,
      table.openmeldUserId
    ),
    check(
      "slack_user_identity_links_source_check",
      sql`"source" in ('explicit', 'email_auto')`
    ),
    check(
      "slack_user_identity_links_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "slack_user_identity_links_team_non_empty_check",
      sql`length(trim("slack_team_id")) > 0`
    ),
    check(
      "slack_user_identity_links_slack_user_non_empty_check",
      sql`length(trim("slack_user_id")) > 0`
    ),
    check(
      "slack_user_identity_links_openmeld_user_non_empty_check",
      sql`length(trim("openmeld_user_id")) > 0`
    ),
  ]
);

export const slackUserIdentityLinkTokens = sqliteTable(
  "slack_user_identity_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    organizationId: text("organization_id"),
    slackTeamId: text("slack_team_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    slackUserDisplayName: text("slack_user_display_name").notNull(),
    issuedAtMs: integer("issued_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    consumedAtMs: integer("consumed_at_ms"),
    consumeNonce: text("consume_nonce"),
    consumedByUserId: text("consumed_by_user_id"),
    claimedAtMs: integer("claimed_at_ms"),
    claimedByUserId: text("claimed_by_user_id"),
    membershipRequirement: text("membership_requirement", {
      enum: ["allow_enrollment", "current_member"],
    })
      .notNull()
      .default("allow_enrollment"),
    continuationAttempt: integer("continuation_attempt").notNull().default(0),
    deliveryScope: text("delivery_scope"),
    sourceDeliveryId: text("source_delivery_id"),
  },
  (table) => [
    index("idx_slack_user_identity_link_tokens_slack_user").on(
      table.slackTeamId,
      table.slackUserId,
      table.expiresAtMs
    ),
    index("idx_slack_user_identity_link_tokens_expires_at").on(
      table.expiresAtMs
    ),
    check(
      "slack_user_identity_link_tokens_hash_non_empty_check",
      sql`length(trim("token_hash")) > 0`
    ),
    check(
      "slack_user_identity_link_tokens_team_non_empty_check",
      sql`length(trim("slack_team_id")) > 0`
    ),
    check(
      "slack_user_identity_link_tokens_slack_user_non_empty_check",
      sql`length(trim("slack_user_id")) > 0`
    ),
    check(
      "slack_user_identity_link_tokens_display_name_non_empty_check",
      sql`length(trim("slack_user_display_name")) > 0`
    ),
    check(
      "slack_user_identity_link_tokens_expires_after_issued_check",
      sql`"expires_at_ms" > "issued_at_ms"`
    ),
    check(
      "slack_user_identity_link_tokens_consumed_after_issued_check",
      sql`"consumed_at_ms" IS NULL OR "consumed_at_ms" >= "issued_at_ms"`
    ),
    check(
      "slack_user_identity_link_tokens_membership_requirement_check",
      sql`"membership_requirement" in ('allow_enrollment', 'current_member')`
    ),
  ]
);

export const openMeldRemoteAgentOrgGuardrails = sqliteTable(
  "openMeldRemoteAgent_org_guardrails",
  {
    organizationId: text("organization_id").primaryKey(),
    // Legacy Core breaker state. Retained for historical rows only; active
    // delivery/readiness code no longer reads or writes this field.
    breakerStatus: text("breaker_status").notNull().default("ok"),
    // Legacy Core breaker source. Retained for historical rows only; the active
    // operator surface is the runtime kill switch plus organization blocklist.
    breakerSource: text("breaker_source").notNull().default("none"),
    // Legacy Core breaker/reset fields. Historical rows are durable evidence;
    // do not drop or mutate the 0009/0010 migrations.
    restingUntilMs: integer("resting_until_ms"),
    dailyBudgetCents: integer("daily_budget_cents").notNull().default(5000),
    failureCode: text("failure_code"),
    manuallyTrippedBy: text("manually_tripped_by"),
    manuallyTrippedAtMs: integer("manually_tripped_at_ms"),
    // Legacy Core AI Gateway REST Logs projection fields. Usage reporting now
    // lives in the Remote Agent worker's OpenMeld-owned records and Analytics
    // Engine; active Core code no longer reads or writes these fields.
    meteredSpendCents: integer("metered_spend_cents").notNull().default(0),
    meteredWindowStartMs: integer("metered_window_start_ms"),
    lastMeteredAtMs: integer("last_metered_at_ms"),
    firstMeterFailureAtMs: integer("first_meter_failure_at_ms"),
    lastMeterFailureAtMs: integer("last_meter_failure_at_ms"),
    lastMeterFailureCode: text("last_meter_failure_code"),
    meterFailureStreak: integer("meter_failure_streak").notNull().default(0),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("idx_openMeldRemoteAgent_org_guardrails_status").on(
      table.breakerStatus,
      table.restingUntilMs
    ),
    check(
      "openMeldRemoteAgent_org_guardrails_status_check",
      sql`"breaker_status" in ('ok', 'resting_until_tomorrow', 'faulted')`
    ),
    // `breaker_source` intentionally has no table CHECK constraint: it is added
    // by an ALTER TABLE migration (SQLite cannot ALTER-add a table check), and
    // its allowed values ('none' | 'manual' | 'metering') are enforced at the
    // repository write boundary in native-delivery-ledger-repo.ts.
    check(
      "openMeldRemoteAgent_org_guardrails_budget_positive_check",
      sql`"daily_budget_cents" > 0`
    ),
  ]
);

export const openMeldDaemonRuntimeCoordinatorExecutions = sqliteTable(
  "openMeldDaemon_runtime_coordinator_executions",
  {
    runtimeCoordinatorExecutionId: text(
      "runtime_coordinator_execution_id"
    ).primaryKey(),
    modelVersion: text("model_version").notNull(),
    spaceId: text("space_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    targetProfileId: text("target_profile_id").notNull(),
    sourceClientMessageId: text("source_client_message_id"),
    openMeldServiceRuntimeIdSource: text(
      "openmeld_service_runtime_id_source"
    ).notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    bindingId: text("binding_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    status: text("status").notNull(),
    terminalOutcomeJson: text("terminal_outcome_json"),
    attemptId: text("attempt_id"),
    // Legacy diagnostic pointer retained for older RuntimeCoordinator rows only.
    claimLeaseId: text("claim_lease_id"),
    daemonSessionId: text("daemon_session_id"),
    connectionGeneration: integer("connection_generation"),
    leaseEpoch: integer("lease_epoch"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("idx_openMeldDaemon_rce_space_dispatch_target").on(
      table.spaceId,
      table.dispatchId,
      table.targetProfileId
    ),
    index("idx_openMeldDaemon_rce_space_client_target").on(
      table.spaceId,
      table.sourceClientMessageId,
      table.targetProfileId
    ),
    index("idx_openMeldDaemon_rce_runtime_updated").on(
      table.openMeldServiceRuntimeId,
      desc(table.updatedAtMs)
    ),
    index("idx_openMeldDaemon_rce_status_updated").on(
      table.status,
      desc(table.updatedAtMs)
    ),
    index("idx_openMeldDaemon_rce_profile_updated").on(
      table.targetProfileId,
      desc(table.updatedAtMs)
    ),
    index("idx_openMeldDaemon_rce_space_status_updated").on(
      table.spaceId,
      table.status,
      desc(table.updatedAtMs)
    ),
  ]
);

export const openMeldDaemonRuntimeCoordinatorExecutionEvents = sqliteTable(
  "openMeldDaemon_runtime_coordinator_execution_events",
  {
    eventId: text("event_id").primaryKey(),
    runtimeCoordinatorExecutionId: text(
      "runtime_coordinator_execution_id"
    ).notNull(),
    eventType: text("event_type").notNull(),
    statusAfter: text("status_after"),
    reasonCode: text("reason_code"),
    observedAtMs: integer("observed_at_ms").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    index("idx_openMeldDaemon_rce_events_execution_observed").on(
      table.runtimeCoordinatorExecutionId,
      desc(table.observedAtMs)
    ),
    index("idx_openMeldDaemon_rce_events_type_observed").on(
      table.eventType,
      desc(table.observedAtMs)
    ),
    uniqueIndex("openMeldDaemon_rce_events_idempotency_unique").on(
      table.runtimeCoordinatorExecutionId,
      table.eventType,
      table.idempotencyKey
    ),
  ]
);

export const openMeldDaemonRuntimeCoordinatorCreationDiagnostics = sqliteTable(
  "openMeldDaemon_runtime_coordinator_creation_diagnostics",
  {
    diagnosticId: text("diagnostic_id").primaryKey(),
    modelVersion: text("model_version").notNull(),
    spaceId: text("space_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    targetProfileId: text("target_profile_id").notNull(),
    sourceClientMessageId: text("source_client_message_id"),
    creationStatus: text("creation_status").notNull(),
    reasonCode: text("reason_code").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    legacyAttemptId: text("legacy_attempt_id"),
  },
  (table) => [
    index("idx_openMeldDaemon_rce_diag_space_dispatch_target").on(
      table.spaceId,
      table.dispatchId,
      table.targetProfileId
    ),
    index("idx_openMeldDaemon_rce_diag_space_client_target").on(
      table.spaceId,
      table.sourceClientMessageId,
      table.targetProfileId
    ),
    index("idx_openMeldDaemon_rce_diag_reason_observed").on(
      table.reasonCode,
      desc(table.observedAtMs)
    ),
  ]
);

// This relation belongs beside RuntimeCoordinator storage so the Agent Activity
// schema stays acyclic under native ESM initialization and production bundling.
export const agentActivityExecutionLinks = sqliteTable(
  "agent_activity_execution_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    activitySessionId: text("activity_session_id")
      .notNull()
      .references(() => agentActivitySessions.id, { onDelete: "cascade" }),
    runtimeCoordinatorExecutionId: text("runtime_coordinator_execution_id")
      .notNull()
      .references(
        () =>
          openMeldDaemonRuntimeCoordinatorExecutions.runtimeCoordinatorExecutionId,
        { onDelete: "cascade" }
      ),
    deviceId: text("device_id").notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    bindingId: text("binding_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    providerConversationId: text("provider_conversation_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_activity_execution_links_rce_unique").on(
      table.runtimeCoordinatorExecutionId
    ),
    uniqueIndex("agent_activity_execution_links_session_rce_unique").on(
      table.activitySessionId,
      table.runtimeCoordinatorExecutionId
    ),
    index("agent_activity_execution_links_org_created_idx").on(
      table.organizationId,
      desc(table.createdAtMs)
    ),
    index("agent_activity_execution_links_created_idx").on(table.createdAtMs),
  ]
);

export const coreSchema = {
  spaceInvitations,
  organizationJoinRequests,
  inboxCenterAgentReadWatermarks,
  inboxEmailDeliveries,
  inboxItems,
  inboxNotificationPreferences,
  inboxSpaceThreadReadWatermarks,
  agentActivityDailyAggregates,
  agentActivityDailySessionKeys,
  agentActivityDigests,
  agentActivityEvents,
  agentActivityExecutionLinks,
  agentActivitySessionInventory,
  agentActivitySessionInventoryCandidates,
  agentActivitySessionInventoryMemberCleanupRequests,
  agentActivitySessionInventorySources,
  agentActivitySessions,
  agentControllerTaskLifecycleEvents,
  agentControllerTasks,
  agentDelegationChildren,
  agentDelegations,
  agentTaskCompletionSubscriptions,
  agentTaskNeedsAttentionObservations,
  agentTaskTerminalOutcomes,
  centerAgentWakePublications,
  centerAgentProjectOperations,
  centerAgentProjectRemoveConfirmations,
  projects,
  routines,
  routineRuns,
  connectorAppRequests,
  connectorConnections,
  githubAppInstallationStates,
  evalReports,
  openMeldDaemonAgentProfileBindings,
  agentProfileCreationDefaults,
  agentProfileCreationApprovalPreferences,
  agentProfileCreationRequests,
  organizationBindingAuthorizations,
  organizationBindingAuthorizationPreferences,
  organizationDocuments,
  organizationDocumentFolders,
  centerAgentOrganizationDocumentOperations,
  organizationSkills,
  organizationSkillReleases,
  organizationSkillMaintainers,
  organizationSkillActivations,
  centerAgentOrganizationSkillOperations,
  organizationInformationProtectionPolicies,
  organizationMemberActivity,
  organizationOpportunities,
  organizationWorkingLanguagePreferences,
  centerAgentDesignations,
  centerAgentAttentionRequests,
  centerAgentAuditJournal,
  centerAgentConnectorActionOperations,
  centerAgentContextManifestMaterializations,
  centerAgentContextLoadReceipts,
  centerAgentContextManifests,
  centerAgentPublicationOperations,
  centerAgentTasks,
  centerAgentTaskAuthorizedReaders,
  centerAgentTaskAdmissionOutbox,
  centerAgentTaskAttempts,
  centerAgentTaskEvents,
  centerAgentMemoryPolicies,
  centerAgentMemorySubjects,
  centerAgentMemberResearchBatches,
  centerAgentMemberResearchComputerFiles,
  centerAgentMemberResearchTasks,
  openMeldFeedbackReportingPolicies,
  openMeldFeedbackInboxes,
  openMeldFeedbackIssues,
  openMeldDaemonConnectedComputers,
  openMeldDaemonPreHeadFailurePublicationOutbox,
  openMeldDaemonOpsDecisions,
  openMeldDaemonDispatchLedger,
  openMeldDaemonDispatchAttempts,
  openMeldDaemonDlq,
  openMeldDaemonDispatchResultInbox,
  openMeldDaemonDispatchResults,
  openMeldRemoteAgentNativeDeliveryLedger,
  openMeldRemoteAgentWorkLoopAttempts,
  openMeldRemoteAgentDailyAdmissions,
  openMeldRemoteAgentConversationGenerations,
  organizationMessageChannelSetupRequests,
  openMeldRemoteAgentLarkPlatformChannelConnections,
  openMeldRemoteAgentLarkPlatformChannelCredentials,
  openMeldRemoteAgentLarkPlatformContextCursors,
  openMeldRemoteAgentLarkPlatformIdentityLinks,
  openMeldRemoteAgentLarkPlatformRegistrationAttempts,
  openMeldRemoteAgentMessageChannelEventIngress,
  openMeldRemoteAgentMessageChannelIdentityLinkTokens,
  openMeldRemoteAgentSlackEventIngress,
  openMeldRemoteAgentSlackThreadContextCursors,
  openMeldRemoteAgentSlackWorkspaceBindings,
  slackChannelIntroductionItems,
  slackChannelIntroductionRuns,
  slackInstallationWelcomeDeliveries,
  slackInstallationWelcomePreparations,
  slackInvitedMemberWelcomeDeliveries,
  slackTeammateInvitationDeliveries,
  slackOAuthStates,
  slackWorkspaceTokens,
  slackUserIdentityLinks,
  slackUserIdentityLinkTokens,
  openMeldRemoteAgentOrgGuardrails,
  openMeldDaemonRuntimeCoordinatorExecutions,
  openMeldDaemonRuntimeCoordinatorExecutionEvents,
  openMeldDaemonRuntimeCoordinatorCreationDiagnostics,
  openMeldDaemonAgentExecutionReadinessImpacts,
  openMeldDaemonProviderAccessEvidence,
  openMeldDaemonProviderConversationProofs,
  // TODO(2026-05-15): Rename or replace this storage-only legacy table with
  // canonical Local Runtime registry storage.
  openMeldDaemonOwnedDevices,
  openMeldDaemonRuntimeRegistryRecords,
  openMeldDaemonRuntimeAgentControllerReports,
  openMeldDaemonCurrentDeviceTargets,
  openMeldDaemonForgottenDevices,
  openMeldDaemonPrepareSessions,
  openMeldDaemonPrepareSessionTokens,
  openMeldDaemonPrepareSessionEvents,
  spaceAttachments,
  spaceIndexSpaces,
  spaceOwnerMemberReferences,
  spaceIndexMemberships,
  spaceIndexProjectionEvents,
} as const;
