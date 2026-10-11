import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";
import {
  CENTER_AGENT_TURN_DIAGNOSTIC_FAILURE_DETAIL_MAX_CHARS,
  centerAgentAnonymousMemberToolSpeakerSchema,
  messageChannelConversationLocatorSchema,
  REMOTE_AGENT_EXECUTION_CONFIRMATION_PENDING_REASON_CODE,
  REMOTE_AGENT_EXECUTION_CONFIRMATION_WAIT_MS,
  remoteAgentExecutionReconciliationObservationSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
  spaceMessageAttachmentsSchema,
  spaceMessageFileReferencesSchema,
  spaceThreadContextSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAnonymousMemberToolSpeaker,
  CenterAgentTurnDiagnostic,
  MessageChannelConversationLocator,
  RemoteAgentExecutionReconciliationObservation,
  RemoteAgentWorkerSubmitTurnRequest,
  RemoteAgentWorkLoopCheckpoint,
  SpaceMessageAttachment,
  SpaceMessageFileReference,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import {
  type MessageChannelCardHistory,
  parseMessageChannelCardHistory,
} from "./message-channel-card-history";
export type RemoteAgentNativeDeliveryConversationKind =
  | "message_channel"
  | "slack"
  | "space";
export async function readRemoteAgentTaskActivity(input: {
  db: PostgresDatabase;
  organizationId: string;
  authorizedProfileIds: readonly string[];
  sinceMs: number;
}): Promise<Map<string, number>> {
  const activity = new Map<string, number>();
  for (
    let offset = 0;
    offset < input.authorizedProfileIds.length;
    offset += 80
  ) {
    const ids = input.authorizedProfileIds.slice(offset, offset + 80);
    const rows = await input.db.query<{
      profileId: string;
      lastTaskActivityAtMs: number;
    }>({
      text: `
      SELECT profile_id AS "profileId",
        MAX(GREATEST(created_at_ms, COALESCE(accepted_at_ms, 0),
          COALESCE(execution_evidence_at_ms, 0), COALESCE(completed_at_ms, 0))) AS "lastTaskActivityAtMs"
      FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
      WHERE organization_id = $1 AND profile_id = ANY($2::text[])
        AND updated_at_ms >= $3
      GROUP BY profile_id
      HAVING MAX(GREATEST(created_at_ms, COALESCE(accepted_at_ms, 0),
          COALESCE(execution_evidence_at_ms, 0), COALESCE(completed_at_ms, 0))) >= $3
    `,
      values: [input.organizationId, ids, input.sinceMs],
    });
    for (const row of rows.rows) {
      activity.set(row.profileId, row.lastTaskActivityAtMs);
    }
  }
  return activity;
}
export type RemoteAgentFinalPublicationState =
  | "claimed"
  | "outcome_unknown"
  | "published";
export type RemoteAgentFinalPublicationPayload =
  | {
      failureCode: string | null;
      failureDetail: string | null;
      resumeStatus: "accepted" | "retry_observed";
      storageVersion: 1;
      text: string;
    }
  | {
      attachments: SpaceMessageAttachment[];
      failureCode: string | null;
      failureDetail: string | null;
      resumeStatus: "accepted" | "retry_observed";
      storageVersion: 2;
      text: string;
    }
  | {
      attachments: SpaceMessageAttachment[];
      failureCode: string | null;
      failureDetail: string | null;
      files: SpaceMessageFileReference[];
      reviewedFailureExplanation?: true;
      resumeStatus: "accepted" | "retry_observed";
      storageVersion: 3;
      text: string;
    };
export type RemoteAgentProviderProgressState =
  | "create_claimed"
  | "create_outcome_unknown"
  | "created"
  | "send_claimed"
  | "send_outcome_unknown"
  | "sent"
  | "update_claimed"
  | "rollover_finalize_claimed"
  | "rollover_finalized"
  | "rollover_create_claimed"
  | "rollover_created"
  | "rollover_send_claimed"
  | "rollover_send_outcome_unknown"
  | "unavailable"
  | "finalized";
export type RemoteAgentWorkerSubmitRequestState =
  | "absent"
  | "invalid"
  | "valid";
export const REMOTE_AGENT_ROUTINE_TARGET_RECOVERY_BLOCKED_CODE =
  "remote_agent.routine_target_recovery_blocked";
const REMOTE_AGENT_WORKER_SUBMIT_REQUEST_STORAGE_VERSION = 1;
const REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_PAYLOAD_STORAGE_VERSION = 1;
export type RemoteAgentNativeDeliveryStatus =
  // Legacy status retained for durable historical ledger rows from the retired
  // Core breaker/rate-limit guardrail.
  | "guardrail_rejected"
  | "flag_rejected"
  | "worker_unavailable"
  | "submitted"
  | "accepted"
  | "retry_observed"
  | "completed"
  | "callback_rejected"
  | "failed";
export type ActiveRemoteAgentNativeDeliveryWakeProgressEvidence = {
  clientMessageId: string | null;
  dispatchId: string;
  failureReasonCode: string | null;
  phase: "publication_unknown" | "publishing" | "running";
  sourceSignalId: string | null;
  startedAtMs: number | null;
  targetProfileId: string;
  updatedAtMs: number;
};
type ActiveRemoteAgentNativeDeliveryWakeProgressRow = {
  source_client_message_id?: unknown;
  dispatch_id?: unknown;
  failure_reason_code?: unknown;
  phase?: unknown;
  started_at_ms?: unknown;
  target_profile_id?: unknown;
  trigger_message_id?: unknown;
  updated_at_ms?: unknown;
};
function normalizePostgresOptionalText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}
function normalizePostgresTimestampMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}
function parseActiveRemoteAgentNativeDeliveryWakeProgressRow(
  row: ActiveRemoteAgentNativeDeliveryWakeProgressRow
): ActiveRemoteAgentNativeDeliveryWakeProgressEvidence | null {
  const dispatchId = normalizePostgresOptionalText(row.dispatch_id);
  const targetProfileId = normalizePostgresOptionalText(row.target_profile_id);
  const updatedAtMs = normalizePostgresTimestampMs(row.updated_at_ms);
  const phase =
    row.phase === "publication_unknown" ||
    row.phase === "publishing" ||
    row.phase === "running"
      ? row.phase
      : null;
  if (!(dispatchId && targetProfileId && phase && updatedAtMs !== null)) {
    return null;
  }
  return {
    clientMessageId: normalizePostgresOptionalText(
      row.source_client_message_id
    ),
    dispatchId,
    failureReasonCode: normalizePostgresOptionalText(row.failure_reason_code),
    phase,
    sourceSignalId: normalizePostgresOptionalText(row.trigger_message_id),
    startedAtMs: normalizePostgresTimestampMs(row.started_at_ms),
    targetProfileId,
    updatedAtMs,
  };
}
type RemoteAgentControllerNormalizationSnapshot = {
  bindingUpdatedAtMs: number;
  storedAgentControllerRef: string | null;
  storedAgentControllerRefStatus: "canonical" | "malformed" | "stale";
};
export type RemoteAgentNativeDeliveryRecord = {
  executionReconciliation?: RemoteAgentExecutionReconciliationObservation | null;
  anonymousMemberSpeaker: CenterAgentAnonymousMemberToolSpeaker | null;
  deliveryId: string;
  organizationId: string;
  conversationKind: RemoteAgentNativeDeliveryConversationKind;
  spaceId: string;
  profileId: string;
  bindingId: string;
  controllerNormalizationSnapshot: RemoteAgentControllerNormalizationSnapshot | null;
  triggerMessageId: string;
  sourceClientMessageId: string | null;
  triggerText: string | null;
  routineRunId: string | null;
  routineNameSnapshot: string | null;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest | null;
  workerSubmitRequestState: RemoteAgentWorkerSubmitRequestState;
  executionRecoverySubmitRequest: RemoteAgentWorkerSubmitTurnRequest | null;
  dispatchId: string;
  attemptId: string | null;
  idempotencyKey: string;
  submissionId: string | null;
  workerRequestId: string | null;
  status: RemoteAgentNativeDeliveryStatus;
  failureCode: string | null;
  failureDetail: string | null;
  onBehalfOfProfileId: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfDisplayName: string | null;
  threadContext: SpaceThreadContext | null;
  slackTeamId: string | null;
  slackChannelId: string | null;
  slackThreadTs: string | null;
  slackWorkingStatusTurnId: string | null;
  messageChannelLocator: MessageChannelConversationLocator | null;
  providerPublicationIdempotencyKey: string | null;
  providerPublicationResultId: string | null;
  providerProgressState: RemoteAgentProviderProgressState | null;
  providerProgressClaimId: string | null;
  providerProgressClaimedAtMs: number | null;
  providerProgressClaimExpiresAtMs: number | null;
  providerProgressCardId: string | null;
  providerProgressCardHistory?: MessageChannelCardHistory | null;
  providerProgressMessageId: string | null;
  providerProgressPublicationIdempotencyKey: string | null;
  providerProgressSequence: number | null;
  providerProgressPendingSequence: number | null;
  providerProgressSourceOffset: number;
  providerProgressRolloverIndex: number;
  providerProgressPendingSourceOffset: number | null;
  providerProgressPendingTextHash: string | null;
  providerProgressPendingCardId: string | null;
  providerProgressFailureCode: string | null;
  finalPublicationState: RemoteAgentFinalPublicationState | null;
  finalPublicationClaimId: string | null;
  finalPublicationClaimedAtMs: number | null;
  finalPublicationClaimExpiresAtMs: number | null;
  finalPublicationPayload: RemoteAgentFinalPublicationPayload | null;
  finalPublicationAttemptCount: number;
  finalPublicationAmbiguityDeadlineAtMs: number | null;
  finalPublicationNextAttemptAtMs: number | null;
  finalPublicationProviderProgressSequence: number | null;
  publishedSignalId: string | null;
  executionEvidenceAtMs: number | null;
  executionEvidenceSequence: number | null;
  createdAtMs: number;
  updatedAtMs: number;
  submittedAtMs: number | null;
  admissionAttemptCount: number;
  admissionRetryDueAtMs: number | null;
  acceptedAtMs: number | null;
  callbackReceivedAtMs: number | null;
  completedAtMs: number | null;
  deadlineProbeEnqueuedAtMs: number | null;
  acceptedProbeNextDueAtMs: number | null;
  retiredDeadlineFailureCode: string | null;
  retiredDeadlineFailurePublishedSignalId: string | null;
  retiredDeadlineFailureReconciledAtMs: number | null;
};
export type RemoteAgentWorkLoopAttemptRecord = {
  attempt: number;
  checkpoint: RemoteAgentWorkLoopCheckpoint;
  continuedAtMs: number;
  deliveryId: string;
  idempotencyKey: string;
  nextIdempotencyKey: string;
  submissionId: string;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest;
};
export type ActiveRemoteAgentNativeDeliveryCancellationTarget = {
  conversationId?: string;
  idempotencyKey: string;
  organizationId: string;
  spaceId: string;
  submissionId: string;
};
type RemoteAgentNativeDeliveryRow = {
  anonymous_member_speaker_json: string | null;
  delivery_id: string;
  organization_id: string;
  conversation_kind: string | null;
  space_id: string;
  profile_id: string;
  binding_id: string;
  controller_stored_agent_controller_ref: string | null;
  controller_stored_agent_controller_ref_status: string | null;
  controller_binding_updated_at_ms: number | null;
  trigger_message_id: string;
  source_client_message_id: string | null;
  trigger_text: string | null;
  routine_run_id: string | null;
  routine_name_snapshot: string | null;
  worker_submit_request_json: string | null;
  execution_recovery_submit_request_json: string | null;
  dispatch_id: string;
  attempt_id: string | null;
  idempotency_key: string;
  submission_id: string | null;
  worker_request_id: string | null;
  status: RemoteAgentNativeDeliveryStatus;
  failure_code: string | null;
  failure_detail: string | null;
  on_behalf_of_profile_id: string | null;
  on_behalf_of_user_id: string | null;
  on_behalf_of_display_name: string | null;
  thread_context_json: string | null;
  slack_team_id: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  slack_working_status_turn_id: string | null;
  message_channel_provider: string | null;
  message_channel_connection_id: string | null;
  message_channel_locator_json: string | null;
  provider_publication_idempotency_key: string | null;
  provider_publication_result_id: string | null;
  provider_progress_state: string | null;
  provider_progress_claim_id: string | null;
  provider_progress_claimed_at_ms: number | null;
  provider_progress_claim_expires_at_ms: number | null;
  provider_progress_card_id: string | null;
  provider_progress_card_history_json?: string | null;
  provider_progress_message_id: string | null;
  provider_progress_publication_idempotency_key: string | null;
  provider_progress_sequence: number | null;
  provider_progress_pending_sequence: number | null;
  provider_progress_source_offset: number;
  provider_progress_rollover_index: number;
  provider_progress_pending_source_offset: number | null;
  provider_progress_pending_text_hash: string | null;
  provider_progress_pending_card_id: string | null;
  provider_progress_failure_code: string | null;
  final_publication_state: string | null;
  final_publication_claim_id: string | null;
  final_publication_claimed_at_ms: number | null;
  final_publication_claim_expires_at_ms: number | null;
  final_publication_payload_json: string | null;
  final_publication_attempt_count: number;
  final_publication_ambiguity_deadline_at_ms: number | null;
  final_publication_next_attempt_at_ms: number | null;
  final_publication_provider_progress_sequence: number | null;
  published_signal_id: string | null;
  execution_evidence_at_ms: number | null;
  execution_evidence_sequence: number | null;
  created_at_ms: number;
  updated_at_ms: number;
  submitted_at_ms: number | null;
  admission_attempt_count: number;
  admission_retry_due_at_ms: number | null;
  accepted_at_ms: number | null;
  callback_received_at_ms: number | null;
  completed_at_ms: number | null;
  deadline_probe_enqueued_at_ms: number | null;
  accepted_probe_next_due_at_ms: number | null;
  execution_reconciliation_json?: string | null;
  retired_deadline_failure_code: string | null;
  retired_deadline_failure_published_signal_id: string | null;
  retired_deadline_failure_reconciled_at_ms: number | null;
};
const REMOTE_AGENT_NATIVE_DELIVERY_SELECT = `
  SELECT
    anonymous_member_speaker_json,
    delivery_id,
    organization_id,
    conversation_kind,
    space_id,
    profile_id,
    binding_id,
    controller_stored_agent_controller_ref,
    controller_stored_agent_controller_ref_status,
    controller_binding_updated_at_ms,
    trigger_message_id,
    source_client_message_id,
    trigger_text,
    routine_run_id,
    routine_name_snapshot,
    worker_submit_request_json,
    execution_recovery_submit_request_json,
    dispatch_id,
    attempt_id,
    idempotency_key,
    submission_id,
    worker_request_id,
    status,
    failure_code,
    failure_detail,
    on_behalf_of_profile_id,
    on_behalf_of_user_id,
    on_behalf_of_display_name,
    thread_context_json,
    slack_team_id,
    slack_channel_id,
    slack_thread_ts,
    slack_working_status_turn_id,
    message_channel_provider,
    message_channel_connection_id,
    message_channel_locator_json,
    provider_publication_idempotency_key,
    provider_publication_result_id,
    provider_progress_state,
    provider_progress_claim_id,
    provider_progress_claimed_at_ms,
    provider_progress_claim_expires_at_ms,
    provider_progress_card_id,
    provider_progress_card_history_json,
    provider_progress_message_id,
    provider_progress_publication_idempotency_key,
    provider_progress_sequence,
    provider_progress_pending_sequence,
    provider_progress_source_offset,
    provider_progress_rollover_index,
    provider_progress_pending_source_offset,
    provider_progress_pending_text_hash,
    provider_progress_pending_card_id,
    provider_progress_failure_code,
    final_publication_state,
    final_publication_claim_id,
    final_publication_claimed_at_ms,
    final_publication_claim_expires_at_ms,
    final_publication_payload_json,
    final_publication_attempt_count,
    final_publication_ambiguity_deadline_at_ms,
    final_publication_next_attempt_at_ms,
    final_publication_provider_progress_sequence,
    published_signal_id,
    execution_evidence_at_ms,
    execution_evidence_sequence,
    created_at_ms,
    updated_at_ms,
    submitted_at_ms,
    admission_attempt_count,
    admission_retry_due_at_ms,
    accepted_at_ms,
    callback_received_at_ms,
    completed_at_ms,
    deadline_probe_enqueued_at_ms,
    accepted_probe_next_due_at_ms,
    execution_reconciliation_json,
    retired_deadline_failure_code,
    retired_deadline_failure_published_signal_id,
    retired_deadline_failure_reconciled_at_ms
  FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
`;
/** Deletion must also wait for submission, Routines, and uncertain publication. */
export async function hasUnsettledSpaceNativeDelivery(input: {
  db: Pick<PostgresDatabase, "query">;
  spaceId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `SELECT 1 FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
      WHERE conversation_kind = 'space' AND space_id = $1
        AND (status IN ('submitted', 'accepted', 'retry_observed')
          OR final_publication_state IN ('claimed', 'outcome_unknown'))
      LIMIT 1`,
    values: [input.spaceId],
  });
  return result.rows.length > 0;
}

export async function listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace(input: {
  nowMs?: number;
  db: PostgresDatabase;
  limit?: number;
  sourceDispatchIds?: readonly string[];
  sourceProfileId?: string;
  spaceId: string;
  targetProfileId?: string;
}): Promise<ActiveRemoteAgentNativeDeliveryWakeProgressEvidence[]> {
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 25)));
  const targetProfileId = input.targetProfileId?.trim() || null;
  const sourceDispatchIds = input.sourceDispatchIds?.filter(
    (dispatchId) => dispatchId.trim().length > 0
  );
  const sourceProfileId = input.sourceProfileId?.trim() || null;
  if (!sourceProfileId && sourceDispatchIds && sourceDispatchIds.length === 0) {
    return [];
  }
  const bindings = [
    (input.nowMs ?? Date.now()) - REMOTE_AGENT_EXECUTION_CONFIRMATION_WAIT_MS,
    (input.nowMs ?? Date.now()) - REMOTE_AGENT_EXECUTION_CONFIRMATION_WAIT_MS,
    input.spaceId,
    limit,
    targetProfileId,
    sourceProfileId,
    sourceDispatchIds ?? (sourceProfileId ? [] : null),
  ];
  const rows =
    await input.db.query<ActiveRemoteAgentNativeDeliveryWakeProgressRow>({
      text: `
        SELECT
          deliveries.source_client_message_id,
          deliveries.dispatch_id,
          CASE
            WHEN deliveries.final_publication_state = 'outcome_unknown'
              THEN 'publication_unknown'
            WHEN deliveries.callback_received_at_ms IS NOT NULL
              OR deliveries.final_publication_state IS NOT NULL
              THEN 'publishing'
            ELSE 'running'
          END AS phase,
          CASE
            WHEN deliveries.final_publication_state = 'outcome_unknown'
              THEN 'remote_agent.callback_publication_outcome_unknown'
            WHEN deliveries.execution_reconciliation_json IS NOT NULL
              AND (deliveries.execution_evidence_at_ms IS NULL OR deliveries.execution_evidence_at_ms <= $1)
              AND (((deliveries.execution_reconciliation_json)::jsonb #>> '{retryState}') = 'paused'
                OR ((deliveries.execution_reconciliation_json)::jsonb #>> '{firstUnavailableAtMs}')::bigint <= $2)
              THEN '${REMOTE_AGENT_EXECUTION_CONFIRMATION_PENDING_REASON_CODE}'
            ELSE NULL
          END AS failure_reason_code,
          deliveries.trigger_message_id,
          COALESCE(
            deliveries.accepted_at_ms,
            deliveries.submitted_at_ms,
            deliveries.created_at_ms
          ) AS started_at_ms,
          deliveries.profile_id AS target_profile_id,
          deliveries.updated_at_ms
        FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" AS deliveries
        WHERE deliveries.conversation_kind = 'space'
          AND deliveries.space_id = $3
          AND deliveries.routine_run_id IS NULL
          AND deliveries.status IN ('accepted', 'retry_observed')
          AND ($5::text IS NULL OR deliveries.profile_id = $5)
          AND (
            ($6::text IS NULL AND ($7::text[] IS NULL OR deliveries.dispatch_id = ANY($7)))
            OR deliveries.on_behalf_of_profile_id = $6
            OR (deliveries.on_behalf_of_profile_id IS NULL AND deliveries.dispatch_id = ANY($7))
          )
        ORDER BY deliveries.updated_at_ms DESC NULLS LAST, deliveries.delivery_id DESC NULLS LAST
        LIMIT $4
      `,
      values: [...bindings],
    });
  return rows.rows.flatMap((row) => {
    const evidence = parseActiveRemoteAgentNativeDeliveryWakeProgressRow(row);
    return evidence ? [evidence] : [];
  });
}
export async function isLatestRemoteAgentNativeDeliveryActiveForSlackThread(input: {
  channelId: string;
  db: PostgresDatabase;
  organizationId: string;
  teamId: string;
  threadTs: string;
}): Promise<boolean> {
  const row = await input.db
    .query<{
      active: number;
      ambiguous: number;
    }>({
      text: `
        WITH scoped_deliveries AS (
          SELECT
            delivery_id,
            idempotency_key,
            trigger_message_id,
            slack_working_status_turn_id,
            status,
            final_publication_state,
            created_at_ms
          FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          WHERE conversation_kind = 'slack'
            AND organization_id = $1
            AND slack_team_id = $2
            AND slack_channel_id = $3
            AND slack_thread_ts = $4
        ),
        lineage_candidates AS (
          SELECT
            deliveries.delivery_id,
            shared.slack_working_status_turn_id AS inherited_turn_id
          FROM scoped_deliveries AS deliveries
          INNER JOIN scoped_deliveries AS shared
            ON shared.trigger_message_id = deliveries.trigger_message_id
            AND shared.slack_working_status_turn_id IS NOT NULL
            AND substr(
              deliveries.idempotency_key,
              1,
              length(shared.slack_working_status_turn_id) + 1
            ) = shared.slack_working_status_turn_id || ':'
        ),
        effective_deliveries AS (
          SELECT
            deliveries.delivery_id,
            deliveries.idempotency_key,
            deliveries.trigger_message_id,
            deliveries.status,
            deliveries.final_publication_state,
            deliveries.created_at_ms,
            CASE
              WHEN deliveries.slack_working_status_turn_id IS NOT NULL
                THEN deliveries.slack_working_status_turn_id
              WHEN COUNT(DISTINCT lineage.inherited_turn_id) = 1
                THEN MIN(lineage.inherited_turn_id)
              WHEN COUNT(DISTINCT lineage.inherited_turn_id) = 0
                THEN deliveries.idempotency_key
              ELSE NULL
            END AS effective_turn_id,
            COUNT(DISTINCT lineage.inherited_turn_id) AS inherited_turn_count
          FROM scoped_deliveries AS deliveries
          LEFT JOIN lineage_candidates AS lineage
            ON lineage.delivery_id = deliveries.delivery_id
          GROUP BY
            deliveries.delivery_id,
            deliveries.idempotency_key,
            deliveries.trigger_message_id,
            deliveries.slack_working_status_turn_id,
            deliveries.status,
            deliveries.final_publication_state,
            deliveries.created_at_ms
        ),
        latest_turn AS (
          SELECT trigger_message_id, effective_turn_id
          FROM effective_deliveries
          ORDER BY trigger_message_id DESC NULLS LAST, created_at_ms DESC NULLS LAST, delivery_id DESC NULLS LAST
          LIMIT 1
        )
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM effective_deliveries AS deliveries
          INNER JOIN latest_turn
            ON latest_turn.trigger_message_id = deliveries.trigger_message_id
            AND latest_turn.effective_turn_id = deliveries.effective_turn_id
          WHERE deliveries.status IN ('submitted', 'accepted', 'retry_observed')
            AND deliveries.final_publication_state IS NULL
        ) THEN 1 ELSE 0 END AS active,
        CASE WHEN EXISTS (
          SELECT 1
          FROM effective_deliveries AS deliveries
          INNER JOIN latest_turn
            ON latest_turn.trigger_message_id = deliveries.trigger_message_id
          WHERE deliveries.inherited_turn_count > 1
        ) THEN 1 ELSE 0 END AS ambiguous
      `,
      values: [
        input.organizationId,
        input.teamId,
        input.channelId,
        input.threadTs,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (row?.ambiguous === 1) {
    throw new Error(
      "Slack working-status turn lineage is ambiguous for the latest trigger"
    );
  }
  return row?.active === 1;
}
// Bound each query's result work while using native array parameters.
const ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE = 80;
export type ActiveRemoteAgentNativeDeliveryTargetCount = {
  activeWakeCount: number;
  spaceId: string;
  targetProfileId: string;
};
export async function listActiveRemoteAgentNativeDeliveryTargetsBySpaceIds(input: {
  db: PostgresDatabase;
  freshAfterMs: number;
  spaceIds: readonly string[];
}): Promise<ActiveRemoteAgentNativeDeliveryTargetCount[]> {
  const targets: ActiveRemoteAgentNativeDeliveryTargetCount[] = [];
  for (
    let offset = 0;
    offset < input.spaceIds.length;
    offset += ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE
  ) {
    const chunk = input.spaceIds.slice(
      offset,
      offset + ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE
    );
    const rows = await input.db.query<{
      active_count?: unknown;
      profile_id?: unknown;
      space_id?: unknown;
    }>({
      text: `
          SELECT space_id, profile_id, COUNT(*) AS active_count
          FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          WHERE conversation_kind = 'space'
            AND routine_run_id IS NULL
            AND status IN ('accepted', 'retry_observed')
            AND space_id = ANY($1::text[])
            AND execution_evidence_at_ms >= $2
          GROUP BY space_id, profile_id
        `,
      values: [chunk, input.freshAfterMs],
    });
    for (const row of rows.rows ?? []) {
      const spaceId = typeof row.space_id === "string" ? row.space_id : "";
      const targetProfileId =
        typeof row.profile_id === "string" ? row.profile_id : "";
      const activeCount =
        typeof row.active_count === "number" &&
        Number.isFinite(row.active_count)
          ? Math.trunc(row.active_count)
          : 0;
      if (spaceId.length > 0 && targetProfileId.length > 0 && activeCount > 0) {
        targets.push({
          activeWakeCount: activeCount,
          spaceId,
          targetProfileId,
        });
      }
    }
  }
  return targets;
}
export async function listLinkedSlackNativeDeliveriesNeedingInboxProjection(input: {
  db: PostgresDatabase;
  limit?: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 100)));
  const rows = await input.db.query<RemoteAgentNativeDeliveryRow>({
    text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE conversation_kind = 'slack'
          AND length(trim(coalesce(on_behalf_of_user_id, ''))) > 0
          AND inbox_projection_suppressed_at_ms IS NULL
          AND (
            final_publication_state = 'outcome_unknown'
            OR status IN (
              'completed',
              'failed',
              'flag_rejected',
              'guardrail_rejected',
              'worker_unavailable'
            )
          )
          AND (
            (
              final_publication_state = 'outcome_unknown'
              AND NOT EXISTS (
                SELECT 1
                FROM "openmeld"."inbox_items"
                WHERE inbox_items.organization_id = "openMeldRemoteAgent_native_delivery_ledger".organization_id
                  AND inbox_items.recipient_user_id = "openMeldRemoteAgent_native_delivery_ledger".on_behalf_of_user_id
                  AND inbox_items.source_kind = 'remote_agent_native_delivery'
                  AND inbox_items.source_key = "openMeldRemoteAgent_native_delivery_ledger".delivery_id || ':publication_unknown'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "openmeld"."inbox_items"
                WHERE inbox_items.organization_id = "openMeldRemoteAgent_native_delivery_ledger".organization_id
                  AND inbox_items.recipient_user_id = "openMeldRemoteAgent_native_delivery_ledger".on_behalf_of_user_id
                  AND inbox_items.source_kind = 'remote_agent_native_delivery'
                  AND inbox_items.source_key = "openMeldRemoteAgent_native_delivery_ledger".delivery_id || ':terminal'
              )
            )
            OR (
              coalesce(final_publication_state, '') <> 'outcome_unknown'
              AND (
                NOT EXISTS (
                  SELECT 1
                  FROM "openmeld"."inbox_items"
                  WHERE inbox_items.organization_id = "openMeldRemoteAgent_native_delivery_ledger".organization_id
                    AND inbox_items.recipient_user_id = "openMeldRemoteAgent_native_delivery_ledger".on_behalf_of_user_id
                    AND inbox_items.source_kind = 'remote_agent_native_delivery'
                    AND inbox_items.source_key = "openMeldRemoteAgent_native_delivery_ledger".delivery_id || ':terminal'
                )
                OR EXISTS (
                  SELECT 1
                  FROM "openmeld"."inbox_items"
                  WHERE inbox_items.organization_id = "openMeldRemoteAgent_native_delivery_ledger".organization_id
                    AND inbox_items.recipient_user_id = "openMeldRemoteAgent_native_delivery_ledger".on_behalf_of_user_id
                    AND inbox_items.source_kind = 'remote_agent_native_delivery'
                    AND inbox_items.source_key = "openMeldRemoteAgent_native_delivery_ledger".delivery_id || ':publication_unknown'
                    AND inbox_items.attention = 'action_required'
                    AND inbox_items.resolution_status = 'open'
                )
              )
            )
            OR EXISTS (
              SELECT 1
              FROM "openmeld"."inbox_items"
              WHERE inbox_items.organization_id = "openMeldRemoteAgent_native_delivery_ledger".organization_id
                AND inbox_items.recipient_user_id = "openMeldRemoteAgent_native_delivery_ledger".on_behalf_of_user_id
                AND inbox_items.source_kind = 'remote_agent_native_delivery'
                AND inbox_items.source_key IN (
                  "openMeldRemoteAgent_native_delivery_ledger".delivery_id || ':publication_unknown',
                  "openMeldRemoteAgent_native_delivery_ledger".delivery_id || ':terminal'
                )
                AND inbox_items.source_target_json = $1
            )
          )
        ORDER BY
          inbox_projection_attempted_at_ms ASC NULLS FIRST,
          updated_at_ms ASC NULLS FIRST,
          delivery_id ASC NULLS FIRST
        LIMIT $2
      `,
    values: [JSON.stringify({ kind: "center_agent" }), limit],
  });
  return rows.rows.map(mapNativeDeliveryRow);
}
export async function markLinkedSlackNativeDeliveryInboxProjectionAttempted(input: {
  db: PostgresDatabase;
  deliveryId: string;
  nowMs: number;
}): Promise<void> {
  if (!(Number.isSafeInteger(input.nowMs) && input.nowMs >= 0)) {
    throw new TypeError("nowMs must be a non-negative safe integer");
  }
  if (!input.deliveryId.trim()) {
    throw new TypeError("deliveryId must be a non-empty identifier");
  }
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET inbox_projection_attempted_at_ms = $1
        WHERE delivery_id = $2
          AND conversation_kind = 'slack'
          AND inbox_projection_suppressed_at_ms IS NULL
      `,
    values: [input.nowMs, input.deliveryId],
  });
}
export async function suppressLinkedSlackNativeDeliveryInboxProjectionIfRecipientMissing(input: {
  db: PostgresDatabase;
  deliveryId: string;
  nowMs: number;
  recipientUserId: string;
}): Promise<boolean> {
  if (!(Number.isSafeInteger(input.nowMs) && input.nowMs >= 0)) {
    throw new TypeError("nowMs must be a non-negative safe integer");
  }
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          inbox_projection_suppressed_reason = 'recipient_not_found',
          inbox_projection_suppressed_at_ms = $1
        WHERE delivery_id = $2
          AND conversation_kind = 'slack'
          AND on_behalf_of_user_id = $3
          AND inbox_projection_suppressed_at_ms IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "openmeld"."users"
            WHERE users.id = "openMeldRemoteAgent_native_delivery_ledger".on_behalf_of_user_id
          )
      `,
    values: [input.nowMs, input.deliveryId, input.recipientUserId],
  });
  return Number(result.rowCount ?? 0) > 0;
}
function resolveControllerNormalizationStorage(
  snapshot: RemoteAgentControllerNormalizationSnapshot | null | undefined
): {
  bindingUpdatedAtMs: number | null;
  storedAgentControllerRef: string | null;
  storedAgentControllerRefStatus:
    | RemoteAgentControllerNormalizationSnapshot["storedAgentControllerRefStatus"]
    | null;
} {
  if (!snapshot) {
    return {
      bindingUpdatedAtMs: null,
      storedAgentControllerRef: null,
      storedAgentControllerRefStatus: null,
    };
  }
  return snapshot;
}
function resolveStoredSlackWorkingStatusTurnId(input: {
  conversationKind: RemoteAgentNativeDeliveryConversationKind;
  idempotencyKey: string;
  slackWorkingStatusTurnId?: string | null;
}): string | null {
  if (input.conversationKind !== "slack") {
    if (input.slackWorkingStatusTurnId !== undefined) {
      throw new Error(
        "Slack working-status turn identity requires a Slack delivery"
      );
    }
    return null;
  }
  if (input.slackWorkingStatusTurnId == null) {
    return null;
  }
  const explicitTurnId = input.slackWorkingStatusTurnId?.trim();
  if (input.slackWorkingStatusTurnId !== undefined && !explicitTurnId) {
    throw new Error("Slack working-status turn identity cannot be empty");
  }
  if (!input.idempotencyKey.startsWith(`${explicitTurnId}:`)) {
    throw new Error(
      "Shared Slack working-status turn identity must be the parent of its delivery idempotency key"
    );
  }
  return explicitTurnId ?? null;
}
async function backfillSharedSlackWorkingStatusTurnId(input: {
  db: PostgresDatabase;
  record: RemoteAgentNativeDeliveryRecord;
  slackWorkingStatusTurnId: string;
}): Promise<void> {
  if (
    input.record.conversationKind !== "slack" ||
    input.record.slackTeamId === null ||
    input.record.slackChannelId === null ||
    input.record.slackThreadTs === null
  ) {
    throw new Error(
      "Shared Slack working-status turn identity requires a complete Slack conversation locator"
    );
  }
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET slack_working_status_turn_id = $1
        WHERE conversation_kind = 'slack'
          AND organization_id = $2
          AND slack_team_id = $3
          AND slack_channel_id = $4
          AND slack_thread_ts = $5
          AND trigger_message_id = $6
          AND substr(idempotency_key, 1, length($7) + 1) = $8 || ':'
          AND slack_working_status_turn_id IS NULL
      `,
    values: [
      input.slackWorkingStatusTurnId,
      input.record.organizationId,
      input.record.slackTeamId,
      input.record.slackChannelId,
      input.record.slackThreadTs,
      input.record.triggerMessageId,
      input.slackWorkingStatusTurnId,
      input.slackWorkingStatusTurnId,
    ],
  });
}
export async function upsertRemoteAgentNativeDeliveryRecord(input: {
  db: PostgresDatabase;
  deliveryId?: string;
  nowMs: number;
  organizationId: string;
  conversationKind?: RemoteAgentNativeDeliveryConversationKind;
  spaceId: string;
  profileId: string;
  bindingId: string;
  controllerNormalizationSnapshot?: RemoteAgentControllerNormalizationSnapshot | null;
  triggerMessageId: string;
  sourceClientMessageId?: string | null;
  triggerText?: string | null;
  routineRunId?: string | null;
  routineNameSnapshot?: string | null;
  dispatchId: string;
  attemptId: string | null;
  idempotencyKey: string;
  status: RemoteAgentNativeDeliveryStatus;
  failureCode?: string | null;
  onBehalfOfProfileId?: string | null;
  onBehalfOfUserId?: string | null;
  onBehalfOfDisplayName?: string | null;
  threadContext?: SpaceThreadContext | null;
  slackTeamId?: string | null;
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
  slackWorkingStatusTurnId?: string | null;
  messageChannelLocator?: MessageChannelConversationLocator | null;
  providerPublicationIdempotencyKey?: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const threadContextJson = serializeThreadContext(input.threadContext ?? null);
  const conversationKind = input.conversationKind ?? "space";
  const slackWorkingStatusTurnId = resolveStoredSlackWorkingStatusTurnId({
    conversationKind,
    idempotencyKey: input.idempotencyKey,
    slackWorkingStatusTurnId: input.slackWorkingStatusTurnId,
  });
  const messageChannelStorage = resolveMessageChannelStorage({
    conversationKind,
    locator: input.messageChannelLocator ?? null,
    providerPublicationIdempotencyKey:
      input.providerPublicationIdempotencyKey ?? null,
    slackChannelId: input.slackChannelId ?? null,
    slackTeamId: input.slackTeamId ?? null,
    slackThreadTs: input.slackThreadTs ?? null,
  });
  const controllerNormalizationStorage = resolveControllerNormalizationStorage(
    input.controllerNormalizationSnapshot
  );
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          controller_stored_agent_controller_ref,
          controller_stored_agent_controller_ref_status,
          controller_binding_updated_at_ms,
          trigger_message_id,
          source_client_message_id,
          trigger_text,
          routine_run_id,
          routine_name_snapshot,
          dispatch_id,
          attempt_id,
          idempotency_key,
          status,
          failure_code,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          thread_context_json,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          slack_working_status_turn_id,
          message_channel_provider,
          message_channel_connection_id,
          message_channel_locator_json,
          provider_publication_idempotency_key,
          created_at_ms,
          updated_at_ms,
          submitted_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
        ON CONFLICT(idempotency_key) DO NOTHING
      `,
    values: [
      input.deliveryId ?? crypto.randomUUID(),
      input.organizationId,
      conversationKind,
      input.spaceId,
      input.profileId,
      input.bindingId,
      controllerNormalizationStorage.storedAgentControllerRef,
      controllerNormalizationStorage.storedAgentControllerRefStatus,
      controllerNormalizationStorage.bindingUpdatedAtMs,
      input.triggerMessageId,
      input.sourceClientMessageId ?? null,
      input.triggerText ?? null,
      input.routineRunId ?? null,
      input.routineNameSnapshot ?? null,
      input.dispatchId,
      input.attemptId,
      input.idempotencyKey,
      input.status,
      input.failureCode ?? null,
      input.onBehalfOfProfileId ?? null,
      input.onBehalfOfUserId ?? null,
      input.onBehalfOfDisplayName ?? null,
      threadContextJson,
      input.slackTeamId ?? null,
      input.slackChannelId ?? null,
      input.slackThreadTs ?? null,
      slackWorkingStatusTurnId,
      messageChannelStorage.provider,
      messageChannelStorage.connectionId,
      messageChannelStorage.locatorJson,
      messageChannelStorage.providerPublicationIdempotencyKey,
      input.nowMs,
      input.nowMs,
      resolveRemoteAgentNativeDeliverySubmittedAtMs(input.status, input.nowMs),
    ],
  });
  return await readAndReconcileRemoteAgentNativeDeliveryAdmission({
    admissionInput: input,
    controllerNormalizationStorage,
    conversationKind,
    messageChannelStorage,
    slackWorkingStatusTurnId,
    threadContextJson,
  });
}
async function readAndReconcileRemoteAgentNativeDeliveryAdmission(input: {
  admissionInput: Parameters<typeof upsertRemoteAgentNativeDeliveryRecord>[0];
  controllerNormalizationStorage: ReturnType<
    typeof resolveControllerNormalizationStorage
  >;
  conversationKind: RemoteAgentNativeDeliveryConversationKind;
  messageChannelStorage: ReturnType<typeof resolveMessageChannelStorage>;
  slackWorkingStatusTurnId: string | null;
  threadContextJson: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  let record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.admissionInput.db,
    idempotencyKey: input.admissionInput.idempotencyKey,
  });
  if (!record) {
    throw new Error("Remote Agent native delivery write did not produce a row");
  }
  assertImmutableNativeDeliveryAdmission({
    allowLegacyNullSlackWorkingStatusTurnId:
      input.slackWorkingStatusTurnId !== null,
    controllerNormalizationStorage: input.controllerNormalizationStorage,
    conversationKind: input.conversationKind,
    input: input.admissionInput,
    messageChannelStorage: input.messageChannelStorage,
    record,
    threadContextJson: input.threadContextJson,
  });
  if (input.slackWorkingStatusTurnId === null) {
    return record;
  }
  await backfillSharedSlackWorkingStatusTurnId({
    db: input.admissionInput.db,
    record,
    slackWorkingStatusTurnId: input.slackWorkingStatusTurnId,
  });
  record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.admissionInput.db,
    idempotencyKey: input.admissionInput.idempotencyKey,
  });
  if (!record) {
    throw new Error(
      "Remote Agent native delivery disappeared during Slack turn identity reconciliation"
    );
  }
  assertImmutableNativeDeliveryAdmission({
    controllerNormalizationStorage: input.controllerNormalizationStorage,
    conversationKind: input.conversationKind,
    input: input.admissionInput,
    messageChannelStorage: input.messageChannelStorage,
    record,
    threadContextJson: input.threadContextJson,
  });
  return record;
}
function resolveRemoteAgentNativeDeliverySubmittedAtMs(
  status: RemoteAgentNativeDeliveryStatus,
  nowMs: number
): number | null {
  return status === "submitted" ? nowMs : null;
}
function assertImmutableNativeDeliveryAdmission(input: {
  allowLegacyNullSlackWorkingStatusTurnId?: boolean;
  controllerNormalizationStorage: ReturnType<
    typeof resolveControllerNormalizationStorage
  >;
  conversationKind: RemoteAgentNativeDeliveryConversationKind;
  input: Parameters<typeof upsertRemoteAgentNativeDeliveryRecord>[0];
  messageChannelStorage: ReturnType<typeof resolveMessageChannelStorage>;
  record: RemoteAgentNativeDeliveryRecord;
  threadContextJson: string | null;
}): void {
  const expected = {
    attemptId: input.input.attemptId,
    bindingId: input.input.bindingId,
    controllerNormalizationSnapshot:
      input.controllerNormalizationStorage.storedAgentControllerRefStatus ===
      null
        ? null
        : {
            bindingUpdatedAtMs:
              input.controllerNormalizationStorage.bindingUpdatedAtMs,
            storedAgentControllerRef:
              input.controllerNormalizationStorage.storedAgentControllerRef,
            storedAgentControllerRefStatus:
              input.controllerNormalizationStorage
                .storedAgentControllerRefStatus,
          },
    conversationKind: input.conversationKind,
    dispatchId: input.input.dispatchId,
    messageChannelLocator:
      input.messageChannelStorage.locatorJson === null
        ? null
        : JSON.parse(input.messageChannelStorage.locatorJson),
    onBehalfOfDisplayName: input.input.onBehalfOfDisplayName ?? null,
    onBehalfOfProfileId: input.input.onBehalfOfProfileId ?? null,
    onBehalfOfUserId: input.input.onBehalfOfUserId ?? null,
    organizationId: input.input.organizationId,
    profileId: input.input.profileId,
    providerPublicationIdempotencyKey:
      input.messageChannelStorage.providerPublicationIdempotencyKey,
    routineNameSnapshot: input.input.routineNameSnapshot ?? null,
    routineRunId: input.input.routineRunId ?? null,
    slackChannelId: input.input.slackChannelId ?? null,
    slackTeamId: input.input.slackTeamId ?? null,
    slackThreadTs: input.input.slackThreadTs ?? null,
    slackWorkingStatusTurnId: resolveStoredSlackWorkingStatusTurnId({
      conversationKind: input.conversationKind,
      idempotencyKey: input.input.idempotencyKey,
      slackWorkingStatusTurnId: input.input.slackWorkingStatusTurnId,
    }),
    sourceClientMessageId: input.input.sourceClientMessageId ?? null,
    spaceId: input.input.spaceId,
    threadContext:
      input.threadContextJson === null
        ? null
        : JSON.parse(input.threadContextJson),
    triggerMessageId: input.input.triggerMessageId,
    triggerText: input.input.triggerText ?? null,
  };
  const actual = {
    attemptId: input.record.attemptId,
    bindingId: input.record.bindingId,
    controllerNormalizationSnapshot:
      input.record.controllerNormalizationSnapshot,
    conversationKind: input.record.conversationKind,
    dispatchId: input.record.dispatchId,
    messageChannelLocator:
      input.conversationKind === "message_channel"
        ? input.record.messageChannelLocator
        : null,
    onBehalfOfDisplayName: input.record.onBehalfOfDisplayName,
    onBehalfOfProfileId: input.record.onBehalfOfProfileId,
    onBehalfOfUserId: input.record.onBehalfOfUserId,
    organizationId: input.record.organizationId,
    profileId: input.record.profileId,
    providerPublicationIdempotencyKey:
      input.record.providerPublicationIdempotencyKey,
    routineNameSnapshot: input.record.routineNameSnapshot,
    routineRunId: input.record.routineRunId,
    slackChannelId: input.record.slackChannelId,
    slackTeamId: input.record.slackTeamId,
    slackThreadTs: input.record.slackThreadTs,
    slackWorkingStatusTurnId: input.record.slackWorkingStatusTurnId,
    sourceClientMessageId: input.record.sourceClientMessageId,
    spaceId: input.record.spaceId,
    threadContext: input.record.threadContext,
    triggerMessageId: input.record.triggerMessageId,
    triggerText: input.record.triggerText,
  };
  const mismatchedFields = Object.keys(expected).filter((field) => {
    if (
      field === "slackWorkingStatusTurnId" &&
      input.allowLegacyNullSlackWorkingStatusTurnId === true &&
      actual.slackWorkingStatusTurnId === null &&
      expected.slackWorkingStatusTurnId !== null
    ) {
      return false;
    }
    return (
      stableJson(actual[field as keyof typeof actual]) !==
      stableJson(expected[field as keyof typeof expected])
    );
  });
  if (
    input.input.deliveryId !== undefined &&
    input.record.deliveryId !== input.input.deliveryId
  ) {
    mismatchedFields.unshift("deliveryId");
  }
  if (mismatchedFields.length > 0) {
    throw new Error(
      `Remote Agent native delivery immutable admission identity conflict: ${mismatchedFields.join(", ")}`
    );
  }
}
function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!(value && typeof value === "object")) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  );
}
export async function recordRemoteAgentNativeDeliveryRepresentedMember(input: {
  db: PostgresDatabase;
  displayName: string;
  idempotencyKey: string;
  nowMs: number;
  profileId: string;
  userId: string;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          on_behalf_of_profile_id = $1,
          on_behalf_of_user_id = $2,
          on_behalf_of_display_name = $3,
          updated_at_ms = $4
        WHERE idempotency_key = $5
          AND status = 'submitted'
          AND (
            on_behalf_of_profile_id IS NULL
            OR on_behalf_of_profile_id = $6
          )
          AND (
            on_behalf_of_user_id IS NULL
            OR on_behalf_of_user_id = $7
          )
      `,
    values: [
      input.profileId,
      input.userId,
      input.displayName,
      input.nowMs,
      input.idempotencyKey,
      input.profileId,
      input.userId,
    ],
  });
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  if (
    !record ||
    record.onBehalfOfProfileId !== input.profileId ||
    record.onBehalfOfUserId !== input.userId
  ) {
    throw new Error(
      "Remote Agent native delivery represented member identity drifted"
    );
  }
  return record;
}
export async function handoffRoutineRunNativeDelivery(input: {
  db: PostgresDatabase;
  nextDeliveryId: string;
  organizationId: string;
  previousDeliveryId: string;
  runId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET native_delivery_id = $1
        WHERE id = $2
          AND organization_id = $3
          AND status = 'submitted'
          AND native_delivery_id = $4
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            WHERE delivery_id = $5
              AND organization_id = $6
              AND routine_run_id = $7
              AND status IN ('submitted', 'accepted', 'retry_observed')
          )
      `,
    values: [
      input.nextDeliveryId,
      input.runId,
      input.organizationId,
      input.previousDeliveryId,
      input.nextDeliveryId,
      input.organizationId,
      input.runId,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function clearPreviousRoutineWorkerSubmitRequest(input: {
  db: PostgresDatabase;
  nextDeliveryId: string;
  nowMs: number;
  organizationId: string;
  previousDeliveryId: string;
  runId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          worker_submit_request_json = NULL,
          updated_at_ms = $1
        WHERE delivery_id = $2
          AND organization_id = $3
          AND routine_run_id = $4
          AND status IN ('completed', 'failed')
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routine_runs"
            WHERE id = $5
              AND organization_id = $6
              AND status = 'submitted'
              AND native_delivery_id = $7
          )
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            WHERE delivery_id = $8
              AND organization_id = $9
              AND routine_run_id = $10
              AND worker_submit_request_json IS NOT NULL
          )
      `,
    values: [
      input.nowMs,
      input.previousDeliveryId,
      input.organizationId,
      input.runId,
      input.runId,
      input.organizationId,
      input.nextDeliveryId,
      input.nextDeliveryId,
      input.organizationId,
      input.runId,
    ],
  });
}
export async function persistRemoteAgentWorkerSubmitRequest(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const workerSubmitRequest = remoteAgentWorkerSubmitTurnRequestSchema.parse(
    input.workerSubmitRequest
  );
  const anonymousMemberSpeaker =
    resolveAnonymousMemberSpeaker(workerSubmitRequest);
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          anonymous_member_speaker_json = COALESCE(
            anonymous_member_speaker_json,
            $1
          ),
          worker_submit_request_json = COALESCE(
            worker_submit_request_json,
            $2
          ),
          execution_recovery_submit_request_json = COALESCE(
            execution_recovery_submit_request_json,
            $3
          ),
          updated_at_ms = CASE
            WHEN worker_submit_request_json IS NULL
              OR execution_recovery_submit_request_json IS NULL
            THEN $4
            ELSE updated_at_ms
          END
        WHERE idempotency_key = $5
          AND status = 'submitted'
          AND submission_id IS NULL
      `,
    values: [
      anonymousMemberSpeaker ? JSON.stringify(anonymousMemberSpeaker) : null,
      serializeWorkerSubmitRequest(workerSubmitRequest),
      serializeWorkerSubmitRequest(workerSubmitRequest),
      input.nowMs,
      input.idempotencyKey,
    ],
  });
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  if (
    !(record?.workerSubmitRequest && record.executionRecoverySubmitRequest) ||
    record.workerSubmitRequest.idempotencyKey !== input.idempotencyKey ||
    record.executionRecoverySubmitRequest.idempotencyKey !==
      input.idempotencyKey ||
    record.workerSubmitRequest.dispatchId !== record.dispatchId ||
    record.workerSubmitRequest.organizationId !== record.organizationId ||
    record.workerSubmitRequest.spaceId !== record.spaceId ||
    record.workerSubmitRequest.agentProfileId !== record.profileId ||
    record.workerSubmitRequest.bindingId !== record.bindingId ||
    !sameAnonymousMemberSpeaker(
      record.anonymousMemberSpeaker,
      anonymousMemberSpeaker
    )
  ) {
    throw new Error(
      `Remote Agent native delivery ${input.idempotencyKey} has no valid durable worker request`
    );
  }
  const expectedSummaryOnly =
    workerSubmitRequest.turnEnvelope.trigger.source === "task_continuation" &&
    workerSubmitRequest.turnEnvelope.trigger.summaryOnly === true;
  for (const retained of [
    record.workerSubmitRequest,
    record.executionRecoverySubmitRequest,
  ]) {
    const trigger = retained.turnEnvelope.trigger;
    const summaryOnly =
      trigger.source === "task_continuation" && trigger.summaryOnly === true;
    if (summaryOnly !== expectedSummaryOnly) {
      throw new Error("remote_agent.task_continuation.summary_policy_mismatch");
    }
  }
  return record;
}
/** A short submission lease excludes overlapping initial RPCs, without owning execution truth. */
export async function claimRemoteAgentWorkerSubmission(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  claimId: string;
  nowMs: number;
  expiresAtMs: number;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
    SET worker_submit_claim_id = $1, worker_submit_claim_expires_at_ms = $2
    WHERE idempotency_key = $3 AND status = 'submitted' AND submission_id IS NULL
      AND worker_submit_request_json IS NOT NULL
      AND (worker_submit_claim_id IS NULL OR worker_submit_claim_expires_at_ms <= $4)`,
    values: [
      input.claimId,
      input.expiresAtMs,
      input.idempotencyKey,
      input.nowMs,
    ],
  });
  return result.rowCount === 1;
}
export async function releaseRemoteAgentWorkerSubmission(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  claimId: string;
}): Promise<void> {
  await input.db.query({
    text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
    SET worker_submit_claim_id = NULL, worker_submit_claim_expires_at_ms = NULL
    WHERE idempotency_key = $1 AND worker_submit_claim_id = $2`,
    values: [input.idempotencyKey, input.claimId],
  });
}

export async function readRemoteAgentWorkLoopAttemptByCallbackIdentity(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentWorkLoopAttemptRecord | null> {
  const row = await input.db
    .query<{
      attempt: number;
      checkpoint_reason: string;
      continued_at_ms: number;
      delivery_id: string;
      idempotency_key: string;
      next_idempotency_key: string;
      submission_id: string;
      tool_call_limit: number;
      worker_submit_request_json: string;
    }>({
      text: `
        SELECT
          attempt,
          checkpoint_reason,
          continued_at_ms,
          delivery_id,
          idempotency_key,
          next_idempotency_key,
          submission_id,
          tool_call_limit,
          worker_submit_request_json
        FROM "openmeld"."openMeldRemoteAgent_work_loop_attempts"
        WHERE idempotency_key = $1
          AND submission_id = $2
        LIMIT 1
      `,
      values: [input.idempotencyKey, input.submissionId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    return null;
  }
  const workerSubmitRequest = parseWorkerSubmitRequest(
    row.worker_submit_request_json
  ).request;
  if (
    !workerSubmitRequest ||
    row.checkpoint_reason !== "tool_call_budget_exhausted" ||
    !Number.isSafeInteger(row.attempt) ||
    row.attempt <= 0 ||
    !Number.isSafeInteger(row.tool_call_limit) ||
    row.tool_call_limit <= 0
  ) {
    throw new Error(
      `Remote Agent work-loop attempt ${row.delivery_id}/${row.attempt} is invalid.`
    );
  }
  return {
    attempt: row.attempt,
    checkpoint: {
      reason: "tool_call_budget_exhausted",
      toolCallLimit: row.tool_call_limit,
      v: 1,
    },
    continuedAtMs: row.continued_at_ms,
    deliveryId: row.delivery_id,
    idempotencyKey: row.idempotency_key,
    nextIdempotencyKey: row.next_idempotency_key,
    submissionId: row.submission_id,
    workerSubmitRequest,
  };
}
/** Resolve the original request only through the owner's persisted attempt chain. */
export async function readRemoteAgentWorkLoopOrigin(input: {
  db: PostgresDatabase;
  deliveryId: string;
  idempotencyKey: string;
}): Promise<RemoteAgentWorkerSubmitTurnRequest | null> {
  const row = await input.db
    .query<{
      idempotency_key: string;
      worker_submit_request_json: string;
    }>({
      text: `
        WITH RECURSIVE history AS (
          SELECT attempt, idempotency_key, worker_submit_request_json
          FROM "openmeld"."openMeldRemoteAgent_work_loop_attempts"
          WHERE delivery_id = $1 AND next_idempotency_key = $2
          UNION ALL
          SELECT previous.attempt, previous.idempotency_key,
            previous.worker_submit_request_json
          FROM "openmeld"."openMeldRemoteAgent_work_loop_attempts" AS previous
          JOIN history ON previous.next_idempotency_key = history.idempotency_key
            AND previous.attempt = history.attempt - 1
          WHERE previous.delivery_id = $3
        )
        SELECT idempotency_key, worker_submit_request_json
        FROM history WHERE attempt = 1
      `,
      values: [input.deliveryId, input.idempotencyKey, input.deliveryId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    return null;
  }
  const request = parseWorkerSubmitRequest(
    row.worker_submit_request_json
  ).request;
  if (!request || request.idempotencyKey !== row.idempotency_key) {
    throw new Error("remote_agent.work_loop_origin_invalid");
  }
  return request;
}
export async function countRemoteAgentWorkLoopAttempts(input: {
  db: PostgresDatabase;
  deliveryId: string;
}): Promise<number> {
  const row = await input.db
    .query<{
      attempt_count: number;
    }>({
      text: `
        SELECT COUNT(*) AS attempt_count
        FROM "openmeld"."openMeldRemoteAgent_work_loop_attempts"
        WHERE delivery_id = $1
      `,
      values: [input.deliveryId],
    })
    .then((result) => result.rows[0] ?? null);
  const count = row?.attempt_count ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      `Remote Agent work-loop attempt count for ${input.deliveryId} is invalid.`
    );
  }
  return count;
}
export async function rearmRemoteAgentNativeDeliveryForWorkLoop(input: {
  attempt: number;
  checkpoint: RemoteAgentWorkLoopCheckpoint;
  db: PostgresDatabase;
  delivery: RemoteAgentNativeDeliveryRecord;
  nextIdempotencyKey: string;
  nextWorkerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const previousSubmissionId = input.delivery.submissionId;
  const previousWorkerSubmitRequest =
    input.delivery.workerSubmitRequest ??
    input.delivery.executionRecoverySubmitRequest;
  if (!(previousSubmissionId && previousWorkerSubmitRequest)) {
    throw new Error(
      `Remote Agent native delivery ${input.delivery.deliveryId} has no work-loop submission to continue.`
    );
  }
  const nextWorkerSubmitRequest =
    remoteAgentWorkerSubmitTurnRequestSchema.parse(
      input.nextWorkerSubmitRequest
    );
  if (
    nextWorkerSubmitRequest.dispatchId !== input.delivery.dispatchId ||
    nextWorkerSubmitRequest.idempotencyKey !== input.nextIdempotencyKey ||
    nextWorkerSubmitRequest.organizationId !== input.delivery.organizationId ||
    nextWorkerSubmitRequest.spaceId !== input.delivery.spaceId ||
    nextWorkerSubmitRequest.agentProfileId !== input.delivery.profileId ||
    nextWorkerSubmitRequest.bindingId !== input.delivery.bindingId
  ) {
    throw new Error(
      `Remote Agent work-loop continuation ${input.nextIdempotencyKey} does not match its native delivery.`
    );
  }
  const checkpoint = input.checkpoint;
  const [archiveResult, rearmResult] = await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
          INSERT INTO "openmeld"."openMeldRemoteAgent_work_loop_attempts" (
            delivery_id,
            attempt,
            idempotency_key,
            submission_id,
            worker_submit_request_json,
            checkpoint_reason,
            tool_call_limit,
            next_idempotency_key,
            continued_at_ms
          )
          SELECT
            delivery_id,
            $1,
            idempotency_key,
            submission_id,
            execution_recovery_submit_request_json,
            $2,
            $3,
            $4,
            $5
          FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          WHERE delivery_id = $6
            AND idempotency_key = $7
            AND submission_id = $8
            AND status IN ('accepted', 'retry_observed')
            AND execution_recovery_submit_request_json IS NOT NULL
            AND final_publication_state IS NULL
        `,
          values: [
            input.attempt,
            checkpoint.reason,
            checkpoint.toolCallLimit,
            input.nextIdempotencyKey,
            input.nowMs,
            input.delivery.deliveryId,
            input.delivery.idempotencyKey,
            previousSubmissionId,
          ],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            idempotency_key = $1,
            submission_id = NULL,
            worker_request_id = NULL,
            status = 'submitted',
            failure_code = NULL,
            failure_detail = NULL,
            worker_submit_request_json = $2,
            execution_recovery_submit_request_json = $3,
            provider_progress_state = CASE
              WHEN conversation_kind = 'message_channel'
                AND provider_progress_state = 'sent'
              THEN 'sent'
              ELSE provider_progress_state
            END,
            provider_progress_claim_id = NULL,
            provider_progress_claimed_at_ms = NULL,
            provider_progress_claim_expires_at_ms = NULL,
            provider_progress_publication_idempotency_key = NULL,
            provider_progress_sequence = CASE
              WHEN conversation_kind = 'message_channel' THEN 0
              ELSE provider_progress_sequence
            END,
            provider_progress_pending_sequence = NULL,
            provider_progress_source_offset = CASE
              WHEN conversation_kind = 'message_channel' THEN 0
              ELSE provider_progress_source_offset
            END,
            provider_progress_pending_source_offset = NULL,
            provider_progress_card_history_json = CASE
              WHEN conversation_kind = 'message_channel' THEN
                jsonb_build_object('v', 1, 'firstIndex', provider_progress_rollover_index, 'cards', '[]'::jsonb)::text
              ELSE provider_progress_card_history_json
            END,
            provider_progress_pending_text_hash = NULL,
            provider_progress_pending_card_id = NULL,
            provider_progress_failure_code = NULL,
            execution_evidence_at_ms = NULL,
            execution_evidence_sequence = NULL,
            submitted_at_ms = $4,
            accepted_at_ms = NULL,
            callback_received_at_ms = NULL,
            completed_at_ms = NULL,
            deadline_probe_enqueued_at_ms = NULL,
            accepted_probe_next_due_at_ms = NULL,
            execution_reconciliation_json = NULL,
            updated_at_ms = $5
          WHERE delivery_id = $6
            AND idempotency_key = $7
            AND submission_id = $8
            AND status IN ('accepted', 'retry_observed')
            AND final_publication_state IS NULL
            AND (
              conversation_kind <> 'message_channel'
              OR provider_progress_state IN ('sent', 'unavailable')
            )
        `,
          values: [
            input.nextIdempotencyKey,
            serializeWorkerSubmitRequest(nextWorkerSubmitRequest),
            serializeWorkerSubmitRequest(nextWorkerSubmitRequest),
            input.nowMs,
            input.nowMs,
            input.delivery.deliveryId,
            input.delivery.idempotencyKey,
            previousSubmissionId,
          ],
        }),
      ] as const
  );
  if (
    Number(archiveResult.rowCount ?? 0) !== 1 ||
    Number(rearmResult.rowCount ?? 0) !== 1
  ) {
    throw new Error(
      `Remote Agent native delivery ${input.delivery.deliveryId} could not atomically continue its work loop.`
    );
  }
  const rearmed = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: input.delivery.deliveryId,
  });
  if (
    !rearmed ||
    rearmed.idempotencyKey !== input.nextIdempotencyKey ||
    rearmed.status !== "submitted" ||
    rearmed.submissionId !== null ||
    !rearmed.workerSubmitRequest
  ) {
    throw new Error(
      `Remote Agent native delivery ${input.delivery.deliveryId} lost its continued work loop.`
    );
  }
  return rearmed;
}
export async function replaceRemoteAgentWorkerSubmitRequestForGeneration(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest;
}): Promise<boolean> {
  const serialized = serializeWorkerSubmitRequest(
    remoteAgentWorkerSubmitTurnRequestSchema.parse(input.workerSubmitRequest)
  );
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          worker_submit_request_json = CASE
            WHEN worker_submit_request_json IS NULL THEN NULL
            ELSE $1
          END,
          execution_recovery_submit_request_json = CASE
            WHEN execution_recovery_submit_request_json IS NULL THEN NULL
            ELSE $2
          END,
          updated_at_ms = GREATEST(updated_at_ms, $3)
        WHERE idempotency_key = $4
          AND status = 'submitted'
          AND submission_id IS NULL
          AND (
            worker_submit_request_json IS NOT NULL
            OR execution_recovery_submit_request_json IS NOT NULL
          )
      `,
    values: [serialized, serialized, input.nowMs, input.idempotencyKey],
  });
  return Number(result.rowCount ?? 0) > 0;
}
function assertRoutineWorkerSubmitRequestMatchesClaim(input: {
  bindingId: string;
  organizationId: string;
  profileId: string;
  routineId: string;
  runId: string;
  spaceId: string;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest;
}): void {
  const { workerSubmitRequest: request } = input;
  const trigger = request.turnEnvelope.trigger;
  if (
    request.agentProfileId === input.profileId &&
    request.bindingId === input.bindingId &&
    request.dispatchId === input.runId &&
    request.idempotencyKey === input.runId &&
    request.organizationId === input.organizationId &&
    request.spaceId === input.spaceId &&
    request.triggerMessageId === input.runId &&
    request.turnEnvelope.space.id === input.spaceId &&
    trigger.source === "routine" &&
    trigger.routineId === input.routineId &&
    trigger.runId === input.runId
  ) {
    return;
  }
  throw new Error(
    `Routine Run ${input.runId} worker request does not match its claim authority`
  );
}
export async function claimRemoteAgentRoutineNativeDelivery(input: {
  bindingId: string;
  conversationKind: RemoteAgentNativeDeliveryConversationKind;
  messageChannelLocator?: MessageChannelConversationLocator | null;
  db: PostgresDatabase;
  nowMs: number;
  onBehalfOfDisplayName: string;
  onBehalfOfProfileId: string;
  onBehalfOfUserId: string;
  organizationId: string;
  profileId: string;
  routineId: string;
  routineName: string;
  runId: string;
  slackChannelId: string | null;
  slackTeamId: string | null;
  slackThreadTs: string | null;
  spaceId: string;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest | null;
}): Promise<
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "claimed";
    }
  | {
      delivery: RemoteAgentNativeDeliveryRecord | null;
      status: "lost_race";
    }
> {
  const deliveryId = crypto.randomUUID();
  const messageChannelStorage = resolveMessageChannelStorage({
    conversationKind: input.conversationKind,
    locator: input.messageChannelLocator ?? null,
    providerPublicationIdempotencyKey:
      input.conversationKind === "message_channel" ? deliveryId : null,
    slackChannelId: input.slackChannelId,
    slackTeamId: input.slackTeamId,
    slackThreadTs: input.slackThreadTs,
  });
  const workerSubmitRequest = input.workerSubmitRequest
    ? remoteAgentWorkerSubmitTurnRequestSchema.parse(input.workerSubmitRequest)
    : null;
  if (workerSubmitRequest) {
    assertRoutineWorkerSubmitRequestMatchesClaim({
      bindingId: input.bindingId,
      organizationId: input.organizationId,
      profileId: input.profileId,
      routineId: input.routineId,
      runId: input.runId,
      spaceId: input.spaceId,
      workerSubmitRequest,
    });
  }
  const submitRun = {
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'submitted',
          native_delivery_id = $1
        WHERE id = $2
          AND routine_id = $3
          AND organization_id = $4
          AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot, ((message_channel_destination_json_snapshot)::jsonb #>> '{conversationId}')) = $5
          AND status = 'claimed'
          AND native_delivery_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routines"
            WHERE id = $6
              AND organization_id = $7
              AND (
                status = 'enabled'
                OR (schedule_kind = 'once' AND status = 'completed')
              )
          )
      `,
    values: [
      deliveryId,
      input.runId,
      input.routineId,
      input.organizationId,
      input.spaceId,
      input.routineId,
      input.organizationId,
    ],
  };
  const insertDelivery = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          source_client_message_id,
          trigger_text,
          routine_run_id,
          routine_name_snapshot,
          worker_submit_request_json,
          dispatch_id,
          attempt_id,
          idempotency_key,
          status,
          failure_code,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          thread_context_json,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          message_channel_provider,
          message_channel_connection_id,
          message_channel_locator_json,
          provider_publication_idempotency_key,
          created_at_ms,
          updated_at_ms,
          submitted_at_ms
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10, $11, NULL, $12,
          'submitted', NULL, $13, $14, $15, NULL, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
      `,
    values: [
      deliveryId,
      input.organizationId,
      input.conversationKind,
      input.spaceId,
      input.profileId,
      input.bindingId,
      input.runId,
      input.runId,
      input.routineName,
      workerSubmitRequest
        ? serializeWorkerSubmitRequest(workerSubmitRequest)
        : null,
      input.runId,
      input.runId,
      input.onBehalfOfProfileId,
      input.onBehalfOfUserId,
      input.onBehalfOfDisplayName,
      input.slackTeamId,
      input.slackChannelId,
      input.slackThreadTs,
      messageChannelStorage.provider,
      messageChannelStorage.connectionId,
      messageChannelStorage.locatorJson,
      messageChannelStorage.providerPublicationIdempotencyKey,
      input.nowMs,
      input.nowMs,
      input.nowMs,
    ],
  };
  // The Run transition and delivery ledger share one native transaction.
  const submitted = await input.db.transaction(async (client) => {
    if ((await client.query(submitRun)).rowCount !== 1) {
      return false;
    }
    if ((await client.query(insertDelivery)).rowCount !== 1) {
      throw new Error(
        `Routine Run ${input.runId} and native delivery changed inconsistently`
      );
    }
    return true;
  });
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
  if (!submitted) {
    return { delivery, status: "lost_race" };
  }
  if (!delivery || delivery.routineRunId !== input.runId) {
    throw new Error(
      `Routine Run ${input.runId} did not establish its native delivery`
    );
  }
  return { delivery, status: "claimed" };
}
export async function claimRemoteAgentRoutineAdmissionFailure(input: {
  bindingId: string;
  conversationKind: RemoteAgentNativeDeliveryConversationKind;
  messageChannelLocator?: MessageChannelConversationLocator | null;
  db: PostgresDatabase;
  failureCode: string;
  failureDetail: string;
  ledgerStatus: Extract<
    RemoteAgentNativeDeliveryStatus,
    "failed" | "flag_rejected" | "worker_unavailable"
  >;
  nowMs: number;
  onBehalfOfDisplayName: string;
  onBehalfOfProfileId: string;
  onBehalfOfUserId: string;
  organizationId: string;
  profileId: string;
  routineId: string;
  routineName: string;
  runId: string;
  slackChannelId: string | null;
  slackTeamId: string | null;
  slackThreadTs: string | null;
  spaceId: string;
}): Promise<
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "claimed";
    }
  | {
      delivery: RemoteAgentNativeDeliveryRecord | null;
      status: "lost_race";
    }
> {
  const deliveryId = crypto.randomUUID();
  const messageChannelStorage = resolveMessageChannelStorage({
    conversationKind: input.conversationKind,
    locator: input.messageChannelLocator ?? null,
    providerPublicationIdempotencyKey:
      input.conversationKind === "message_channel" ? deliveryId : null,
    slackChannelId: input.slackChannelId,
    slackTeamId: input.slackTeamId,
    slackThreadTs: input.slackThreadTs,
  });
  const failRun = {
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'failed',
          failure_code = $1,
          failure_detail = $2,
          native_delivery_id = $3,
          finished_at_ms = $4
        WHERE id = $5
          AND routine_id = $6
          AND organization_id = $7
          AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot, ((message_channel_destination_json_snapshot)::jsonb #>> '{conversationId}')) = $8
          AND status = 'claimed'
          AND native_delivery_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routines"
            WHERE id = $9
              AND organization_id = $10
              AND (
                status = 'enabled'
                OR (schedule_kind = 'once' AND status = 'completed')
              )
          )
      `,
    values: [
      input.failureCode,
      input.failureDetail,
      deliveryId,
      input.nowMs,
      input.runId,
      input.routineId,
      input.organizationId,
      input.spaceId,
      input.routineId,
      input.organizationId,
    ],
  };
  const insertDelivery = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          source_client_message_id,
          trigger_text,
          routine_run_id,
          routine_name_snapshot,
          worker_submit_request_json,
          dispatch_id,
          attempt_id,
          idempotency_key,
          status,
          failure_code,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          thread_context_json,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          message_channel_provider,
          message_channel_connection_id,
          message_channel_locator_json,
          provider_publication_idempotency_key,
          created_at_ms,
          updated_at_ms,
          completed_at_ms
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, NULL, $10, NULL, $11, $12,
          $13, $14, $15, $16, NULL, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
      `,
    values: [
      deliveryId,
      input.organizationId,
      input.conversationKind,
      input.spaceId,
      input.profileId,
      input.bindingId,
      input.runId,
      input.runId,
      input.routineName,
      input.runId,
      input.runId,
      input.ledgerStatus,
      input.failureCode,
      input.onBehalfOfProfileId,
      input.onBehalfOfUserId,
      input.onBehalfOfDisplayName,
      input.slackTeamId,
      input.slackChannelId,
      input.slackThreadTs,
      messageChannelStorage.provider,
      messageChannelStorage.connectionId,
      messageChannelStorage.locatorJson,
      messageChannelStorage.providerPublicationIdempotencyKey,
      input.nowMs,
      input.nowMs,
      input.nowMs,
    ],
  };
  const failed = await input.db.transaction(async (client) => {
    if ((await client.query(failRun)).rowCount !== 1) {
      return false;
    }
    if ((await client.query(insertDelivery)).rowCount !== 1) {
      throw new Error(
        `Routine Run ${input.runId} and admission failure changed inconsistently`
      );
    }
    return true;
  });
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
  if (!failed) {
    return { delivery, status: "lost_race" };
  }
  if (!delivery || delivery.routineRunId !== input.runId) {
    throw new Error(
      `Routine Run ${input.runId} did not establish its failed native delivery`
    );
  }
  return { delivery, status: "claimed" };
}
export async function claimRemoteAgentRoutineSubmissionFailure(input: {
  db: PostgresDatabase;
  deliveryId: string;
  failureCode: string;
  failureDetail: string;
  ledgerStatus: Extract<
    RemoteAgentNativeDeliveryStatus,
    "failed" | "flag_rejected" | "worker_unavailable"
  >;
  nowMs: number;
  organizationId: string;
  runId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const failRun = {
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'failed',
          failure_code = $1,
          failure_detail = $2,
          finished_at_ms = $3
        WHERE id = $4
          AND organization_id = $5
          AND native_delivery_id = $6
          AND status = 'submitted'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            WHERE delivery_id = $7
              AND organization_id = $8
              AND routine_run_id = $9
              AND idempotency_key = $10
              AND status = 'submitted'
              AND submission_id IS NULL
          )
      `,
    values: [
      input.failureCode,
      input.failureDetail,
      input.nowMs,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId,
    ],
  };
  const failDelivery = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = $1,
          failure_code = $2,
          worker_submit_request_json = NULL,
          completed_at_ms = COALESCE(completed_at_ms, $3),
          updated_at_ms = $4
        WHERE delivery_id = $5
          AND organization_id = $6
          AND routine_run_id = $7
          AND idempotency_key = $8
          AND status = 'submitted'
          AND submission_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routine_runs"
            WHERE id = $9
              AND organization_id = $10
              AND native_delivery_id = $11
              AND status = 'failed'
              AND failure_code = $12
          )
      `,
    values: [
      input.ledgerStatus,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.failureCode,
    ],
  };
  await input.db.transaction(
    async (client) =>
      [await client.query(failRun), await client.query(failDelivery)] as const
  );
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
  if (
    delivery?.deliveryId === input.deliveryId &&
    delivery.routineRunId === input.runId &&
    delivery.status === input.ledgerStatus &&
    delivery.failureCode === input.failureCode
  ) {
    return delivery;
  }
  return null;
}
export async function skipRemoteAgentRoutineSubmissionRecovery(input: {
  db: PostgresDatabase;
  deliveryId: string;
  failureCode: string;
  failureDetail: string;
  nowMs: number;
  organizationId: string;
  runId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const skipRun = {
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'skipped',
          failure_code = $1,
          failure_detail = $2,
          finished_at_ms = $3
        WHERE id = $4
          AND organization_id = $5
          AND native_delivery_id = $6
          AND status = 'submitted'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            WHERE delivery_id = $7
              AND organization_id = $8
              AND routine_run_id = $9
              AND idempotency_key = $10
              AND status = 'submitted'
              AND submission_id IS NULL
          )
      `,
    values: [
      input.failureCode,
      input.failureDetail,
      input.nowMs,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId,
    ],
  };
  const closeDelivery = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'failed',
          failure_code = $1,
          worker_submit_request_json = NULL,
          completed_at_ms = COALESCE(completed_at_ms, $2),
          updated_at_ms = $3
        WHERE delivery_id = $4
          AND organization_id = $5
          AND routine_run_id = $6
          AND idempotency_key = $7
          AND status = 'submitted'
          AND submission_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routine_runs"
            WHERE id = $8
              AND organization_id = $9
              AND native_delivery_id = $10
              AND status = 'skipped'
              AND failure_code = $11
          )
      `,
    values: [
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.failureCode,
    ],
  };
  await input.db.transaction(
    async (client) =>
      [await client.query(skipRun), await client.query(closeDelivery)] as const
  );
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
  if (
    delivery?.deliveryId === input.deliveryId &&
    delivery.routineRunId === input.runId &&
    delivery.status === "failed" &&
    delivery.failureCode === input.failureCode
  ) {
    return delivery;
  }
  return null;
}
export async function reconcileRemoteAgentRoutineSubmissionWithTerminalRun(input: {
  db: PostgresDatabase;
  deliveryId: string;
  failureCode: string | null;
  ledgerStatus: Extract<
    RemoteAgentNativeDeliveryStatus,
    "completed" | "failed"
  >;
  nowMs: number;
  organizationId: string;
  publishedSignalId: string | null;
  runId: string;
  runStatus: "completed" | "skipped";
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = $1,
          failure_code = $2,
          published_signal_id = $3,
          worker_submit_request_json = NULL,
          completed_at_ms = COALESCE(completed_at_ms, $4),
          updated_at_ms = $5
        WHERE delivery_id = $6
          AND organization_id = $7
          AND routine_run_id = $8
          AND idempotency_key = $9
          AND status = 'submitted'
          AND submission_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routine_runs"
            WHERE id = $10
              AND organization_id = $11
              AND native_delivery_id = $12
              AND status = $13
          )
      `,
    values: [
      input.ledgerStatus,
      input.failureCode,
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.runStatus,
    ],
  });
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
}
export async function markRemoteAgentNativeDeliveryAck(input: {
  db: PostgresDatabase;
  nowMs: number;
  idempotencyKey: string;
  submissionId: string;
  workerRequestId?: string | null;
  accepted: boolean;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          submission_id = COALESCE(submission_id, $1),
          worker_request_id = COALESCE(worker_request_id, $2),
          status = CASE
            WHEN status = 'accepted' THEN status
            ELSE $3
          END,
          worker_submit_request_json = CASE
            WHEN routine_run_id IS NOT NULL
              THEN worker_submit_request_json
            ELSE NULL
          END,
          accepted_at_ms = COALESCE(accepted_at_ms, $4),
          admission_retry_due_at_ms = NULL,
          execution_evidence_at_ms = COALESCE(execution_evidence_at_ms, $5),
          updated_at_ms = $6
        WHERE idempotency_key = $7
          AND status = 'submitted'
          AND (submission_id IS NULL OR submission_id = $8)
      `,
    values: [
      input.submissionId,
      input.workerRequestId ?? null,
      input.accepted ? "accepted" : "retry_observed",
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
    ],
  });
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  if (!record) {
    throw new Error("Remote Agent native delivery ACK update lost its row");
  }
  return record;
}
export async function recordRemoteAgentNativeDeliveryExecutionProgress(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  sequence: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          execution_evidence_at_ms = GREATEST(
            COALESCE(execution_evidence_at_ms, 0),
            $1
          ),
          execution_evidence_sequence = $2,
          updated_at_ms = GREATEST(updated_at_ms, $3)
        WHERE idempotency_key = $4
          AND submission_id = $5
          AND status IN ('accepted', 'retry_observed')
          AND COALESCE(execution_evidence_sequence, 0) < $6
      `,
    values: [
      input.nowMs,
      input.sequence,
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
      input.sequence,
    ],
  });
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function markRemoteAgentNativeDeliveryDeadlineProbeEnqueued(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          deadline_probe_enqueued_at_ms = COALESCE(
            deadline_probe_enqueued_at_ms,
            $1
          ),
          updated_at_ms = $2
        WHERE idempotency_key = $3
          AND submission_id = $4
          AND status IN ('submitted', 'accepted', 'retry_observed')
      `,
    values: [
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
    ],
  });
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function markRemoteAgentAcceptedDeliveryProbeScheduled(input: {
  db: PostgresDatabase;
  expectedCurrentDueAtMs?: number;
  idempotencyKey: string;
  nextDueAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const expectedLeaseClause =
    input.expectedCurrentDueAtMs === undefined
      ? ""
      : "AND accepted_probe_next_due_at_ms = $6";
  const statement = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          accepted_probe_next_due_at_ms = $1,
          deadline_probe_enqueued_at_ms = COALESCE(
            deadline_probe_enqueued_at_ms,
            $2
          ),
          updated_at_ms = GREATEST(updated_at_ms, $3)
        WHERE idempotency_key = $4
          AND submission_id = $5
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          ${expectedLeaseClause}
      `,
    values: [],
  };
  const bindings = [
    input.nextDueAtMs,
    input.nowMs,
    input.nowMs,
    input.idempotencyKey,
    input.submissionId,
    ...(input.expectedCurrentDueAtMs === undefined
      ? []
      : [input.expectedCurrentDueAtMs]),
  ];
  await input.db.query({
    ...statement,
    values: [...bindings],
  });
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
function parseExecutionReconciliation(
  value: string | null | undefined
): RemoteAgentExecutionReconciliationObservation | null {
  if (value == null) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new Error(
      "remote_agent.execution_reconciliation_observation_invalid"
    );
  }
  const parsed =
    remoteAgentExecutionReconciliationObservationSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      "remote_agent.execution_reconciliation_observation_invalid"
    );
  }
  return parsed.data;
}
/** Writes a query observation under the existing exact probe lease. */
export async function recordRemoteAgentExecutionReconciliation(input: {
  db: PostgresDatabase;
  delivery: RemoteAgentNativeDeliveryRecord;
  processingLeaseDueAtMs: number;
  observation: RemoteAgentExecutionReconciliationObservation | null;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
    SET execution_reconciliation_json = $1, updated_at_ms = GREATEST(updated_at_ms, $2)
    WHERE idempotency_key = $3 AND submission_id = $4
      AND status IN ('accepted', 'retry_observed') AND final_publication_state IS NULL
      AND accepted_probe_next_due_at_ms = $5`,
    values: [
      input.observation
        ? JSON.stringify(
            remoteAgentExecutionReconciliationObservationSchema.parse(
              input.observation
            )
          )
        : null,
      input.nowMs,
      input.delivery.idempotencyKey,
      input.delivery.submissionId,
      input.processingLeaseDueAtMs,
    ],
  });
}
export async function claimRemoteAgentAcceptedDeliveryProbeSchedule(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  leaseDueAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<{
  claimed: boolean;
  delivery: RemoteAgentNativeDeliveryRecord | null;
}> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          accepted_probe_next_due_at_ms = $1,
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE idempotency_key = $3
          AND submission_id = $4
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          AND COALESCE(((execution_reconciliation_json)::jsonb #>> '{retryState}'), '') != 'paused'
          AND (
            accepted_probe_next_due_at_ms IS NULL
            OR accepted_probe_next_due_at_ms <= $5
          )
      `,
    values: [
      input.leaseDueAtMs,
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
      input.nowMs,
    ],
  });
  return {
    claimed: Number(result.rowCount ?? 0) === 1,
    delivery: await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: input.db,
      idempotencyKey: input.idempotencyKey,
    }),
  };
}
export async function releaseRemoteAgentAcceptedDeliveryProbeSchedule(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  leaseDueAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          accepted_probe_next_due_at_ms = NULL,
          updated_at_ms = GREATEST(updated_at_ms, $1)
        WHERE idempotency_key = $2
          AND submission_id = $3
          AND status IN ('accepted', 'retry_observed')
          AND accepted_probe_next_due_at_ms = $4
      `,
    values: [
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
      input.leaseDueAtMs,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function listRemoteAgentNativeDeliveriesMissingAcceptedProbe(input: {
  db: PostgresDatabase;
  limit?: number;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
  const result = await input.db.query<{
    idempotency_key: string;
  }>({
    text: `
        SELECT idempotency_key
        FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        WHERE status IN ('accepted', 'retry_observed')
          AND submission_id IS NOT NULL
          AND final_publication_state IS NULL
          AND COALESCE(((execution_reconciliation_json)::jsonb #>> '{retryState}'), '') <> 'paused'
          AND (
            accepted_probe_next_due_at_ms IS NULL
            OR accepted_probe_next_due_at_ms <= $1
          )
        ORDER BY updated_at_ms ASC NULLS FIRST, delivery_id ASC NULLS FIRST
        LIMIT $2
      `,
    values: [input.nowMs, limit],
  });
  const deliveries = await Promise.all(
    (result.rows ?? []).map(
      async ({ idempotency_key: idempotencyKey }) =>
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: input.db,
          idempotencyKey,
        })
    )
  );
  return deliveries.filter(
    (delivery): delivery is RemoteAgentNativeDeliveryRecord => delivery !== null
  );
}
export async function listRecoverableRemoteAgentRoutineDeliveries(input: {
  ambiguityCutoffMs: number;
  cutoffMs: number;
  db: PostgresDatabase;
  limit: number;
  replayWindowStartMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const result = await input.db.query<{
    idempotency_key: string;
  }>({
    text: `
        SELECT idempotency_key
        FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        WHERE routine_run_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routine_runs"
            WHERE routine_runs.id = "openMeldRemoteAgent_native_delivery_ledger".routine_run_id
              AND routine_runs.organization_id = "openMeldRemoteAgent_native_delivery_ledger".organization_id
              AND COALESCE(routine_runs.execution_engine, 'legacy') = 'legacy'
          )
          AND status IN ('submitted', 'accepted', 'retry_observed')
          AND COALESCE(failure_code, '') <> $1
          AND submission_id IS NULL
          AND worker_submit_request_json IS NOT NULL
          AND (
            (
              COALESCE(submitted_at_ms, created_at_ms) >= $2
              AND updated_at_ms <= $3
            )
            OR (
              COALESCE(submitted_at_ms, created_at_ms) < $4
              AND updated_at_ms <= $5
            )
          )
        ORDER BY updated_at_ms ASC NULLS FIRST, delivery_id ASC NULLS FIRST
        LIMIT $6
      `,
    values: [
      REMOTE_AGENT_ROUTINE_TARGET_RECOVERY_BLOCKED_CODE,
      input.replayWindowStartMs,
      input.cutoffMs,
      input.replayWindowStartMs,
      input.ambiguityCutoffMs,
      input.limit,
    ],
  });
  const records = await Promise.all(
    (result.rows ?? []).map(
      async (row) =>
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: input.db,
          idempotencyKey: row.idempotency_key,
        })
    )
  );
  return records.filter(
    (record): record is RemoteAgentNativeDeliveryRecord => record !== null
  );
}
export async function blockRemoteAgentRoutineRecoveryForTargetMismatch(input: {
  db: PostgresDatabase;
  deliveryId: string;
  expectedUpdatedAtMs: number;
  nowMs: number;
  organizationId: string;
  runId: string;
  runTargetSpaceId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          failure_code = $1,
          updated_at_ms = $2
        WHERE delivery_id = $3
          AND organization_id = $4
          AND routine_run_id = $5
          AND idempotency_key = $6
          AND status IN ('submitted', 'accepted', 'retry_observed')
          AND updated_at_ms = $7
          AND space_id <> $8
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routine_runs"
            WHERE id = $9
              AND organization_id = $10
              AND native_delivery_id = $11
              AND status = 'submitted'
              AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot, ((message_channel_destination_json_snapshot)::jsonb #>> '{conversationId}')) = $12
          )
      `,
    values: [
      REMOTE_AGENT_ROUTINE_TARGET_RECOVERY_BLOCKED_CODE,
      input.nowMs,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId,
      input.expectedUpdatedAtMs,
      input.runTargetSpaceId,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.runTargetSpaceId,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
}
export async function claimRemoteAgentRoutineSubmissionRecoveryAttempt(input: {
  db: PostgresDatabase;
  deliveryId: string;
  expectedUpdatedAtMs: number;
  nowMs: number;
  organizationId: string;
  runId: string;
  runTargetSpaceId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET updated_at_ms = $1
        WHERE delivery_id = $2
          AND organization_id = $3
          AND routine_run_id = $4
          AND idempotency_key = $5
          AND status = 'submitted'
          AND submission_id IS NULL
          AND worker_submit_request_json IS NOT NULL
          AND updated_at_ms = $6
          AND space_id = $7
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."routine_runs"
            WHERE id = $8
              AND organization_id = $9
              AND native_delivery_id = $10
              AND status = 'submitted'
              AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot, ((message_channel_destination_json_snapshot)::jsonb #>> '{conversationId}')) = $11
          )
      `,
    values: [
      input.nowMs,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId,
      input.expectedUpdatedAtMs,
      input.runTargetSpaceId,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.runTargetSpaceId,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    return null;
  }
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
  if (
    delivery?.deliveryId === input.deliveryId &&
    delivery.routineRunId === input.runId &&
    delivery.status === "submitted" &&
    delivery.submissionId === null &&
    delivery.workerSubmitRequest !== null &&
    delivery.spaceId === input.runTargetSpaceId &&
    delivery.updatedAtMs === input.nowMs
  ) {
    return delivery;
  }
  return null;
}
export async function markRemoteAgentNativeDeliveryFailure(input: {
  db: PostgresDatabase;
  failureDetail?: string;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  status: Extract<
    RemoteAgentNativeDeliveryStatus,
    "failed" | "worker_unavailable" | "flag_rejected"
  >;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN status
            ELSE $1
          END,
          failure_code = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN failure_code
            ELSE $2
          END,
          failure_detail = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN failure_detail
            ELSE COALESCE(failure_detail, $3)
          END,
          worker_submit_request_json = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN worker_submit_request_json
            ELSE NULL
          END,
          updated_at_ms = $4
        WHERE idempotency_key = $5
      `,
    values: [
      input.status,
      input.failureCode,
      input.failureDetail ?? null,
      input.nowMs,
      input.idempotencyKey,
    ],
  });
}
export async function markRemoteAgentPreAdmissionFailurePublished(input: {
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          published_signal_id = $1,
          completed_at_ms = COALESCE(completed_at_ms, $2),
          updated_at_ms = $3
        WHERE idempotency_key = $4
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'flag_rejected', 'worker_unavailable')
          AND failure_code = $5
          AND final_publication_state IS NULL
          AND published_signal_id IS NULL
      `,
    values: [
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function clearRemoteAgentNativeDeliveryTriggerTextForMember(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          trigger_text = NULL,
          execution_recovery_submit_request_json = NULL
        WHERE organization_id = $1
          AND on_behalf_of_user_id = $2
          AND (
            trigger_text IS NOT NULL
            OR execution_recovery_submit_request_json IS NOT NULL
          )
      `,
    values: [input.organizationId, input.userId],
  });
}
export async function clearRemoteAgentNativeDeliveryTriggerTextForOrganization(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          trigger_text = NULL,
          worker_submit_request_json = NULL,
          execution_recovery_submit_request_json = NULL
        WHERE organization_id = $1
          AND (
            trigger_text IS NOT NULL
            OR worker_submit_request_json IS NOT NULL
            OR execution_recovery_submit_request_json IS NOT NULL
          )
      `,
    values: [input.organizationId],
  });
}
export async function readRemoteAgentNativeDeliveryByIdempotencyKey(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .query<RemoteAgentNativeDeliveryRow>({
      text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      values: [input.idempotencyKey],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapNativeDeliveryRow(row) : null;
}
export async function readRemoteAgentNativeDeliveryBySubmissionId(input: {
  db: PostgresDatabase;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .query<RemoteAgentNativeDeliveryRow>({
      text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE submission_id = $1
        LIMIT 1
      `,
      values: [input.submissionId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapNativeDeliveryRow(row) : null;
}
export function projectRemoteAgentNativeDeliveryTurnDiagnostic(
  delivery: RemoteAgentNativeDeliveryRecord,
  currentDelivery: RemoteAgentNativeDeliveryRecord = delivery
): CenterAgentTurnDiagnostic {
  const failureDetail = delivery.failureDetail?.trim() || null;
  const failureDetailTruncated =
    failureDetail !== null &&
    failureDetail.length >
      CENTER_AGENT_TURN_DIAGNOSTIC_FAILURE_DETAIL_MAX_CHARS;
  return {
    acceptedAtMs: delivery.acceptedAtMs,
    callbackReceivedAtMs: delivery.callbackReceivedAtMs,
    completedAtMs: delivery.completedAtMs,
    conversationSource: projectRemoteAgentNativeDeliveryConversationSource({
      currentDelivery,
      delivery,
    }),
    createdAtMs: delivery.createdAtMs,
    deliveryId: delivery.deliveryId,
    dispatchId: delivery.dispatchId,
    failureCode: delivery.failureCode,
    failureDetail:
      failureDetail === null
        ? null
        : failureDetail.slice(
            0,
            CENTER_AGENT_TURN_DIAGNOSTIC_FAILURE_DETAIL_MAX_CHARS
          ),
    failureDetailTruncated,
    publicationState: delivery.finalPublicationState,
    publishedResultId:
      delivery.conversationKind === "message_channel"
        ? delivery.providerPublicationResultId
        : delivery.publishedSignalId,
    runtimeEvidence: null,
    runtimeEvidenceStatus: "not_recorded",
    status: delivery.status,
    submissionId: delivery.submissionId,
    submittedAtMs: delivery.submittedAtMs,
    triggerMessageId: delivery.triggerMessageId,
    updatedAtMs: delivery.updatedAtMs,
  };
}
function projectRemoteAgentNativeDeliveryConversationSource(input: {
  currentDelivery: RemoteAgentNativeDeliveryRecord;
  delivery: RemoteAgentNativeDeliveryRecord;
}): CenterAgentTurnDiagnostic["conversationSource"] {
  const isCurrentConversation = isSameNativeDeliveryConversation(
    input.delivery,
    input.currentDelivery
  );
  if (input.delivery.conversationKind === "space") {
    return {
      isCurrentConversation,
      kind: "space",
      spaceId: input.delivery.spaceId,
    };
  }
  if (input.delivery.conversationKind === "slack") {
    if (
      !(
        input.delivery.slackTeamId &&
        input.delivery.slackChannelId &&
        input.delivery.slackThreadTs
      )
    ) {
      return null;
    }
    return {
      channelId: input.delivery.slackChannelId,
      isCurrentConversation,
      kind: "slack",
      teamId: input.delivery.slackTeamId,
      threadTs: input.delivery.slackThreadTs,
    };
  }
  if (!input.delivery.messageChannelLocator) {
    return null;
  }
  return {
    isCurrentConversation,
    kind: "message_channel",
    locator: input.delivery.messageChannelLocator,
  };
}
function isSameNativeDeliveryConversation(
  left: RemoteAgentNativeDeliveryRecord,
  right: RemoteAgentNativeDeliveryRecord
): boolean {
  if (left.conversationKind !== right.conversationKind) {
    return false;
  }
  if (left.conversationKind === "space") {
    return left.spaceId === right.spaceId;
  }
  if (left.conversationKind === "slack") {
    return (
      left.slackTeamId === right.slackTeamId &&
      left.slackChannelId === right.slackChannelId &&
      left.slackThreadTs === right.slackThreadTs
    );
  }
  const leftLocator = left.messageChannelLocator;
  const rightLocator = right.messageChannelLocator;
  if (!(leftLocator && rightLocator)) {
    return false;
  }
  if (leftLocator.provider !== rightLocator.provider) {
    return false;
  }
  if (leftLocator.provider === "slack") {
    return (
      rightLocator.provider === "slack" &&
      leftLocator.connectionId === rightLocator.connectionId &&
      leftLocator.teamId === rightLocator.teamId &&
      leftLocator.channelId === rightLocator.channelId &&
      leftLocator.rootMessageId === rightLocator.rootMessageId
    );
  }
  if (rightLocator.provider === "slack") {
    return false;
  }
  return (
    leftLocator.connectionId === rightLocator.connectionId &&
    leftLocator.appId === rightLocator.appId &&
    leftLocator.tenantKey === rightLocator.tenantKey &&
    leftLocator.chatId === rightLocator.chatId &&
    leftLocator.rootMessageId === rightLocator.rootMessageId &&
    leftLocator.threadId === rightLocator.threadId
  );
}
export async function listRemoteAgentNativeDeliveryTurnDiagnosticRecords(input: {
  currentDelivery: RemoteAgentNativeDeliveryRecord;
  db: PostgresDatabase;
  limit: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit)));
  const current = input.currentDelivery;
  const where: string[] = [
    "organization_id = $1",
    "profile_id = $2",
    "delivery_id <> $3",
    "routine_run_id IS NULL",
  ];
  const bindings: unknown[] = [
    current.organizationId,
    current.profileId,
    current.deliveryId,
  ];
  if (current.onBehalfOfUserId) {
    where.push(`on_behalf_of_user_id = $${bindings.length + 1}`);
    bindings.push(current.onBehalfOfUserId);
  } else if (current.anonymousMemberSpeaker) {
    const identity = current.anonymousMemberSpeaker.messageChannelIdentity;
    where.push(
      "on_behalf_of_user_id IS NULL",
      `anonymous_member_speaker_json::jsonb #>> '{messageChannelIdentity,provider}' = $${bindings.length + 1}`,
      `anonymous_member_speaker_json::jsonb #>> '{messageChannelIdentity,connectionId}' = $${bindings.length + 2}`,
      `anonymous_member_speaker_json::jsonb #>> '{messageChannelIdentity,providerUserId}' = $${bindings.length + 3}`
    );
    bindings.push(
      identity.provider,
      identity.connectionId,
      identity.providerUserId
    );
  } else {
    return [];
  }
  if (current.conversationKind === "slack") {
    if (!(current.slackTeamId && current.slackChannelId)) {
      return [];
    }
    where.push(
      "conversation_kind = 'slack'",
      `slack_team_id = $${bindings.length + 1}`,
      `slack_channel_id = $${bindings.length + 2}`
    );
    bindings.push(current.slackTeamId, current.slackChannelId);
  } else if (current.conversationKind === "space") {
    where.push(
      "conversation_kind = 'space'",
      `space_id = $${bindings.length + 1}`
    );
    bindings.push(current.spaceId);
  } else {
    const locator = current.messageChannelLocator;
    if (!locator) {
      return [];
    }
    where.push(
      "conversation_kind = 'message_channel'",
      `message_channel_provider = $${bindings.length + 1}`,
      `message_channel_connection_id = $${bindings.length + 2}`
    );
    bindings.push(locator.provider, locator.connectionId);
    if (locator.provider === "slack") {
      where.push(
        `message_channel_locator_json::jsonb ->> 'teamId' = $${bindings.length + 1}`,
        `message_channel_locator_json::jsonb ->> 'channelId' = $${bindings.length + 2}`
      );
      bindings.push(locator.teamId, locator.channelId);
    } else {
      where.push(
        `message_channel_locator_json::jsonb ->> 'appId' = $${bindings.length + 1}`,
        `message_channel_locator_json::jsonb ->> 'chatId' = $${bindings.length + 2}`,
        `message_channel_locator_json::jsonb ->> 'tenantKey' IS NOT DISTINCT FROM $${bindings.length + 3}`
      );
      bindings.push(locator.appId, locator.chatId, locator.tenantKey);
    }
  }
  const rows = await input.db.query<RemoteAgentNativeDeliveryRow>({
    text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE ${where.join("\n          AND ")}
        ORDER BY created_at_ms DESC NULLS LAST, delivery_id DESC NULLS LAST
        LIMIT $${bindings.length + 1}
      `,
    values: [...bindings, limit],
  });
  return rows.rows.map(mapNativeDeliveryRow);
}
export async function listRemoteAgentNativeDeliveryTurnDiagnostics(input: {
  currentDelivery: RemoteAgentNativeDeliveryRecord;
  db: PostgresDatabase;
  limit: number;
}): Promise<CenterAgentTurnDiagnostic[]> {
  return (await listRemoteAgentNativeDeliveryTurnDiagnosticRecords(input)).map(
    (delivery) =>
      projectRemoteAgentNativeDeliveryTurnDiagnostic(
        delivery,
        input.currentDelivery
      )
  );
}
/** Read only: the Run's persisted pointer, not chronology, selects its result owner. */
export async function listRemoteAgentRoutineDeliveryDiagnosticRecords(input: {
  db: PostgresDatabase;
  organizationId: string;
  routineRunId: string;
  currentDeliveryId: string | null;
}): Promise<{
  deliveries: RemoteAgentNativeDeliveryRecord[];
  truncated: boolean;
}> {
  const rows = await input.db.query<RemoteAgentNativeDeliveryRow>({
    text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
      WHERE organization_id = $1 AND routine_run_id = $2
      ORDER BY CASE WHEN delivery_id = $3 THEN 0 ELSE 1 END,
        created_at_ms ASC NULLS FIRST, delivery_id ASC NULLS FIRST
      LIMIT 9`,
    values: [input.organizationId, input.routineRunId, input.currentDeliveryId],
  });
  return {
    deliveries: rows.rows.slice(0, 8).map(mapNativeDeliveryRow),
    truncated: rows.rows.length > 8,
  };
}
export async function readRemoteAgentNativeDeliveryByDeliveryId(input: {
  db: PostgresDatabase;
  deliveryId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .query<RemoteAgentNativeDeliveryRow>({
      text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE delivery_id = $1
        LIMIT 1
      `,
      values: [input.deliveryId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapNativeDeliveryRow(row) : null;
}
const NATIVE_DELIVERY_ID_LOOKUP_CHUNK_SIZE = 80;
export async function listRemoteAgentNativeDeliveriesByDeliveryIds(input: {
  db: PostgresDatabase;
  deliveryIds: readonly string[];
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const deliveryIds = [
    ...new Set(
      input.deliveryIds
        .map((deliveryId) => deliveryId.trim())
        .filter((deliveryId) => deliveryId.length > 0)
    ),
  ];
  const deliveries: RemoteAgentNativeDeliveryRecord[] = [];
  for (
    let offset = 0;
    offset < deliveryIds.length;
    offset += NATIVE_DELIVERY_ID_LOOKUP_CHUNK_SIZE
  ) {
    const chunk = deliveryIds.slice(
      offset,
      offset + NATIVE_DELIVERY_ID_LOOKUP_CHUNK_SIZE
    );
    const rows = await input.db.query<RemoteAgentNativeDeliveryRow>({
      text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
          WHERE delivery_id = ANY($1::text[])
          ORDER BY delivery_id ASC NULLS FIRST
        `,
      values: [chunk],
    });
    deliveries.push(...rows.rows.map(mapNativeDeliveryRow));
  }
  return deliveries;
}
export async function readRemoteAgentNativeDeliveryByExecution(input: {
  db: PostgresDatabase;
  dispatchId: string;
  profileId: string;
  spaceId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .query<RemoteAgentNativeDeliveryRow>({
      text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE dispatch_id = $1
          AND profile_id = $2
          AND space_id = $3
        ORDER BY created_at_ms DESC NULLS LAST, delivery_id DESC NULLS LAST
        LIMIT 1
      `,
      values: [input.dispatchId, input.profileId, input.spaceId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapNativeDeliveryRow(row) : null;
}
export async function readRemoteAgentNativeDeliveryByDispatchAndConversation(input: {
  conversationId: string;
  db: PostgresDatabase;
  dispatchId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query<RemoteAgentNativeDeliveryRow>({
    text: `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE dispatch_id = $1
          AND space_id = $2
        ORDER BY created_at_ms DESC NULLS LAST, delivery_id DESC NULLS LAST
        LIMIT 2
      `,
    values: [input.dispatchId, input.conversationId],
  });
  if (result.rows.length > 1) {
    throw new Error("execution_recovery.execution_identity_ambiguous");
  }
  const row = result.rows[0];
  return row ? mapNativeDeliveryRow(row) : null;
}
export async function readActiveRemoteAgentNativeDeliveryCancellationTarget(input: {
  db: PostgresDatabase;
  dispatchId: string;
  profileId: string;
  spaceId: string;
}): Promise<ActiveRemoteAgentNativeDeliveryCancellationTarget | null> {
  const row = await input.db
    .query<{
      conversation_id: string | null;
      idempotency_key: string;
      organization_id: string;
      space_id: string;
      submission_id: string;
    }>({
      text: `
        SELECT
          COALESCE(
            ((worker_submit_request_json)::jsonb #>> '{request,runtimeConversation,id}'),
            ((worker_submit_request_json)::jsonb #>> '{runtimeConversation,id}'),
            ((worker_submit_request_json)::jsonb #>> '{request,conversationId}'),
            ((worker_submit_request_json)::jsonb #>> '{conversationId}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{request,runtimeConversation,id}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{runtimeConversation,id}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{request,conversationId}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{conversationId}')
          ) AS conversation_id,
          idempotency_key,
          organization_id,
          space_id,
          submission_id
        FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        WHERE dispatch_id = $1
          AND profile_id = $2
          AND space_id = $3
          AND conversation_kind = 'space'
          AND status IN ('accepted', 'retry_observed')
          AND submission_id IS NOT NULL
        ORDER BY updated_at_ms DESC NULLS LAST, delivery_id DESC NULLS LAST
        LIMIT 1
      `,
      values: [input.dispatchId, input.profileId, input.spaceId],
    })
    .then((result) => result.rows[0] ?? null);
  return row
    ? {
        idempotencyKey: row.idempotency_key,
        ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
        organizationId: row.organization_id,
        spaceId: row.space_id,
        submissionId: row.submission_id,
      }
    : null;
}
export async function listActiveCenterAgentNativeDeliveryCancellationTargets(input: {
  db: PostgresDatabase;
  organizationId: string;
  profileId: string;
}): Promise<ActiveRemoteAgentNativeDeliveryCancellationTarget[]> {
  const rows = await input.db.query<{
    conversation_id: string | null;
    idempotency_key: string;
    organization_id: string;
    space_id: string;
    submission_id: string;
  }>({
    text: `
        SELECT
          COALESCE(
            ((worker_submit_request_json)::jsonb #>> '{request,runtimeConversation,id}'),
            ((worker_submit_request_json)::jsonb #>> '{runtimeConversation,id}'),
            ((worker_submit_request_json)::jsonb #>> '{request,conversationId}'),
            ((worker_submit_request_json)::jsonb #>> '{conversationId}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{request,runtimeConversation,id}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{runtimeConversation,id}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{request,conversationId}'),
            ((execution_recovery_submit_request_json)::jsonb #>> '{conversationId}')
          ) AS conversation_id,
          idempotency_key,
          organization_id,
          space_id,
          submission_id
        FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        WHERE organization_id = $1
          AND profile_id = $2
          AND status IN ('submitted', 'accepted', 'retry_observed')
          AND submission_id IS NOT NULL
        ORDER BY updated_at_ms ASC NULLS FIRST, delivery_id ASC NULLS FIRST
      `,
    values: [input.organizationId, input.profileId],
  });
  return (rows.rows ?? []).map((row) => ({
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    submissionId: row.submission_id,
  }));
}
export async function markRemoteAgentCallbackRejected(input: {
  db: PostgresDatabase;
  nowMs: number;
  submissionId: string | null;
  idempotencyKey: string | null;
  failureCode: string;
}): Promise<void> {
  if (input.submissionId) {
    await input.db.query({
      text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            status = 'callback_rejected',
            failure_code = $1,
            callback_received_at_ms = $2,
            completed_at_ms = COALESCE(completed_at_ms, $3),
            worker_submit_request_json = NULL,
            updated_at_ms = $4
          WHERE submission_id = $5
            AND status IN ('submitted', 'accepted', 'retry_observed')
        `,
      values: [
        input.failureCode,
        input.nowMs,
        input.nowMs,
        input.nowMs,
        input.submissionId,
      ],
    });
    return;
  }
  if (input.idempotencyKey) {
    await input.db.query({
      text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            status = 'callback_rejected',
            failure_code = $1,
            callback_received_at_ms = $2,
            completed_at_ms = COALESCE(completed_at_ms, $3),
            worker_submit_request_json = NULL,
            updated_at_ms = $4
          WHERE idempotency_key = $5
            AND status IN ('submitted', 'accepted', 'retry_observed')
        `,
      values: [
        input.failureCode,
        input.nowMs,
        input.nowMs,
        input.nowMs,
        input.idempotencyKey,
      ],
    });
  }
}
export async function insertRemoteAgentRejectedCallbackRecord(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  spaceId: string;
  profileId: string;
  bindingId: string;
  triggerMessageId: string;
  triggerText?: string | null;
  dispatchId: string;
  idempotencyKey: string;
  submissionId: string;
  failureCode: string;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const slackTarget = parseSlackConversationId(input.spaceId);
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          source_client_message_id,
          trigger_text,
          dispatch_id,
          attempt_id,
          idempotency_key,
          submission_id,
          status,
          failure_code,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          created_at_ms,
          updated_at_ms,
          callback_received_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, null, $8, $9, null, $10, $11, 'callback_rejected', $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT(submission_id) DO UPDATE SET
          status = CASE
            WHEN "openMeldRemoteAgent_native_delivery_ledger".status = 'completed'
              THEN "openMeldRemoteAgent_native_delivery_ledger".status
            ELSE 'callback_rejected'
          END,
          failure_code = excluded.failure_code,
          callback_received_at_ms = excluded.callback_received_at_ms,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      crypto.randomUUID(),
      input.organizationId,
      slackTarget ? "slack" : "space",
      input.spaceId,
      input.profileId,
      input.bindingId,
      input.triggerMessageId,
      input.triggerText ?? null,
      input.dispatchId,
      input.idempotencyKey,
      input.submissionId,
      input.failureCode,
      slackTarget?.teamId ?? null,
      slackTarget?.channelId ?? null,
      slackTarget?.threadTs ?? null,
      input.nowMs,
      input.nowMs,
      input.nowMs,
    ],
  });
  const record = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (!record) {
    throw new Error("Remote Agent callback rejection write lost its row");
  }
  return record;
}
export async function markRemoteAgentCallbackPublishFailure(input: {
  db: PostgresDatabase;
  nowMs: number;
  submissionId: string;
  failureCode: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          failure_code = $1,
          callback_received_at_ms = $2,
          updated_at_ms = $3
        WHERE submission_id = $4
          AND status IN ('accepted', 'retry_observed')
      `,
    values: [input.failureCode, input.nowMs, input.nowMs, input.submissionId],
  });
}
export async function claimRemoteAgentNativeDeliveryTerminalFailure(input: {
  db: PostgresDatabase;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'failed',
          failure_code = $1,
          worker_submit_request_json = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $2),
          completed_at_ms = COALESCE(completed_at_ms, $3),
          updated_at_ms = $4
        WHERE submission_id = $5
          AND idempotency_key = $6
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
      `,
    values: [
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (
    record?.status === "failed" &&
    record.failureCode === input.failureCode &&
    !record.publishedSignalId
  ) {
    return record;
  }
  return null;
}
export async function reopenRetiredDeadlineFailureForLateCallback(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'accepted',
          failure_code = NULL,
          callback_received_at_ms = NULL,
          completed_at_ms = NULL,
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          published_signal_id = NULL,
          retired_deadline_failure_code = failure_code,
          retired_deadline_failure_published_signal_id = published_signal_id,
          retired_deadline_failure_reconciled_at_ms = $1,
          updated_at_ms = $2
        WHERE submission_id = $3
          AND idempotency_key = $4
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = 'remote_agent.delivery_expired'
      `,
    values: [
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  return record?.status === "accepted" ? record : null;
}
export async function claimRemoteAgentNativeDeliveryAdmissionWatchdog(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'failed',
          failure_code = $1,
          final_publication_state = 'claimed',
          final_publication_claim_id = $2,
          final_publication_claimed_at_ms = $3,
          final_publication_claim_expires_at_ms = $4,
          updated_at_ms = $5
        WHERE idempotency_key = $6
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'submitted'
          AND final_publication_state IS NULL
      `,
    values: [
      input.failureCode,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  return record?.finalPublicationClaimId === input.claimId ? record : null;
}
export async function scheduleRemoteAgentTaskContinuationAdmissionRetry(input: {
  attempt: number;
  db: PostgresDatabase;
  dueAtMs: number;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          admission_retry_due_at_ms = $1,
          updated_at_ms = $2
        WHERE idempotency_key = $3
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'submitted'
          AND final_publication_state IS NULL
          AND admission_attempt_count = $4
          AND admission_retry_due_at_ms IS NULL
          AND worker_submit_request_json IS NOT NULL
      `,
    values: [input.dueAtMs, input.nowMs, input.idempotencyKey, input.attempt],
  });
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  if (
    record?.status === "submitted" &&
    record.admissionAttemptCount === input.attempt &&
    record.admissionRetryDueAtMs !== null
  ) {
    return record;
  }
  return didPostgresWrite(result) ? record : null;
}
export async function claimRemoteAgentTaskContinuationAdmissionRetry(input: {
  attempt: number;
  db: PostgresDatabase;
  dueAtMs: number;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          admission_attempt_count = $1,
          admission_retry_due_at_ms = NULL,
          submitted_at_ms = $2,
          updated_at_ms = $3
        WHERE idempotency_key = $4
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'submitted'
          AND final_publication_state IS NULL
          AND admission_attempt_count = $5
          AND admission_retry_due_at_ms = $6
          AND worker_submit_request_json IS NOT NULL
      `,
    values: [
      input.attempt,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.attempt - 1,
      input.dueAtMs,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  return record?.admissionAttemptCount === input.attempt ? record : null;
}
export async function releaseRemoteAgentNativeDeliveryAdmissionWatchdog(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'submitted',
          failure_code = NULL,
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = $1
        WHERE idempotency_key = $2
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'failed'
          AND failure_code = $3
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $4
          AND published_signal_id IS NULL
      `,
    values: [
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
    ],
  });
  return didPostgresWrite(result);
}
export async function markRemoteAgentNativeDeliveryAdmissionWatchdogPublished(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          published_signal_id = $1,
          completed_at_ms = COALESCE(completed_at_ms, $2),
          updated_at_ms = $3
        WHERE idempotency_key = $4
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'failed'
          AND failure_code = $5
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $6
      `,
    values: [
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function markRemoteAgentMessageChannelAdmissionWatchdogPublished(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  providerPublicationResultId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          provider_progress_state = CASE
            WHEN $1::text IS NULL THEN provider_progress_state
            ELSE 'finalized'
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = COALESCE(
            $2,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN $3::text IS NULL THEN provider_progress_pending_sequence
            ELSE NULL
          END,
          provider_publication_result_id = $4,
          completed_at_ms = COALESCE(completed_at_ms, $5),
          updated_at_ms = $6
        WHERE idempotency_key = $7
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = $8
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $9
          AND final_publication_claim_expires_at_ms > $10
          AND provider_publication_idempotency_key = $11
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.providerProgressSequence,
      input.providerProgressSequence,
      input.providerProgressSequence,
      input.providerPublicationResultId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
      input.nowMs,
      input.providerPublicationIdempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function markRemoteAgentMessageChannelAdmissionWatchdogOutcomeUnknown(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'outcome_unknown',
          provider_progress_state = CASE
            WHEN provider_progress_card_id IS NOT NULL
              AND provider_progress_state IN (
                'send_claimed',
                'send_outcome_unknown',
                'sent',
                'update_claimed'
              )
              THEN 'finalized'
            ELSE provider_progress_state
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = COALESCE(
            $1,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN provider_progress_card_id IS NOT NULL THEN NULL
            ELSE provider_progress_pending_sequence
          END,
          updated_at_ms = $2
        WHERE idempotency_key = $3
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = $4
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $5
          AND provider_publication_idempotency_key = $6
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.providerProgressSequence,
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
      input.providerPublicationIdempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function releaseRemoteAgentMessageChannelAdmissionWatchdogClaim(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'submitted',
          failure_code = NULL,
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = $1
        WHERE idempotency_key = $2
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = $3
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $4
          AND provider_publication_idempotency_key = $5
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
      input.providerPublicationIdempotencyKey,
    ],
  });
  return didPostgresWrite(result);
}
export async function releaseRemoteAgentMessageChannelTerminalFailureClaim(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = $1
        WHERE idempotency_key = $2
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = $3
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $4
          AND provider_publication_idempotency_key = $5
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
      input.providerPublicationIdempotencyKey,
    ],
  });
  return didPostgresWrite(result);
}
export async function claimRemoteAgentFinalPublication(input: {
  db: PostgresDatabase;
  claimExpiresAtMs: number;
  claimId: string;
  nowMs: number;
  payload: RemoteAgentFinalPublicationPayload;
  submissionId: string;
  idempotencyKey: string;
  terminalFailureCode?: string | null;
  terminalFailureDetail?: string | null;
  recoverSpaceFailure?: boolean;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  if (input.terminalFailureDetail && !input.terminalFailureCode) {
    throw new Error(
      "Remote Agent terminal failure detail requires a failure code"
    );
  }
  const payloadJson = serializeFinalPublicationPayload(input.payload);
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = CASE WHEN $1::text IS NULL THEN status ELSE 'failed' END,
          failure_code = CASE WHEN $2::text IS NULL THEN failure_code ELSE $3 END,
          failure_detail = CASE
            WHEN $4::text IS NULL THEN failure_detail
            ELSE $5
          END,
          final_publication_state = 'claimed',
          final_publication_claim_id = $6,
          final_publication_claimed_at_ms = $7,
          final_publication_claim_expires_at_ms = $8,
          final_publication_payload_json = COALESCE(
            final_publication_payload_json,
            $9
          ),
          callback_received_at_ms = COALESCE(callback_received_at_ms, $10),
          updated_at_ms = $11
        WHERE submission_id = $12
          AND idempotency_key = $13
          AND (
            (status IN ('accepted', 'retry_observed') AND final_publication_state IS NULL)
            OR ($15::boolean AND conversation_kind = 'space' AND status = 'failed'
              AND published_signal_id IS NULL
              AND final_publication_payload_json IS NOT NULL
              AND ((final_publication_payload_json)::jsonb #>> '{failureCode}') IS NOT NULL
              AND (final_publication_state = 'outcome_unknown'
                OR (final_publication_state = 'claimed' AND final_publication_claim_expires_at_ms <= $16)))
          )
          AND (
            final_publication_payload_json IS NULL
            OR final_publication_payload_json = $14
          )
      `,
    values: [
      input.terminalFailureCode ?? null,
      input.terminalFailureCode ?? null,
      input.terminalFailureCode ?? null,
      input.terminalFailureDetail ?? null,
      input.terminalFailureDetail ?? null,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      payloadJson,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      payloadJson,
      input.recoverSpaceFailure === true,
      input.nowMs,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (
    record?.finalPublicationState !== "claimed" ||
    record.finalPublicationClaimId !== input.claimId ||
    record.finalPublicationPayload === null ||
    serializeFinalPublicationPayload(record.finalPublicationPayload) !==
      payloadJson
  ) {
    return null;
  }
  return record;
}
export async function recordRemoteAgentFinalPublicationPayload(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  payload: RemoteAgentFinalPublicationPayload;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const payloadJson = serializeFinalPublicationPayload(input.payload);
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_payload_json = COALESCE(
            final_publication_payload_json,
            $1
          ),
          callback_received_at_ms = COALESCE(callback_received_at_ms, $2),
          updated_at_ms = $3
        WHERE submission_id = $4
          AND idempotency_key = $5
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          AND (
            final_publication_payload_json IS NULL
            OR final_publication_payload_json = $6
          )
      `,
    values: [
      payloadJson,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      payloadJson,
    ],
  });
  const record = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (
    record?.idempotencyKey !== input.idempotencyKey ||
    record.finalPublicationPayload === null ||
    serializeFinalPublicationPayload(record.finalPublicationPayload) !==
      payloadJson
  ) {
    return null;
  }
  return record;
}
export async function clearRemoteAgentFinalPublicationPayload(input: {
  db: PostgresDatabase;
  deliveryId: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET final_publication_payload_json = NULL
        WHERE delivery_id = $1
          AND idempotency_key = $2
          AND final_publication_payload_json IS NOT NULL
          AND status IN (
            'completed',
            'failed',
            'flag_rejected',
            'guardrail_rejected',
            'worker_unavailable',
            'callback_rejected'
          )
      `,
    values: [input.deliveryId, input.idempotencyKey],
  });
  return didPostgresWrite(result);
}
export async function claimRemoteAgentMessageChannelFinalPublication(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  payload: RemoteAgentFinalPublicationPayload;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const payloadJson = serializeFinalPublicationPayload(input.payload);
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = CASE
            WHEN final_publication_payload_json IS NULL
              THEN CASE WHEN $1::text IS NULL THEN status ELSE 'failed' END
            WHEN ((final_publication_payload_json)::jsonb #>> '{failureCode}') IS NULL
              THEN ((final_publication_payload_json)::jsonb #>> '{resumeStatus}')
            ELSE 'failed'
          END,
          failure_code = CASE
            WHEN final_publication_payload_json IS NULL THEN $2
            ELSE ((final_publication_payload_json)::jsonb #>> '{failureCode}')
          END,
          failure_detail = CASE
            WHEN final_publication_payload_json IS NULL THEN $3
            ELSE ((final_publication_payload_json)::jsonb #>> '{failureDetail}')
          END,
          final_publication_state = 'claimed',
          final_publication_claim_id = $4,
          final_publication_claimed_at_ms = $5,
          final_publication_claim_expires_at_ms = LEAST(
            $6,
            COALESCE(final_publication_ambiguity_deadline_at_ms, $7)
          ),
          final_publication_payload_json = COALESCE(
            final_publication_payload_json,
            $8
          ),
          final_publication_attempt_count =
            final_publication_attempt_count + 1,
          final_publication_next_attempt_at_ms = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $9),
          updated_at_ms = $10
        WHERE submission_id = $11
          AND idempotency_key = $12
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          AND (
            final_publication_next_attempt_at_ms IS NULL
            OR final_publication_next_attempt_at_ms <= $13
          )
          AND (
            final_publication_ambiguity_deadline_at_ms IS NULL
            OR final_publication_ambiguity_deadline_at_ms > $14
          )
          AND provider_publication_idempotency_key = $15
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.payload.failureCode,
      input.payload.failureCode,
      input.payload.failureDetail,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.claimExpiresAtMs,
      payloadJson,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.nowMs,
      input.nowMs,
      input.providerPublicationIdempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (
    record?.finalPublicationState !== "claimed" ||
    record.finalPublicationClaimId !== input.claimId ||
    record.finalPublicationPayload === null
  ) {
    return null;
  }
  return record;
}
export async function fenceRemoteAgentMessageChannelStandaloneFinalPublicationBeforeProviderIo(input: {
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET updated_at_ms = $1
        WHERE submission_id = $2
          AND idempotency_key = $3
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $4
          AND final_publication_claim_expires_at_ms > $5
          AND final_publication_payload_json IS NOT NULL
          AND final_publication_provider_progress_sequence IS NULL
          AND (
            final_publication_ambiguity_deadline_at_ms IS NULL
            OR final_publication_ambiguity_deadline_at_ms > $6
          )
          AND provider_publication_idempotency_key = $7
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.nowMs,
      input.nowMs,
      input.providerPublicationIdempotencyKey,
    ],
  });
  return didPostgresWrite(result);
}
export async function freezeRemoteAgentMessageChannelFinalPublicationSequence(input: {
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_provider_progress_sequence = COALESCE(
            final_publication_provider_progress_sequence,
            $1
          ),
          updated_at_ms = $2
        WHERE submission_id = $3
          AND idempotency_key = $4
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $5
          AND final_publication_claim_expires_at_ms > $6
          AND final_publication_payload_json IS NOT NULL
          AND (
            final_publication_provider_progress_sequence IS NULL
            OR final_publication_provider_progress_sequence = $7
          )
          AND provider_publication_idempotency_key = $8
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.providerProgressSequence,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.nowMs,
      input.providerProgressSequence,
      input.providerPublicationIdempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (
    record?.finalPublicationState !== "claimed" ||
    record.finalPublicationClaimId !== input.claimId ||
    record.finalPublicationProviderProgressSequence !==
      input.providerProgressSequence
  ) {
    return null;
  }
  return record;
}
export async function claimRemoteAgentSlackAdmissionFailurePublication(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  failureDetail: string;
  idempotencyKey: string;
  nowMs: number;
  status: "failed" | "flag_rejected" | "worker_unavailable";
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = $1,
          failure_code = $2,
          failure_detail = COALESCE(failure_detail, $3),
          worker_submit_request_json = NULL,
          final_publication_state = 'claimed',
          final_publication_claim_id = $4,
          final_publication_claimed_at_ms = $5,
          final_publication_claim_expires_at_ms = $6,
          updated_at_ms = $7
        WHERE idempotency_key = $8
          AND conversation_kind = 'slack'
          AND submission_id IS NULL
          AND status IN ('submitted', 'failed', 'flag_rejected', 'worker_unavailable')
          AND final_publication_state IS NULL
      `,
    values: [
      input.status,
      input.failureCode,
      input.failureDetail,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  return record?.finalPublicationClaimId === input.claimId ? record : null;
}
export async function claimRemoteAgentMessageChannelAdmissionFailurePublication(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  failureDetail: string;
  idempotencyKey: string;
  nowMs: number;
  status: "failed" | "worker_unavailable";
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = $1,
          failure_code = $2,
          failure_detail = COALESCE(failure_detail, $3),
          worker_submit_request_json = NULL,
          final_publication_state = 'claimed',
          final_publication_claim_id = $4,
          final_publication_claimed_at_ms = $5,
          final_publication_claim_expires_at_ms = $6,
          updated_at_ms = $7
        WHERE idempotency_key = $8
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN (
            'submitted',
            'failed',
            'flag_rejected',
            'worker_unavailable'
          )
          AND (
            final_publication_state IS NULL
            OR (
              final_publication_state = 'claimed'
              AND final_publication_claim_expires_at_ms <= $9
              AND failure_code = $10
            )
          )
          AND provider_publication_idempotency_key IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.status,
      input.failureCode,
      input.failureDetail,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey,
      input.nowMs,
      input.failureCode,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  return record?.finalPublicationClaimId === input.claimId ? record : null;
}
export async function markRemoteAgentSlackAdmissionFailurePublished(input: {
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          published_signal_id = $1,
          completed_at_ms = $2,
          updated_at_ms = $3
        WHERE idempotency_key = $4
          AND conversation_kind = 'slack'
          AND submission_id IS NULL
          AND status IN ('failed', 'flag_rejected', 'worker_unavailable')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $5
          AND published_signal_id IS NULL
      `,
    values: [
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function markRemoteAgentSlackAdmissionFailureOutcomeUnknown(input: {
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'outcome_unknown',
          updated_at_ms = $1
        WHERE idempotency_key = $2
          AND conversation_kind = 'slack'
          AND submission_id IS NULL
          AND status IN ('failed', 'flag_rejected', 'worker_unavailable')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $3
          AND published_signal_id IS NULL
      `,
    values: [input.nowMs, input.idempotencyKey, input.claimId],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function releaseRemoteAgentSlackAdmissionFailureClaim(input: {
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = $1
        WHERE idempotency_key = $2
          AND submission_id IS NULL
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $3
          AND published_signal_id IS NULL
      `,
    values: [input.nowMs, input.idempotencyKey, input.claimId],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function releaseRemoteAgentFinalPublicationClaim(input: {
  db: PostgresDatabase;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
  restoreStatus?: "accepted" | "retry_observed";
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = COALESCE($1, status),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = $2,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $3),
          updated_at_ms = $4
        WHERE submission_id = $5
          AND idempotency_key = $6
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $7
          AND published_signal_id IS NULL
      `,
    values: [
      input.restoreStatus ?? null,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
    ],
  });
  return didPostgresWrite(result);
}
export async function markRemoteAgentSlackFinalPublicationPublished(input: {
  db: PostgresDatabase;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'completed',
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = NULL,
          published_signal_id = $1,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $2),
          completed_at_ms = $3,
          updated_at_ms = $4
        WHERE submission_id = $5
          AND idempotency_key = $6
          AND conversation_kind = 'slack'
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $7
          AND published_signal_id IS NULL
      `,
    values: [
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function markRemoteAgentSlackFinalPublicationOutcomeUnknown(input: {
  db: PostgresDatabase;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'outcome_unknown',
          failure_code = 'remote_agent.callback_publication_outcome_unknown',
          callback_received_at_ms = COALESCE(callback_received_at_ms, $1),
          updated_at_ms = $2
        WHERE submission_id = $3
          AND idempotency_key = $4
          AND conversation_kind = 'slack'
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $5
          AND published_signal_id IS NULL
      `,
    values: [
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function markRemoteAgentRetainedResultPublicationRecovered(input: {
  db: PostgresDatabase;
  deliveryId: string;
  idempotencyKey: string;
  nowMs: number;
  publicationId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'completed',
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = NULL,
          failure_detail = NULL,
          published_signal_id = CASE
            WHEN conversation_kind = 'slack' THEN $1
            ELSE published_signal_id
          END,
          provider_publication_result_id = CASE
            WHEN conversation_kind = 'message_channel' THEN $2
            ELSE provider_publication_result_id
          END,
          completed_at_ms = COALESCE(completed_at_ms, $3),
          updated_at_ms = $4
        WHERE delivery_id = $5
          AND idempotency_key = $6
          AND conversation_kind IN ('slack', 'message_channel')
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state = 'outcome_unknown'
          AND final_publication_payload_json IS NOT NULL
          AND ((final_publication_payload_json)::jsonb #>> '{failureCode}')
            IS NULL
          AND published_signal_id IS NULL
          AND provider_publication_result_id IS NULL
      `,
    values: [
      input.publicationId,
      input.publicationId,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.idempotencyKey,
    ],
  });
  const record = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: input.deliveryId,
  });
  const recordedPublicationId =
    record?.conversationKind === "message_channel"
      ? record.providerPublicationResultId
      : record?.publishedSignalId;
  return record?.status === "completed" &&
    record.finalPublicationState === "published" &&
    recordedPublicationId === input.publicationId
    ? record
    : null;
}
export async function markRemoteAgentMessageChannelFinalPublicationPublished(input: {
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  providerPublicationResultId: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = CASE
            WHEN status = 'failed' THEN 'failed'
            ELSE 'completed'
          END,
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_next_attempt_at_ms = NULL,
          provider_progress_card_history_json = ((provider_progress_card_history_json)::jsonb #- '{pendingSnapshot}')::text,
          failure_code = CASE
            WHEN status = 'failed' THEN failure_code
            ELSE NULL
          END,
          provider_progress_state = CASE
            WHEN $1::text IS NULL THEN provider_progress_state
            ELSE 'finalized'
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = COALESCE(
            $2,
            final_publication_provider_progress_sequence,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN $3::text IS NULL THEN provider_progress_pending_sequence
            ELSE NULL
          END,
          provider_publication_result_id = $4,
          final_publication_provider_progress_sequence = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $5),
          completed_at_ms = $6,
          updated_at_ms = $7
        WHERE submission_id = $8
          AND idempotency_key = $9
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $10
          AND final_publication_claim_expires_at_ms > $11
          AND (
            final_publication_ambiguity_deadline_at_ms IS NULL
            OR final_publication_ambiguity_deadline_at_ms > $12
          )
          AND provider_publication_idempotency_key = $13
          AND (
            final_publication_provider_progress_sequence IS NULL
            OR final_publication_provider_progress_sequence = $14
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.providerProgressSequence,
      input.providerProgressSequence,
      input.providerProgressSequence,
      input.providerPublicationResultId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.nowMs,
      input.nowMs,
      input.providerPublicationIdempotencyKey,
      input.providerProgressSequence,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function markRemoteAgentMessageChannelFinalPublicationOutcomeUnknown(input: {
  claimId: string;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'failed',
          final_publication_state = 'outcome_unknown',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_next_attempt_at_ms = NULL,
          failure_code = CASE
            WHEN status = 'failed' THEN failure_code
            ELSE 'remote_agent.callback_publication_outcome_unknown'
          END,
          provider_progress_state = CASE
            WHEN provider_progress_card_id IS NOT NULL
              AND provider_progress_state IN (
                'send_claimed',
                'send_outcome_unknown',
                'sent',
                'update_claimed'
              )
              THEN 'finalized'
            ELSE provider_progress_state
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = COALESCE(
            $1,
            final_publication_provider_progress_sequence,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN provider_progress_card_id IS NOT NULL THEN NULL
            ELSE provider_progress_pending_sequence
          END,
          final_publication_provider_progress_sequence = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $2),
          updated_at_ms = $3
        WHERE submission_id = $4
          AND idempotency_key = $5
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $6
          AND provider_publication_idempotency_key = $7
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.providerProgressSequence,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function releaseRemoteAgentMessageChannelFinalPublicationClaim(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  nextAttemptAtMs?: number | null;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = ((final_publication_payload_json)::jsonb #>> '{resumeStatus}'),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_next_attempt_at_ms = $1,
          failure_code = $2,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $3),
          updated_at_ms = $4
        WHERE submission_id = $5
          AND idempotency_key = $6
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $7
          AND provider_publication_idempotency_key = $8
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.nextAttemptAtMs ?? null,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
    ],
  });
  return didPostgresWrite(result);
}
export async function scheduleRemoteAgentMessageChannelFinalPublicationRetry(input: {
  ambiguityDeadlineAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nextAttemptAtMs: number;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = ((final_publication_payload_json)::jsonb #>> '{resumeStatus}'),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_ambiguity_deadline_at_ms = COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            $1
          ),
          final_publication_next_attempt_at_ms = LEAST(
            $2,
            COALESCE(final_publication_ambiguity_deadline_at_ms, $3)
          ),
          final_publication_provider_progress_sequence = COALESCE(
            final_publication_provider_progress_sequence,
            $4
          ),
          failure_code = $5,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $6),
          updated_at_ms = $7
        WHERE submission_id = $8
          AND idempotency_key = $9
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $10
          AND final_publication_payload_json IS NOT NULL
          AND COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            $11
          ) > $12
          AND provider_publication_idempotency_key = $13
          AND (
            final_publication_provider_progress_sequence IS NULL
            OR final_publication_provider_progress_sequence = $14
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.ambiguityDeadlineAtMs,
      input.nextAttemptAtMs,
      input.ambiguityDeadlineAtMs,
      input.providerProgressSequence,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.ambiguityDeadlineAtMs,
      input.nowMs,
      input.providerPublicationIdempotencyKey,
      input.providerProgressSequence,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function recoverExpiredRemoteAgentMessageChannelFinalPublicationClaim(input: {
  ambiguityWindowMs: number;
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nextAttemptAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = ((final_publication_payload_json)::jsonb #>> '{resumeStatus}'),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_ambiguity_deadline_at_ms = COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            final_publication_claimed_at_ms + $1
          ),
          final_publication_next_attempt_at_ms = LEAST(
            $2,
            COALESCE(
              final_publication_ambiguity_deadline_at_ms,
              final_publication_claimed_at_ms + $3
            )
          ),
          failure_code = $4,
          updated_at_ms = $5
        WHERE submission_id = $6
          AND idempotency_key = $7
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_payload_json IS NOT NULL
          AND final_publication_claimed_at_ms IS NOT NULL
          AND final_publication_provider_progress_sequence IS NULL
          AND (
            final_publication_claim_expires_at_ms IS NULL
            OR final_publication_claim_expires_at_ms <= $8
          )
          AND COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            final_publication_claimed_at_ms + $9
          ) > $10
          AND provider_publication_idempotency_key IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.ambiguityWindowMs,
      input.nextAttemptAtMs,
      input.ambiguityWindowMs,
      input.failureCode,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.nowMs,
      input.ambiguityWindowMs,
      input.nowMs,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function expireRemoteAgentMessageChannelFinalPublicationAmbiguity(input: {
  ambiguityWindowMs: number;
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'failed',
          final_publication_state = 'outcome_unknown',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_next_attempt_at_ms = NULL,
          failure_code = CASE
            WHEN status = 'failed' THEN failure_code
            ELSE 'remote_agent.callback_publication_outcome_unknown'
          END,
          provider_progress_state = CASE
            WHEN provider_progress_card_id IS NOT NULL
              AND provider_progress_state IN (
                'send_claimed',
                'send_outcome_unknown',
                'sent',
                'update_claimed'
              )
              THEN 'finalized'
            ELSE provider_progress_state
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = COALESCE(
            final_publication_provider_progress_sequence,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN provider_progress_card_id IS NOT NULL THEN NULL
            ELSE provider_progress_pending_sequence
          END,
          final_publication_provider_progress_sequence = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $1),
          updated_at_ms = $2
        WHERE submission_id = $3
          AND idempotency_key = $4
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND (
            final_publication_state = 'claimed'
            OR final_publication_state IS NULL
          )
          AND (
            (
              final_publication_state IS NULL
              AND final_publication_ambiguity_deadline_at_ms IS NOT NULL
              AND final_publication_ambiguity_deadline_at_ms <= $5
            )
            OR (
              final_publication_state = 'claimed'
              AND (
                final_publication_claim_expires_at_ms IS NULL
                OR final_publication_claim_expires_at_ms <= $6
              )
              AND COALESCE(
                final_publication_ambiguity_deadline_at_ms,
                final_publication_claimed_at_ms + $7
              ) <= $8
            )
          )
          AND provider_publication_idempotency_key IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `,
    values: [
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.nowMs,
      input.nowMs,
      input.ambiguityWindowMs,
      input.nowMs,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function expireRemoteAgentFinalPublicationClaim(input: {
  db: PostgresDatabase;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'outcome_unknown',
          failure_code = CASE
            WHEN status = 'failed' THEN failure_code
            ELSE 'remote_agent.callback_publication_outcome_unknown'
          END,
          updated_at_ms = $1
        WHERE submission_id = $2
          AND idempotency_key = $3
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND (
            final_publication_claim_expires_at_ms IS NULL
            OR final_publication_claim_expires_at_ms <= $4
          )
          AND published_signal_id IS NULL
      `,
    values: [
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.nowMs,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function markRemoteAgentFailedCallbackPublicationPublished(input: {
  db: PostgresDatabase;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'failed',
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = $1,
          published_signal_id = $2,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $3),
          completed_at_ms = $4,
          updated_at_ms = $5
        WHERE submission_id = $6
          AND idempotency_key = $7
          AND status = 'failed'
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $8
          AND published_signal_id IS NULL
      `,
    values: [
      input.failureCode,
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function markRemoteAgentFailedCallbackPublicationOutcomeUnknown(input: {
  db: PostgresDatabase;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'failed',
          final_publication_state = 'outcome_unknown',
          failure_code = $1,
          callback_received_at_ms = COALESCE(callback_received_at_ms, $2),
          completed_at_ms = COALESCE(completed_at_ms, $3),
          updated_at_ms = $4
        WHERE submission_id = $5
          AND idempotency_key = $6
          AND status = 'failed'
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = $7
          AND published_signal_id IS NULL
      `,
    values: [
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
    ],
  });
  if (!didPostgresWrite(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
/** Project Space's confirmed stopped final outcome onto an unacknowledged
 * native delivery. A cancellation request or missing Worker is insufficient. */
export async function projectUnadmittedNativeDeliveryStopped(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
    SET status = 'failed', failure_code = 'runtime_coordinator.pre_agent_stop_requested',
        failure_detail = NULL, published_signal_id = $1,
        completed_at_ms = COALESCE(completed_at_ms, $2), updated_at_ms = $3
    WHERE idempotency_key = $4 AND status = 'submitted'
      AND submission_id IS NULL AND final_publication_state IS NULL`,
    values: [
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
    ],
  });
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function markRemoteAgentNativeDeliveryFailurePublished(input: {
  db: PostgresDatabase;
  nowMs: number;
  submissionId: string;
  failureCode: string;
  publishedSignalId: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          published_signal_id = $1,
          updated_at_ms = $2
        WHERE submission_id = $3
          AND status = 'failed'
          AND failure_code = $4
          AND published_signal_id IS NULL
      `,
    values: [
      input.publishedSignalId,
      input.nowMs,
      input.submissionId,
      input.failureCode,
    ],
  });
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function markRemoteAgentRoutineAdmissionFailurePublished(input: {
  db: PostgresDatabase;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          final_publication_state = 'published',
          failure_code = $1,
          published_signal_id = $2,
          completed_at_ms = COALESCE(completed_at_ms, $3),
          updated_at_ms = $4
        WHERE idempotency_key = $5
          AND routine_run_id IS NOT NULL
          AND status IN ('flag_rejected', 'worker_unavailable', 'failed')
          AND published_signal_id IS NULL
      `,
    values: [
      input.failureCode,
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
    ],
  });
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}
export async function markRemoteAgentNativeDeliveryCompleted(input: {
  db: PostgresDatabase;
  nowMs: number;
  submissionId: string;
  publishedSignalId: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = 'completed',
          published_signal_id = $1,
          worker_submit_request_json = NULL,
          callback_received_at_ms = $2,
          completed_at_ms = $3,
          updated_at_ms = $4
        WHERE submission_id = $5
          AND status IN ('accepted', 'retry_observed')
      `,
    values: [
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
    ],
  });
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
export async function markRemoteAgentNativeDeliveryIntermediateTerminal(input: {
  db: PostgresDatabase;
  failureCode: string | null;
  failureDetail: string | null;
  nowMs: number;
  submissionId: string;
  status: "completed" | "failed";
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = $1,
          failure_code = $2,
          failure_detail = $3,
          callback_received_at_ms = $4,
          completed_at_ms = $5,
          updated_at_ms = $6
        WHERE submission_id = $7
          AND status IN ('accepted', 'retry_observed')
          AND routine_run_id IS NOT NULL
          AND final_publication_state IS NULL
      `,
    values: [
      input.status,
      input.failureCode,
      input.failureDetail,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
    ],
  });
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}
function mapNativeDeliveryRow(
  row: RemoteAgentNativeDeliveryRow
): RemoteAgentNativeDeliveryRecord {
  const workerSubmitRequest = parseWorkerSubmitRequest(
    row.worker_submit_request_json
  );
  const executionRecoverySubmitRequest = parseWorkerSubmitRequest(
    row.execution_recovery_submit_request_json
  );
  const conversationKind = parseRemoteAgentNativeDeliveryConversationKind(
    row.conversation_kind
  );
  const messageChannelLocator = parseDurableMessageChannelLocator(
    row,
    conversationKind
  );
  return {
    anonymousMemberSpeaker: parseAnonymousMemberSpeaker(
      row.anonymous_member_speaker_json
    ),
    deliveryId: row.delivery_id,
    organizationId: row.organization_id,
    conversationKind,
    spaceId: row.space_id,
    profileId: row.profile_id,
    bindingId: row.binding_id,
    controllerNormalizationSnapshot:
      (row.controller_stored_agent_controller_ref_status === "canonical" ||
        row.controller_stored_agent_controller_ref_status === "malformed" ||
        row.controller_stored_agent_controller_ref_status === "stale") &&
      row.controller_binding_updated_at_ms !== null
        ? {
            bindingUpdatedAtMs: row.controller_binding_updated_at_ms,
            storedAgentControllerRef:
              row.controller_stored_agent_controller_ref,
            storedAgentControllerRefStatus:
              row.controller_stored_agent_controller_ref_status,
          }
        : null,
    triggerMessageId: row.trigger_message_id,
    sourceClientMessageId: row.source_client_message_id ?? null,
    triggerText: row.trigger_text,
    routineRunId: row.routine_run_id,
    routineNameSnapshot: row.routine_name_snapshot,
    workerSubmitRequest: workerSubmitRequest.request,
    workerSubmitRequestState: workerSubmitRequest.state,
    executionRecoverySubmitRequest: executionRecoverySubmitRequest.request,
    dispatchId: row.dispatch_id,
    attemptId: row.attempt_id,
    idempotencyKey: row.idempotency_key,
    submissionId: row.submission_id,
    workerRequestId: row.worker_request_id,
    status: row.status,
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,
    onBehalfOfProfileId: row.on_behalf_of_profile_id,
    onBehalfOfUserId: row.on_behalf_of_user_id,
    onBehalfOfDisplayName: row.on_behalf_of_display_name,
    threadContext: parseThreadContext(row.thread_context_json),
    slackTeamId: row.slack_team_id,
    slackChannelId: row.slack_channel_id,
    slackThreadTs: row.slack_thread_ts,
    slackWorkingStatusTurnId: row.slack_working_status_turn_id,
    messageChannelLocator,
    providerPublicationIdempotencyKey: row.provider_publication_idempotency_key,
    providerPublicationResultId: row.provider_publication_result_id,
    providerProgressState: parseRemoteAgentProviderProgressState(
      row.provider_progress_state
    ),
    providerProgressClaimId: row.provider_progress_claim_id,
    providerProgressClaimedAtMs: row.provider_progress_claimed_at_ms,
    providerProgressClaimExpiresAtMs: row.provider_progress_claim_expires_at_ms,
    providerProgressCardId: row.provider_progress_card_id,
    providerProgressCardHistory: parseMessageChannelCardHistory(
      row.provider_progress_card_history_json
    ),
    providerProgressMessageId: row.provider_progress_message_id,
    providerProgressPublicationIdempotencyKey:
      row.provider_progress_publication_idempotency_key,
    providerProgressSequence: row.provider_progress_sequence,
    providerProgressPendingSequence: row.provider_progress_pending_sequence,
    providerProgressSourceOffset: parseNonnegativeProviderProgressInteger(
      row.provider_progress_source_offset,
      "source offset"
    ),
    providerProgressRolloverIndex: parseNonnegativeProviderProgressInteger(
      row.provider_progress_rollover_index,
      "rollover index"
    ),
    providerProgressPendingSourceOffset:
      row.provider_progress_pending_source_offset === null
        ? null
        : parseNonnegativeProviderProgressInteger(
            row.provider_progress_pending_source_offset,
            "pending source offset"
          ),
    providerProgressPendingTextHash: row.provider_progress_pending_text_hash,
    providerProgressPendingCardId: row.provider_progress_pending_card_id,
    providerProgressFailureCode: row.provider_progress_failure_code,
    finalPublicationState: parseRemoteAgentFinalPublicationState(
      row.final_publication_state
    ),
    finalPublicationClaimId: row.final_publication_claim_id,
    finalPublicationClaimedAtMs: row.final_publication_claimed_at_ms,
    finalPublicationClaimExpiresAtMs: row.final_publication_claim_expires_at_ms,
    finalPublicationPayload: parseFinalPublicationPayload(
      row.final_publication_payload_json
    ),
    finalPublicationAttemptCount: parseNonnegativeProviderProgressInteger(
      row.final_publication_attempt_count,
      "final publication attempt count"
    ),
    finalPublicationAmbiguityDeadlineAtMs:
      row.final_publication_ambiguity_deadline_at_ms,
    finalPublicationNextAttemptAtMs: row.final_publication_next_attempt_at_ms,
    finalPublicationProviderProgressSequence:
      row.final_publication_provider_progress_sequence,
    publishedSignalId: row.published_signal_id,
    executionEvidenceAtMs: row.execution_evidence_at_ms,
    executionEvidenceSequence: row.execution_evidence_sequence,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    submittedAtMs: row.submitted_at_ms,
    admissionAttemptCount: row.admission_attempt_count,
    admissionRetryDueAtMs: row.admission_retry_due_at_ms,
    acceptedAtMs: row.accepted_at_ms,
    callbackReceivedAtMs: row.callback_received_at_ms,
    completedAtMs: row.completed_at_ms,
    deadlineProbeEnqueuedAtMs: row.deadline_probe_enqueued_at_ms,
    acceptedProbeNextDueAtMs: row.accepted_probe_next_due_at_ms,
    executionReconciliation: parseExecutionReconciliation(
      row.execution_reconciliation_json
    ),
    retiredDeadlineFailureCode: row.retired_deadline_failure_code,
    retiredDeadlineFailurePublishedSignalId:
      row.retired_deadline_failure_published_signal_id,
    retiredDeadlineFailureReconciledAtMs:
      row.retired_deadline_failure_reconciled_at_ms,
  };
}
function resolveMessageChannelStorage(input: {
  conversationKind: RemoteAgentNativeDeliveryConversationKind;
  locator: MessageChannelConversationLocator | null;
  providerPublicationIdempotencyKey: string | null;
  slackChannelId: string | null;
  slackTeamId: string | null;
  slackThreadTs: string | null;
}): {
  connectionId: string | null;
  locatorJson: string | null;
  provider: MessageChannelConversationLocator["provider"] | null;
  providerPublicationIdempotencyKey: string | null;
} {
  if (input.conversationKind !== "message_channel") {
    if (
      input.locator !== null ||
      input.providerPublicationIdempotencyKey !== null
    ) {
      throw new Error(
        "Only Message Channel deliveries may persist a typed conversation locator"
      );
    }
    return {
      connectionId: null,
      locatorJson: null,
      provider: null,
      providerPublicationIdempotencyKey: null,
    };
  }
  if (!input.locator) {
    throw new Error(
      "Message Channel delivery requires a typed conversation locator"
    );
  }
  if (
    input.slackChannelId !== null ||
    input.slackTeamId !== null ||
    input.slackThreadTs !== null
  ) {
    throw new Error(
      "Message Channel delivery must not dual-write legacy Slack locator columns"
    );
  }
  const locator = messageChannelConversationLocatorSchema.parse(input.locator);
  const providerPublicationIdempotencyKey =
    input.providerPublicationIdempotencyKey?.trim();
  if (!providerPublicationIdempotencyKey) {
    throw new Error(
      "Message Channel delivery requires a provider publication idempotency key"
    );
  }
  return {
    connectionId: locator.connectionId,
    locatorJson: JSON.stringify(locator),
    provider: locator.provider,
    providerPublicationIdempotencyKey,
  };
}
function parseDurableMessageChannelLocator(
  row: RemoteAgentNativeDeliveryRow,
  conversationKind: RemoteAgentNativeDeliveryConversationKind
): MessageChannelConversationLocator | null {
  if (row.message_channel_locator_json !== null) {
    if (conversationKind !== "message_channel") {
      throw new Error(
        "Remote Agent native delivery has a typed locator for a non-Message Channel conversation"
      );
    }
    const parsed = parseMessageChannelLocatorJson(
      row.message_channel_locator_json
    );
    if (
      parsed.provider !== row.message_channel_provider ||
      parsed.connectionId !== row.message_channel_connection_id
    ) {
      throw new Error(
        "Remote Agent native delivery has an invalid durable Message Channel locator projection"
      );
    }
    if (
      !row.provider_publication_idempotency_key ||
      row.provider_publication_idempotency_key.trim() !==
        row.provider_publication_idempotency_key
    ) {
      throw new Error(
        "Remote Agent native delivery has an invalid provider publication identity"
      );
    }
    return parsed;
  }
  if (
    row.message_channel_provider !== null ||
    row.message_channel_connection_id !== null ||
    row.provider_publication_idempotency_key !== null ||
    row.provider_publication_result_id !== null
  ) {
    throw new Error(
      "Remote Agent native delivery has an incomplete durable Message Channel locator"
    );
  }
  if (conversationKind === "message_channel") {
    throw new Error(
      "Remote Agent native delivery has an invalid durable Message Channel locator"
    );
  }
  if (conversationKind === "slack") {
    if (!(row.slack_team_id && row.slack_channel_id && row.slack_thread_ts)) {
      throw new Error(
        "Remote Agent native delivery has an incomplete legacy Slack locator"
      );
    }
    return messageChannelConversationLocatorSchema.parse({
      provider: "slack",
      connectionId: row.slack_team_id,
      teamId: row.slack_team_id,
      channelId: row.slack_channel_id,
      rootMessageId: row.slack_thread_ts,
    });
  }
  return null;
}
function parseRemoteAgentNativeDeliveryConversationKind(
  value: string | null
): RemoteAgentNativeDeliveryConversationKind {
  if (value === "message_channel" || value === "slack" || value === "space") {
    return value;
  }
  throw new Error(
    "Remote Agent native delivery has an invalid conversation kind"
  );
}
function parseMessageChannelLocatorJson(
  value: string
): MessageChannelConversationLocator {
  try {
    return messageChannelConversationLocatorSchema.parse(JSON.parse(value));
  } catch {
    throw new Error(
      "Remote Agent native delivery has an invalid durable Message Channel locator"
    );
  }
}
function serializeThreadContext(
  threadContext: SpaceThreadContext | null
): string | null {
  return threadContext ? JSON.stringify(threadContext) : null;
}
function parseThreadContext(value: string | null): SpaceThreadContext | null {
  if (!value) {
    return null;
  }
  try {
    const parsedJson = JSON.parse(value) as unknown;
    const parsed = spaceThreadContextSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function parseWorkerSubmitRequest(value: string | null): {
  request: RemoteAgentWorkerSubmitTurnRequest | null;
  state: RemoteAgentWorkerSubmitRequestState;
} {
  if (value === null) {
    return { request: null, state: "absent" };
  }
  try {
    const parsedJson = JSON.parse(value) as unknown;
    if (isVersionedWorkerSubmitRequest(parsedJson)) {
      const parsedRequest = remoteAgentWorkerSubmitTurnRequestSchema.safeParse(
        parsedJson.request
      );
      return parsedRequest.success
        ? { request: parsedRequest.data, state: "valid" }
        : { request: null, state: "invalid" };
    }
    if (hasWorkerSubmitRequestStorageVersion(parsedJson)) {
      return { request: null, state: "invalid" };
    }
    const legacyRequest =
      remoteAgentWorkerSubmitTurnRequestSchema.safeParse(parsedJson);
    return legacyRequest.success
      ? { request: legacyRequest.data, state: "valid" }
      : { request: null, state: "invalid" };
  } catch {
    return { request: null, state: "invalid" };
  }
}
function resolveAnonymousMemberSpeaker(
  request: RemoteAgentWorkerSubmitTurnRequest
): CenterAgentAnonymousMemberToolSpeaker | null {
  const sender = request.turnEnvelope.sender;
  if (
    sender.kind !== "member" ||
    sender.verified ||
    !sender.messageChannelIdentity
  ) {
    return null;
  }
  return centerAgentAnonymousMemberToolSpeakerSchema.parse({
    displayName: sender.displayName,
    kind: "anonymous_member",
    messageChannelIdentity: sender.messageChannelIdentity,
  });
}
function parseAnonymousMemberSpeaker(
  value: string | null
): CenterAgentAnonymousMemberToolSpeaker | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = centerAgentAnonymousMemberToolSpeakerSchema.safeParse(
      JSON.parse(value)
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function sameAnonymousMemberSpeaker(
  left: CenterAgentAnonymousMemberToolSpeaker | null,
  right: CenterAgentAnonymousMemberToolSpeaker | null
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function serializeWorkerSubmitRequest(
  request: RemoteAgentWorkerSubmitTurnRequest
): string {
  return JSON.stringify({
    request: remoteAgentWorkerSubmitTurnRequestSchema.parse(request),
    storageVersion: REMOTE_AGENT_WORKER_SUBMIT_REQUEST_STORAGE_VERSION,
  });
}
function isVersionedWorkerSubmitRequest(value: unknown): value is {
  request: unknown;
  storageVersion: 1;
} {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.storageVersion ===
      REMOTE_AGENT_WORKER_SUBMIT_REQUEST_STORAGE_VERSION &&
    "request" in record &&
    Object.keys(record).length === 2
  );
}
function hasWorkerSubmitRequestStorageVersion(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "storageVersion" in value
  );
}
function didPostgresWrite(result: QueryResult): boolean {
  return Number(result.rowCount ?? 0) > 0;
}
function parseRemoteAgentFinalPublicationState(
  value: string | null
): RemoteAgentFinalPublicationState | null {
  if (value === null) {
    return null;
  }
  if (
    value === "claimed" ||
    value === "outcome_unknown" ||
    value === "published"
  ) {
    return value;
  }
  throw new Error(`Invalid Remote Agent final publication state: ${value}`);
}
function parseFinalPublicationPayload(
  value: string | null
): RemoteAgentFinalPublicationPayload | null {
  if (value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "Remote Agent Native Delivery has an invalid final publication payload"
    );
  }
  if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
    throw new Error(
      "Remote Agent Native Delivery has an invalid final publication payload"
    );
  }
  const record = parsed as Record<string, unknown>;
  const failureCode = record.failureCode;
  const failureDetail = record.failureDetail;
  const resumeStatus = record.resumeStatus;
  const text = record.text;
  const commonValid =
    typeof text === "string" &&
    (resumeStatus === "accepted" || resumeStatus === "retry_observed") &&
    isNullableString(failureCode) &&
    isNullableString(failureDetail) &&
    !(failureDetail !== null && failureCode === null);
  if (!commonValid) {
    throw new Error(
      "Remote Agent Native Delivery has an invalid final publication payload"
    );
  }
  if (
    record.storageVersion ===
      REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_PAYLOAD_STORAGE_VERSION &&
    Object.keys(record).length === 5
  ) {
    return {
      failureCode,
      failureDetail,
      resumeStatus,
      storageVersion: 1,
      text,
    };
  }
  const attachments = spaceMessageAttachmentsSchema.safeParse(
    record.attachments
  );
  if (record.storageVersion === 3) {
    const files = spaceMessageFileReferencesSchema.safeParse(record.files);
    const reviewedFailureExplanation = record.reviewedFailureExplanation;
    const reviewedFailureExplanationValid =
      reviewedFailureExplanation === undefined ||
      reviewedFailureExplanation === true;
    if (
      !(
        attachments.success &&
        files.success &&
        reviewedFailureExplanationValid &&
        Object.keys(record).length ===
          7 + Number(reviewedFailureExplanation === true)
      )
    ) {
      throw new Error(
        "Remote Agent Native Delivery has an invalid final publication payload"
      );
    }
    return {
      attachments: attachments.data,
      failureCode,
      failureDetail,
      files: files.data,
      ...(reviewedFailureExplanation === true
        ? { reviewedFailureExplanation }
        : {}),
      resumeStatus,
      storageVersion: 3,
      text,
    };
  }
  if (
    record.storageVersion !== 2 ||
    !attachments.success ||
    Object.keys(record).length !== 6
  ) {
    throw new Error(
      "Remote Agent Native Delivery has an invalid final publication payload"
    );
  }
  return {
    attachments: attachments.data,
    failureCode,
    failureDetail,
    resumeStatus,
    storageVersion: 2,
    text,
  };
}
function serializeFinalPublicationPayload(
  payload: RemoteAgentFinalPublicationPayload | null
): string {
  if (payload === null) {
    throw new Error(
      "Remote Agent Native Delivery final publication payload is missing"
    );
  }
  return JSON.stringify(parseFinalPublicationPayload(JSON.stringify(payload)));
}
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function parseRemoteAgentProviderProgressState(
  value: string | null
): RemoteAgentProviderProgressState | null {
  if (value === null) {
    return null;
  }
  if (
    value === "create_claimed" ||
    value === "create_outcome_unknown" ||
    value === "created" ||
    value === "send_claimed" ||
    value === "send_outcome_unknown" ||
    value === "sent" ||
    value === "update_claimed" ||
    value === "rollover_finalize_claimed" ||
    value === "rollover_finalized" ||
    value === "rollover_create_claimed" ||
    value === "rollover_created" ||
    value === "rollover_send_claimed" ||
    value === "rollover_send_outcome_unknown" ||
    value === "unavailable" ||
    value === "finalized"
  ) {
    return value;
  }
  throw new Error(`Invalid Remote Agent provider progress state: ${value}`);
}
function parseNonnegativeProviderProgressInteger(
  value: number,
  field: string
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Invalid Remote Agent provider progress ${field}: ${value}`
    );
  }
  return value;
}
function parseSlackConversationId(value: string): {
  channelId: string;
  teamId: string;
  threadTs: string;
} | null {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "slack") {
    return null;
  }
  const [, teamId, channelId, threadTs] = parts;
  if (!(teamId && channelId && threadTs)) {
    return null;
  }
  return { channelId, teamId, threadTs };
}
