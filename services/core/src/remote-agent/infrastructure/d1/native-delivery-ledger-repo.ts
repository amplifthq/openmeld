import {
  CENTER_AGENT_TURN_DIAGNOSTIC_FAILURE_DETAIL_MAX_CHARS,
  centerAgentAnonymousMemberToolSpeakerSchema,
  messageChannelConversationLocatorSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
  spaceMessageAttachmentsSchema,
  spaceMessageFileReferencesSchema,
  spaceThreadContextSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAnonymousMemberToolSpeaker,
  CenterAgentTurnDiagnostic,
  MessageChannelConversationLocator,
  RemoteAgentWorkerSubmitTurnRequest,
  RemoteAgentWorkLoopCheckpoint,
  SpaceMessageAttachment,
  SpaceMessageFileReference,
  SpaceThreadContext,
} from "@openmeld/schemas/types";

export type RemoteAgentNativeDeliveryConversationKind =
  | "message_channel"
  | "slack"
  | "space";
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

function normalizeD1OptionalText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function normalizeD1TimestampMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

function parseActiveRemoteAgentNativeDeliveryWakeProgressRow(
  row: ActiveRemoteAgentNativeDeliveryWakeProgressRow
): ActiveRemoteAgentNativeDeliveryWakeProgressEvidence | null {
  const dispatchId = normalizeD1OptionalText(row.dispatch_id);
  const targetProfileId = normalizeD1OptionalText(row.target_profile_id);
  const updatedAtMs = normalizeD1TimestampMs(row.updated_at_ms);
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
    clientMessageId: normalizeD1OptionalText(row.source_client_message_id),
    dispatchId,
    failureReasonCode: normalizeD1OptionalText(row.failure_reason_code),
    phase,
    sourceSignalId: normalizeD1OptionalText(row.trigger_message_id),
    startedAtMs: normalizeD1TimestampMs(row.started_at_ms),
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
  accepted_at_ms: number | null;
  callback_received_at_ms: number | null;
  completed_at_ms: number | null;
  deadline_probe_enqueued_at_ms: number | null;
  accepted_probe_next_due_at_ms: number | null;
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
    accepted_at_ms,
    callback_received_at_ms,
    completed_at_ms,
    deadline_probe_enqueued_at_ms,
    accepted_probe_next_due_at_ms,
    retired_deadline_failure_code,
    retired_deadline_failure_published_signal_id,
    retired_deadline_failure_reconciled_at_ms
  FROM openMeldRemoteAgent_native_delivery_ledger
`;

export async function listActiveRemoteAgentNativeDeliveryWakeProgressEvidenceBySpace(input: {
  db: D1Database;
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
  const whereTargetSql = targetProfileId ? "AND deliveries.profile_id = ?" : "";
  let whereSourceSql = "";
  let sourceBindings: string[] = [];
  if (sourceProfileId) {
    whereSourceSql = `AND (
        deliveries.on_behalf_of_profile_id = ?
        OR (
          deliveries.on_behalf_of_profile_id IS NULL
          AND deliveries.dispatch_id IN (SELECT value FROM json_each(?))
        )
      )`;
    sourceBindings = [sourceProfileId, JSON.stringify(sourceDispatchIds ?? [])];
  } else if (sourceDispatchIds) {
    whereSourceSql =
      "AND deliveries.dispatch_id IN (SELECT value FROM json_each(?))";
    sourceBindings = [JSON.stringify(sourceDispatchIds)];
  }
  const bindings = [
    input.spaceId,
    ...(targetProfileId ? [targetProfileId] : []),
    ...sourceBindings,
    limit,
  ];
  const rows = await input.db
    .prepare(
      `
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
        FROM openMeldRemoteAgent_native_delivery_ledger AS deliveries
        WHERE deliveries.conversation_kind = 'space'
          AND deliveries.space_id = ?
          AND deliveries.routine_run_id IS NULL
          AND deliveries.status IN ('accepted', 'retry_observed')
          ${whereTargetSql}
          ${whereSourceSql}
        ORDER BY deliveries.updated_at_ms DESC, deliveries.delivery_id DESC
        LIMIT ?
      `
    )
    .bind(...bindings)
    .all<ActiveRemoteAgentNativeDeliveryWakeProgressRow>();

  return rows.results.flatMap((row) => {
    const evidence = parseActiveRemoteAgentNativeDeliveryWakeProgressRow(row);
    return evidence ? [evidence] : [];
  });
}

export async function isLatestRemoteAgentNativeDeliveryActiveForSlackThread(input: {
  channelId: string;
  db: D1Database;
  organizationId: string;
  teamId: string;
  threadTs: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        WITH scoped_deliveries AS (
          SELECT
            delivery_id,
            idempotency_key,
            trigger_message_id,
            slack_working_status_turn_id,
            status,
            final_publication_state,
            created_at_ms
          FROM openMeldRemoteAgent_native_delivery_ledger
          WHERE conversation_kind = 'slack'
            AND organization_id = ?
            AND slack_team_id = ?
            AND slack_channel_id = ?
            AND slack_thread_ts = ?
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
          ORDER BY trigger_message_id DESC, created_at_ms DESC, delivery_id DESC
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
      `
    )
    .bind(input.organizationId, input.teamId, input.channelId, input.threadTs)
    .first<{ active: number; ambiguous: number }>();
  if (row?.ambiguous === 1) {
    throw new Error(
      "Slack working-status turn lineage is ambiguous for the latest trigger"
    );
  }
  return row?.active === 1;
}

// Keeps every chunked statement within D1's bound-parameter limit (100):
// chunk spaceIds + the two active statuses + freshAfterMs.
const ACTIVE_COUNT_SPACE_ID_CHUNK_SIZE = 80;

export type ActiveRemoteAgentNativeDeliveryTargetCount = {
  activeWakeCount: number;
  spaceId: string;
  targetProfileId: string;
};

export async function listActiveRemoteAgentNativeDeliveryTargetsBySpaceIds(input: {
  db: D1Database;
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
    const spacePlaceholders = chunk.map(() => "?").join(", ");
    const rows = await input.db
      .prepare(
        `
          SELECT space_id, profile_id, COUNT(*) AS active_count
          FROM openMeldRemoteAgent_native_delivery_ledger
          WHERE conversation_kind = 'space'
            AND routine_run_id IS NULL
            AND status IN ('accepted', 'retry_observed')
            AND space_id IN (${spacePlaceholders})
            AND execution_evidence_at_ms >= ?
          GROUP BY space_id, profile_id
        `
      )
      .bind(...chunk, input.freshAfterMs)
      .all<{
        active_count?: unknown;
        profile_id?: unknown;
        space_id?: unknown;
      }>();
    for (const row of rows.results ?? []) {
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
  db: D1Database;
  limit?: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 100)));
  const rows = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
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
                FROM inbox_items
                WHERE inbox_items.organization_id = openMeldRemoteAgent_native_delivery_ledger.organization_id
                  AND inbox_items.recipient_user_id = openMeldRemoteAgent_native_delivery_ledger.on_behalf_of_user_id
                  AND inbox_items.source_kind = 'remote_agent_native_delivery'
                  AND inbox_items.source_key = openMeldRemoteAgent_native_delivery_ledger.delivery_id || ':publication_unknown'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM inbox_items
                WHERE inbox_items.organization_id = openMeldRemoteAgent_native_delivery_ledger.organization_id
                  AND inbox_items.recipient_user_id = openMeldRemoteAgent_native_delivery_ledger.on_behalf_of_user_id
                  AND inbox_items.source_kind = 'remote_agent_native_delivery'
                  AND inbox_items.source_key = openMeldRemoteAgent_native_delivery_ledger.delivery_id || ':terminal'
              )
            )
            OR (
              coalesce(final_publication_state, '') <> 'outcome_unknown'
              AND (
                NOT EXISTS (
                  SELECT 1
                  FROM inbox_items
                  WHERE inbox_items.organization_id = openMeldRemoteAgent_native_delivery_ledger.organization_id
                    AND inbox_items.recipient_user_id = openMeldRemoteAgent_native_delivery_ledger.on_behalf_of_user_id
                    AND inbox_items.source_kind = 'remote_agent_native_delivery'
                    AND inbox_items.source_key = openMeldRemoteAgent_native_delivery_ledger.delivery_id || ':terminal'
                )
                OR EXISTS (
                  SELECT 1
                  FROM inbox_items
                  WHERE inbox_items.organization_id = openMeldRemoteAgent_native_delivery_ledger.organization_id
                    AND inbox_items.recipient_user_id = openMeldRemoteAgent_native_delivery_ledger.on_behalf_of_user_id
                    AND inbox_items.source_kind = 'remote_agent_native_delivery'
                    AND inbox_items.source_key = openMeldRemoteAgent_native_delivery_ledger.delivery_id || ':publication_unknown'
                    AND inbox_items.attention = 'action_required'
                    AND inbox_items.resolution_status = 'open'
                )
              )
            )
            OR EXISTS (
              SELECT 1
              FROM inbox_items
              WHERE inbox_items.organization_id = openMeldRemoteAgent_native_delivery_ledger.organization_id
                AND inbox_items.recipient_user_id = openMeldRemoteAgent_native_delivery_ledger.on_behalf_of_user_id
                AND inbox_items.source_kind = 'remote_agent_native_delivery'
                AND inbox_items.source_key IN (
                  openMeldRemoteAgent_native_delivery_ledger.delivery_id || ':publication_unknown',
                  openMeldRemoteAgent_native_delivery_ledger.delivery_id || ':terminal'
                )
                AND inbox_items.source_target_json = ?
            )
          )
        ORDER BY
          inbox_projection_attempted_at_ms ASC,
          updated_at_ms ASC,
          delivery_id ASC
        LIMIT ?
      `
    )
    .bind(JSON.stringify({ kind: "center_agent" }), limit)
    .all<RemoteAgentNativeDeliveryRow>();
  return rows.results.map(mapNativeDeliveryRow);
}

export async function markLinkedSlackNativeDeliveryInboxProjectionAttempted(input: {
  db: D1Database;
  deliveryId: string;
  nowMs: number;
}): Promise<void> {
  if (!(Number.isSafeInteger(input.nowMs) && input.nowMs >= 0)) {
    throw new TypeError("nowMs must be a non-negative safe integer");
  }
  if (!input.deliveryId.trim()) {
    throw new TypeError("deliveryId must be a non-empty identifier");
  }
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET inbox_projection_attempted_at_ms = ?
        WHERE delivery_id = ?
          AND conversation_kind = 'slack'
          AND inbox_projection_suppressed_at_ms IS NULL
      `
    )
    .bind(input.nowMs, input.deliveryId)
    .run();
}

export async function suppressLinkedSlackNativeDeliveryInboxProjectionIfRecipientMissing(input: {
  db: D1Database;
  deliveryId: string;
  nowMs: number;
  recipientUserId: string;
}): Promise<boolean> {
  if (!(Number.isSafeInteger(input.nowMs) && input.nowMs >= 0)) {
    throw new TypeError("nowMs must be a non-negative safe integer");
  }
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          inbox_projection_suppressed_reason = 'recipient_not_found',
          inbox_projection_suppressed_at_ms = ?
        WHERE delivery_id = ?
          AND conversation_kind = 'slack'
          AND on_behalf_of_user_id = ?
          AND inbox_projection_suppressed_at_ms IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM users
            WHERE users.id = openMeldRemoteAgent_native_delivery_ledger.on_behalf_of_user_id
          )
      `
    )
    .bind(input.nowMs, input.deliveryId, input.recipientUserId)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
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
  db: D1Database;
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
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET slack_working_status_turn_id = ?
        WHERE conversation_kind = 'slack'
          AND organization_id = ?
          AND slack_team_id = ?
          AND slack_channel_id = ?
          AND slack_thread_ts = ?
          AND trigger_message_id = ?
          AND substr(idempotency_key, 1, length(?) + 1) = ? || ':'
          AND slack_working_status_turn_id IS NULL
      `
    )
    .bind(
      input.slackWorkingStatusTurnId,
      input.record.organizationId,
      input.record.slackTeamId,
      input.record.slackChannelId,
      input.record.slackThreadTs,
      input.record.triggerMessageId,
      input.slackWorkingStatusTurnId,
      input.slackWorkingStatusTurnId
    )
    .run();
}

export async function upsertRemoteAgentNativeDeliveryRecord(input: {
  db: D1Database;
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
  await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
      `
    )
    .bind(
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
      resolveRemoteAgentNativeDeliverySubmittedAtMs(input.status, input.nowMs)
    )
    .run();

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
      `Remote Agent native delivery immutable admission identity conflict: ${mismatchedFields.join(
        ", "
      )}`
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
  db: D1Database;
  displayName: string;
  idempotencyKey: string;
  nowMs: number;
  profileId: string;
  userId: string;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          on_behalf_of_profile_id = ?,
          on_behalf_of_user_id = ?,
          on_behalf_of_display_name = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND status = 'submitted'
          AND (
            on_behalf_of_profile_id IS NULL
            OR on_behalf_of_profile_id = ?
          )
          AND (
            on_behalf_of_user_id IS NULL
            OR on_behalf_of_user_id = ?
          )
      `
    )
    .bind(
      input.profileId,
      input.userId,
      input.displayName,
      input.nowMs,
      input.idempotencyKey,
      input.profileId,
      input.userId
    )
    .run();
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
  db: D1Database;
  nextDeliveryId: string;
  organizationId: string;
  previousDeliveryId: string;
  runId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET native_delivery_id = ?
        WHERE id = ?
          AND organization_id = ?
          AND status = 'submitted'
          AND native_delivery_id = ?
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE delivery_id = ?
              AND organization_id = ?
              AND routine_run_id = ?
              AND status IN ('submitted', 'accepted', 'retry_observed')
          )
      `
    )
    .bind(
      input.nextDeliveryId,
      input.runId,
      input.organizationId,
      input.previousDeliveryId,
      input.nextDeliveryId,
      input.organizationId,
      input.runId
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function clearPreviousRoutineWorkerSubmitRequest(input: {
  db: D1Database;
  nextDeliveryId: string;
  nowMs: number;
  organizationId: string;
  previousDeliveryId: string;
  runId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          worker_submit_request_json = NULL,
          updated_at_ms = ?
        WHERE delivery_id = ?
          AND organization_id = ?
          AND routine_run_id = ?
          AND status IN ('completed', 'failed')
          AND EXISTS (
            SELECT 1
            FROM routine_runs
            WHERE id = ?
              AND organization_id = ?
              AND status = 'submitted'
              AND native_delivery_id = ?
          )
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE delivery_id = ?
              AND organization_id = ?
              AND routine_run_id = ?
              AND worker_submit_request_json IS NOT NULL
          )
      `
    )
    .bind(
      input.nowMs,
      input.previousDeliveryId,
      input.organizationId,
      input.runId,
      input.runId,
      input.organizationId,
      input.nextDeliveryId,
      input.nextDeliveryId,
      input.organizationId,
      input.runId
    )
    .run();
}

export async function persistRemoteAgentWorkerSubmitRequest(input: {
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const workerSubmitRequest = remoteAgentWorkerSubmitTurnRequestSchema.parse(
    input.workerSubmitRequest
  );
  const anonymousMemberSpeaker =
    resolveAnonymousMemberSpeaker(workerSubmitRequest);
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          anonymous_member_speaker_json = COALESCE(
            anonymous_member_speaker_json,
            ?
          ),
          worker_submit_request_json = COALESCE(
            worker_submit_request_json,
            ?
          ),
          execution_recovery_submit_request_json = COALESCE(
            execution_recovery_submit_request_json,
            ?
          ),
          updated_at_ms = CASE
            WHEN worker_submit_request_json IS NULL
              OR execution_recovery_submit_request_json IS NULL
            THEN ?
            ELSE updated_at_ms
          END
        WHERE idempotency_key = ?
          AND status = 'submitted'
          AND submission_id IS NULL
      `
    )
    .bind(
      anonymousMemberSpeaker ? JSON.stringify(anonymousMemberSpeaker) : null,
      serializeWorkerSubmitRequest(workerSubmitRequest),
      serializeWorkerSubmitRequest(workerSubmitRequest),
      input.nowMs,
      input.idempotencyKey
    )
    .run();

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
  return record;
}

export async function readRemoteAgentWorkLoopAttemptByCallbackIdentity(input: {
  db: D1Database;
  idempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentWorkLoopAttemptRecord | null> {
  const row = await input.db
    .prepare(
      `
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
        FROM openMeldRemoteAgent_work_loop_attempts
        WHERE idempotency_key = ?
          AND submission_id = ?
        LIMIT 1
      `
    )
    .bind(input.idempotencyKey, input.submissionId)
    .first<{
      attempt: number;
      checkpoint_reason: string;
      continued_at_ms: number;
      delivery_id: string;
      idempotency_key: string;
      next_idempotency_key: string;
      submission_id: string;
      tool_call_limit: number;
      worker_submit_request_json: string;
    }>();
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

export async function countRemoteAgentWorkLoopAttempts(input: {
  db: D1Database;
  deliveryId: string;
}): Promise<number> {
  const row = await input.db
    .prepare(
      `
        SELECT COUNT(*) AS attempt_count
        FROM openMeldRemoteAgent_work_loop_attempts
        WHERE delivery_id = ?
      `
    )
    .bind(input.deliveryId)
    .first<{ attempt_count: number }>();
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
  db: D1Database;
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
  const [archiveResult, rearmResult] = await input.db.batch([
    input.db
      .prepare(
        `
          INSERT INTO openMeldRemoteAgent_work_loop_attempts (
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
            ?,
            idempotency_key,
            submission_id,
            execution_recovery_submit_request_json,
            ?,
            ?,
            ?,
            ?
          FROM openMeldRemoteAgent_native_delivery_ledger
          WHERE delivery_id = ?
            AND idempotency_key = ?
            AND submission_id = ?
            AND status IN ('accepted', 'retry_observed')
            AND execution_recovery_submit_request_json IS NOT NULL
            AND final_publication_state IS NULL
        `
      )
      .bind(
        input.attempt,
        checkpoint.reason,
        checkpoint.toolCallLimit,
        input.nextIdempotencyKey,
        input.nowMs,
        input.delivery.deliveryId,
        input.delivery.idempotencyKey,
        previousSubmissionId
      ),
    input.db
      .prepare(
        `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            idempotency_key = ?,
            submission_id = NULL,
            worker_request_id = NULL,
            status = 'submitted',
            failure_code = NULL,
            failure_detail = NULL,
            worker_submit_request_json = ?,
            execution_recovery_submit_request_json = ?,
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
            provider_progress_pending_text_hash = NULL,
            provider_progress_pending_card_id = NULL,
            provider_progress_failure_code = NULL,
            execution_evidence_at_ms = NULL,
            execution_evidence_sequence = NULL,
            submitted_at_ms = ?,
            accepted_at_ms = NULL,
            callback_received_at_ms = NULL,
            completed_at_ms = NULL,
            deadline_probe_enqueued_at_ms = NULL,
            accepted_probe_next_due_at_ms = NULL,
            updated_at_ms = ?
          WHERE delivery_id = ?
            AND idempotency_key = ?
            AND submission_id = ?
            AND status IN ('accepted', 'retry_observed')
            AND final_publication_state IS NULL
            AND (
              conversation_kind <> 'message_channel'
              OR provider_progress_state IN ('sent', 'unavailable')
            )
        `
      )
      .bind(
        input.nextIdempotencyKey,
        serializeWorkerSubmitRequest(nextWorkerSubmitRequest),
        serializeWorkerSubmitRequest(nextWorkerSubmitRequest),
        input.nowMs,
        input.nowMs,
        input.delivery.deliveryId,
        input.delivery.idempotencyKey,
        previousSubmissionId
      ),
  ]);
  if (
    Number(archiveResult?.meta.changes ?? 0) !== 1 ||
    Number(rearmResult?.meta.changes ?? 0) !== 1
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
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest;
}): Promise<boolean> {
  const serialized = serializeWorkerSubmitRequest(
    remoteAgentWorkerSubmitTurnRequestSchema.parse(input.workerSubmitRequest)
  );
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          worker_submit_request_json = CASE
            WHEN worker_submit_request_json IS NULL THEN NULL
            ELSE ?
          END,
          execution_recovery_submit_request_json = CASE
            WHEN execution_recovery_submit_request_json IS NULL THEN NULL
            ELSE ?
          END,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE idempotency_key = ?
          AND status = 'submitted'
          AND submission_id IS NULL
          AND (
            worker_submit_request_json IS NOT NULL
            OR execution_recovery_submit_request_json IS NOT NULL
          )
      `
    )
    .bind(serialized, serialized, input.nowMs, input.idempotencyKey)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
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
  db: D1Database;
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
  | { delivery: RemoteAgentNativeDeliveryRecord; status: "claimed" }
  | {
      delivery: RemoteAgentNativeDeliveryRecord | null;
      status: "lost_race";
    }
> {
  const deliveryId = crypto.randomUUID();
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
  const submitRun = input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'submitted',
          native_delivery_id = ?
        WHERE id = ?
          AND routine_id = ?
          AND organization_id = ?
          AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot) = ?
          AND status = 'claimed'
          AND native_delivery_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM routines
            WHERE id = ?
              AND organization_id = ?
              AND (
                status = 'enabled'
                OR (schedule_kind = 'once' AND status = 'completed')
              )
          )
      `
    )
    .bind(
      deliveryId,
      input.runId,
      input.routineId,
      input.organizationId,
      input.spaceId,
      input.routineId,
      input.organizationId
    );
  const insertDelivery = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
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
          created_at_ms,
          updated_at_ms,
          submitted_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?,
          'submitted', NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?
        WHERE changes() = 1
      `
    )
    .bind(
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
      input.nowMs,
      input.nowMs,
      input.nowMs
    );

  // D1 batches are sequential and atomic. The immediate changes() guard makes
  // the ledger insert part of the same winning Run transition, so neither row
  // can exist without the other.
  const results = await input.db.batch([submitRun, insertDelivery]);
  const submitted = Number(results[0]?.meta?.changes ?? 0) === 1;
  const inserted = Number(results[1]?.meta?.changes ?? 0) === 1;
  if (submitted !== inserted) {
    throw new Error(
      `Routine Run ${input.runId} and native delivery changed inconsistently`
    );
  }
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
  db: D1Database;
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
  | { delivery: RemoteAgentNativeDeliveryRecord; status: "claimed" }
  | {
      delivery: RemoteAgentNativeDeliveryRecord | null;
      status: "lost_race";
    }
> {
  const deliveryId = crypto.randomUUID();
  const failRun = input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'failed',
          failure_code = ?,
          failure_detail = ?,
          native_delivery_id = ?,
          finished_at_ms = ?
        WHERE id = ?
          AND routine_id = ?
          AND organization_id = ?
          AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot) = ?
          AND status = 'claimed'
          AND native_delivery_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM routines
            WHERE id = ?
              AND organization_id = ?
              AND (
                status = 'enabled'
                OR (schedule_kind = 'once' AND status = 'completed')
              )
          )
      `
    )
    .bind(
      input.failureCode,
      input.failureDetail,
      deliveryId,
      input.nowMs,
      input.runId,
      input.routineId,
      input.organizationId,
      input.spaceId,
      input.routineId,
      input.organizationId
    );
  const insertDelivery = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
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
          created_at_ms,
          updated_at_ms,
          completed_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, NULL, ?, ?,
          ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?
        WHERE changes() = 1
      `
    )
    .bind(
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
      input.nowMs,
      input.nowMs,
      input.nowMs
    );

  const results = await input.db.batch([failRun, insertDelivery]);
  const failed = Number(results[0]?.meta?.changes ?? 0) === 1;
  const inserted = Number(results[1]?.meta?.changes ?? 0) === 1;
  if (failed !== inserted) {
    throw new Error(
      `Routine Run ${input.runId} and admission failure changed inconsistently`
    );
  }
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
  db: D1Database;
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
  const failRun = input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'failed',
          failure_code = ?,
          failure_detail = ?,
          finished_at_ms = ?
        WHERE id = ?
          AND organization_id = ?
          AND native_delivery_id = ?
          AND status = 'submitted'
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE delivery_id = ?
              AND organization_id = ?
              AND routine_run_id = ?
              AND idempotency_key = ?
              AND status = 'submitted'
              AND submission_id IS NULL
          )
      `
    )
    .bind(
      input.failureCode,
      input.failureDetail,
      input.nowMs,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId
    );
  const failDelivery = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = ?,
          failure_code = ?,
          worker_submit_request_json = NULL,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE delivery_id = ?
          AND organization_id = ?
          AND routine_run_id = ?
          AND idempotency_key = ?
          AND status = 'submitted'
          AND submission_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM routine_runs
            WHERE id = ?
              AND organization_id = ?
              AND native_delivery_id = ?
              AND status = 'failed'
              AND failure_code = ?
          )
      `
    )
    .bind(
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
      input.failureCode
    );
  await input.db.batch([failRun, failDelivery]);
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
  db: D1Database;
  deliveryId: string;
  failureCode: string;
  failureDetail: string;
  nowMs: number;
  organizationId: string;
  runId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const skipRun = input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'skipped',
          failure_code = ?,
          failure_detail = ?,
          finished_at_ms = ?
        WHERE id = ?
          AND organization_id = ?
          AND native_delivery_id = ?
          AND status = 'submitted'
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE delivery_id = ?
              AND organization_id = ?
              AND routine_run_id = ?
              AND idempotency_key = ?
              AND status = 'submitted'
              AND submission_id IS NULL
          )
      `
    )
    .bind(
      input.failureCode,
      input.failureDetail,
      input.nowMs,
      input.runId,
      input.organizationId,
      input.deliveryId,
      input.deliveryId,
      input.organizationId,
      input.runId,
      input.runId
    );
  const closeDelivery = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'failed',
          failure_code = ?,
          worker_submit_request_json = NULL,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE delivery_id = ?
          AND organization_id = ?
          AND routine_run_id = ?
          AND idempotency_key = ?
          AND status = 'submitted'
          AND submission_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM routine_runs
            WHERE id = ?
              AND organization_id = ?
              AND native_delivery_id = ?
              AND status = 'skipped'
              AND failure_code = ?
          )
      `
    )
    .bind(
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
      input.failureCode
    );
  await input.db.batch([skipRun, closeDelivery]);
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
  db: D1Database;
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
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = ?,
          failure_code = ?,
          published_signal_id = ?,
          worker_submit_request_json = NULL,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE delivery_id = ?
          AND organization_id = ?
          AND routine_run_id = ?
          AND idempotency_key = ?
          AND status = 'submitted'
          AND submission_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM routine_runs
            WHERE id = ?
              AND organization_id = ?
              AND native_delivery_id = ?
              AND status = ?
          )
      `
    )
    .bind(
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
      input.runStatus
    )
    .run();
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
}

export async function markRemoteAgentNativeDeliveryAck(input: {
  db: D1Database;
  nowMs: number;
  idempotencyKey: string;
  submissionId: string;
  workerRequestId?: string | null;
  accepted: boolean;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          submission_id = COALESCE(submission_id, ?),
          worker_request_id = COALESCE(worker_request_id, ?),
          status = CASE
            WHEN status = 'accepted' THEN status
            ELSE ?
          END,
          worker_submit_request_json = CASE
            WHEN routine_run_id IS NOT NULL
              THEN worker_submit_request_json
            ELSE NULL
          END,
          accepted_at_ms = COALESCE(accepted_at_ms, ?),
          execution_evidence_at_ms = COALESCE(execution_evidence_at_ms, ?),
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND status = 'submitted'
          AND (submission_id IS NULL OR submission_id = ?)
      `
    )
    .bind(
      input.submissionId,
      input.workerRequestId ?? null,
      input.accepted ? "accepted" : "retry_observed",
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.submissionId
    )
    .run();

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
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  sequence: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          execution_evidence_at_ms = MAX(
            COALESCE(execution_evidence_at_ms, 0),
            ?
          ),
          execution_evidence_sequence = ?,
          updated_at_ms = MAX(updated_at_ms, ?)
        WHERE idempotency_key = ?
          AND submission_id = ?
          AND status IN ('accepted', 'retry_observed')
          AND COALESCE(execution_evidence_sequence, 0) < ?
      `
    )
    .bind(
      input.nowMs,
      input.sequence,
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
      input.sequence
    )
    .run();
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function markRemoteAgentNativeDeliveryDeadlineProbeEnqueued(input: {
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          deadline_probe_enqueued_at_ms = COALESCE(
            deadline_probe_enqueued_at_ms,
            ?
          ),
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND submission_id = ?
          AND status IN ('submitted', 'accepted', 'retry_observed')
      `
    )
    .bind(input.nowMs, input.nowMs, input.idempotencyKey, input.submissionId)
    .run();
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function markRemoteAgentAcceptedDeliveryProbeScheduled(input: {
  db: D1Database;
  expectedCurrentDueAtMs?: number;
  idempotencyKey: string;
  nextDueAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const expectedLeaseClause =
    input.expectedCurrentDueAtMs === undefined
      ? ""
      : "AND accepted_probe_next_due_at_ms = ?";
  const statement = input.db.prepare(
    `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          accepted_probe_next_due_at_ms = ?,
          deadline_probe_enqueued_at_ms = COALESCE(
            deadline_probe_enqueued_at_ms,
            ?
          ),
          updated_at_ms = MAX(updated_at_ms, ?)
        WHERE idempotency_key = ?
          AND submission_id = ?
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          ${expectedLeaseClause}
      `
  );
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
  await statement.bind(...bindings).run();
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function claimRemoteAgentAcceptedDeliveryProbeSchedule(input: {
  db: D1Database;
  idempotencyKey: string;
  leaseDueAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<{
  claimed: boolean;
  delivery: RemoteAgentNativeDeliveryRecord | null;
}> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          accepted_probe_next_due_at_ms = ?,
          updated_at_ms = MAX(updated_at_ms, ?)
        WHERE idempotency_key = ?
          AND submission_id = ?
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          AND (
            accepted_probe_next_due_at_ms IS NULL
            OR accepted_probe_next_due_at_ms <= ?
          )
      `
    )
    .bind(
      input.leaseDueAtMs,
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
      input.nowMs
    )
    .run();
  return {
    claimed: Number(result.meta?.changes ?? 0) === 1,
    delivery: await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: input.db,
      idempotencyKey: input.idempotencyKey,
    }),
  };
}

export async function releaseRemoteAgentAcceptedDeliveryProbeSchedule(input: {
  db: D1Database;
  idempotencyKey: string;
  leaseDueAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          accepted_probe_next_due_at_ms = NULL,
          updated_at_ms = MAX(updated_at_ms, ?)
        WHERE idempotency_key = ?
          AND submission_id = ?
          AND status IN ('accepted', 'retry_observed')
          AND accepted_probe_next_due_at_ms = ?
      `
    )
    .bind(
      input.nowMs,
      input.idempotencyKey,
      input.submissionId,
      input.leaseDueAtMs
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function listRemoteAgentNativeDeliveriesMissingAcceptedProbe(input: {
  db: D1Database;
  limit?: number;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
  const result = await input.db
    .prepare(
      `
        SELECT idempotency_key
        FROM openMeldRemoteAgent_native_delivery_ledger
        WHERE status IN ('accepted', 'retry_observed')
          AND submission_id IS NOT NULL
          AND final_publication_state IS NULL
          AND (
            accepted_probe_next_due_at_ms IS NULL
            OR accepted_probe_next_due_at_ms <= ?
          )
        ORDER BY updated_at_ms ASC, delivery_id ASC
        LIMIT ?
      `
    )
    .bind(input.nowMs, limit)
    .all<{ idempotency_key: string }>();
  const deliveries = await Promise.all(
    (result.results ?? []).map(
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
  db: D1Database;
  limit: number;
  replayWindowStartMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT idempotency_key
        FROM openMeldRemoteAgent_native_delivery_ledger
        WHERE routine_run_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM routine_runs
            WHERE routine_runs.id = openMeldRemoteAgent_native_delivery_ledger.routine_run_id
              AND routine_runs.organization_id = openMeldRemoteAgent_native_delivery_ledger.organization_id
              AND COALESCE(routine_runs.execution_engine, 'legacy') = 'legacy'
          )
          AND status IN ('submitted', 'accepted', 'retry_observed')
          AND COALESCE(failure_code, '') <> ?
          AND submission_id IS NULL
          AND worker_submit_request_json IS NOT NULL
          AND (
            (
              COALESCE(submitted_at_ms, created_at_ms) >= ?
              AND updated_at_ms <= ?
            )
            OR (
              COALESCE(submitted_at_ms, created_at_ms) < ?
              AND updated_at_ms <= ?
            )
          )
        ORDER BY updated_at_ms ASC, delivery_id ASC
        LIMIT ?
      `
    )
    .bind(
      REMOTE_AGENT_ROUTINE_TARGET_RECOVERY_BLOCKED_CODE,
      input.replayWindowStartMs,
      input.cutoffMs,
      input.replayWindowStartMs,
      input.ambiguityCutoffMs,
      input.limit
    )
    .all<{ idempotency_key: string }>();
  const records = await Promise.all(
    (result.results ?? []).map(
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
  db: D1Database;
  deliveryId: string;
  expectedUpdatedAtMs: number;
  nowMs: number;
  organizationId: string;
  runId: string;
  runTargetSpaceId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          failure_code = ?,
          updated_at_ms = ?
        WHERE delivery_id = ?
          AND organization_id = ?
          AND routine_run_id = ?
          AND idempotency_key = ?
          AND status IN ('submitted', 'accepted', 'retry_observed')
          AND updated_at_ms = ?
          AND space_id <> ?
          AND EXISTS (
            SELECT 1
            FROM routine_runs
            WHERE id = ?
              AND organization_id = ?
              AND native_delivery_id = ?
              AND status = 'submitted'
              AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot) = ?
          )
      `
    )
    .bind(
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
      input.runTargetSpaceId
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.runId,
  });
}

export async function claimRemoteAgentRoutineSubmissionRecoveryAttempt(input: {
  db: D1Database;
  deliveryId: string;
  expectedUpdatedAtMs: number;
  nowMs: number;
  organizationId: string;
  runId: string;
  runTargetSpaceId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET updated_at_ms = ?
        WHERE delivery_id = ?
          AND organization_id = ?
          AND routine_run_id = ?
          AND idempotency_key = ?
          AND status = 'submitted'
          AND submission_id IS NULL
          AND worker_submit_request_json IS NOT NULL
          AND updated_at_ms = ?
          AND space_id = ?
          AND EXISTS (
            SELECT 1
            FROM routine_runs
            WHERE id = ?
              AND organization_id = ?
              AND native_delivery_id = ?
              AND status = 'submitted'
              AND COALESCE(target_space_id_snapshot, slack_conversation_id_snapshot) = ?
          )
      `
    )
    .bind(
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
      input.runTargetSpaceId
    )
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
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
  db: D1Database;
  failureDetail?: string;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  status: Extract<
    RemoteAgentNativeDeliveryStatus,
    "failed" | "worker_unavailable" | "flag_rejected"
  >;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN status
            ELSE ?
          END,
          failure_code = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN failure_code
            ELSE ?
          END,
          failure_detail = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN failure_detail
            ELSE COALESCE(failure_detail, ?)
          END,
          worker_submit_request_json = CASE
            WHEN status IN ('accepted', 'retry_observed', 'completed')
              THEN worker_submit_request_json
            ELSE NULL
          END,
          updated_at_ms = ?
        WHERE idempotency_key = ?
      `
    )
    .bind(
      input.status,
      input.failureCode,
      input.failureDetail ?? null,
      input.nowMs,
      input.idempotencyKey
    )
    .run();
}

export async function markRemoteAgentPreAdmissionFailurePublished(input: {
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          published_signal_id = ?,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'flag_rejected', 'worker_unavailable')
          AND failure_code = ?
          AND final_publication_state IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.failureCode
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function clearRemoteAgentNativeDeliveryTriggerTextForMember(input: {
  db: D1Database;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          trigger_text = NULL,
          execution_recovery_submit_request_json = NULL
        WHERE organization_id = ?
          AND on_behalf_of_user_id = ?
          AND (
            trigger_text IS NOT NULL
            OR execution_recovery_submit_request_json IS NOT NULL
          )
      `
    )
    .bind(input.organizationId, input.userId)
    .run();
}

export async function clearRemoteAgentNativeDeliveryTriggerTextForOrganization(input: {
  db: D1Database;
  organizationId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          trigger_text = NULL,
          worker_submit_request_json = NULL,
          execution_recovery_submit_request_json = NULL
        WHERE organization_id = ?
          AND (
            trigger_text IS NOT NULL
            OR worker_submit_request_json IS NOT NULL
            OR execution_recovery_submit_request_json IS NOT NULL
          )
      `
    )
    .bind(input.organizationId)
    .run();
}

export async function readRemoteAgentNativeDeliveryByIdempotencyKey(input: {
  db: D1Database;
  idempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.idempotencyKey)
    .first<RemoteAgentNativeDeliveryRow>();

  return row ? mapNativeDeliveryRow(row) : null;
}

export async function readRemoteAgentNativeDeliveryBySubmissionId(input: {
  db: D1Database;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE submission_id = ?
        LIMIT 1
      `
    )
    .bind(input.submissionId)
    .first<RemoteAgentNativeDeliveryRow>();

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
  db: D1Database;
  limit: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit)));
  const current = input.currentDelivery;
  const where: string[] = [
    "organization_id = ?",
    "profile_id = ?",
    "delivery_id <> ?",
    "routine_run_id IS NULL",
  ];
  const bindings: unknown[] = [
    current.organizationId,
    current.profileId,
    current.deliveryId,
  ];

  if (current.onBehalfOfUserId) {
    where.push("on_behalf_of_user_id = ?");
    bindings.push(current.onBehalfOfUserId);
  } else if (current.anonymousMemberSpeaker) {
    const identity = current.anonymousMemberSpeaker.messageChannelIdentity;
    where.push(
      "on_behalf_of_user_id IS NULL",
      "json_extract(anonymous_member_speaker_json, '$.messageChannelIdentity.provider') = ?",
      "json_extract(anonymous_member_speaker_json, '$.messageChannelIdentity.connectionId') = ?",
      "json_extract(anonymous_member_speaker_json, '$.messageChannelIdentity.providerUserId') = ?"
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
      "slack_team_id = ?",
      "slack_channel_id = ?"
    );
    bindings.push(current.slackTeamId, current.slackChannelId);
  } else if (current.conversationKind === "space") {
    where.push("conversation_kind = 'space'", "space_id = ?");
    bindings.push(current.spaceId);
  } else {
    const locator = current.messageChannelLocator;
    if (!locator) {
      return [];
    }
    where.push(
      "conversation_kind = 'message_channel'",
      "message_channel_provider = ?",
      "message_channel_connection_id = ?"
    );
    bindings.push(locator.provider, locator.connectionId);
    if (locator.provider === "slack") {
      where.push(
        "json_extract(message_channel_locator_json, '$.teamId') = ?",
        "json_extract(message_channel_locator_json, '$.channelId') = ?"
      );
      bindings.push(locator.teamId, locator.channelId);
    } else {
      where.push(
        "json_extract(message_channel_locator_json, '$.appId') = ?",
        "json_extract(message_channel_locator_json, '$.chatId') = ?",
        "json_extract(message_channel_locator_json, '$.tenantKey') IS ?"
      );
      bindings.push(locator.appId, locator.chatId, locator.tenantKey);
    }
  }

  const rows = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE ${where.join("\n          AND ")}
        ORDER BY created_at_ms DESC, delivery_id DESC
        LIMIT ?
      `
    )
    .bind(...bindings, limit)
    .all<RemoteAgentNativeDeliveryRow>();

  return rows.results.map(mapNativeDeliveryRow);
}

export async function listRemoteAgentNativeDeliveryTurnDiagnostics(input: {
  currentDelivery: RemoteAgentNativeDeliveryRecord;
  db: D1Database;
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

export async function readRemoteAgentNativeDeliveryByDeliveryId(input: {
  db: D1Database;
  deliveryId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE delivery_id = ?
        LIMIT 1
      `
    )
    .bind(input.deliveryId)
    .first<RemoteAgentNativeDeliveryRow>();

  return row ? mapNativeDeliveryRow(row) : null;
}

export async function listTerminalRemoteAgentNativeDeliveriesWithRetainedPayload(input: {
  conversationIdPrefix: string;
  db: D1Database;
  limit?: number;
}): Promise<RemoteAgentNativeDeliveryRecord[]> {
  const conversationIdPrefix = input.conversationIdPrefix.trim();
  if (!conversationIdPrefix) {
    throw new TypeError("conversationIdPrefix must not be empty");
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
  const rows = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE final_publication_payload_json IS NOT NULL
          AND status IN (
            'completed',
            'failed',
            'flag_rejected',
            'guardrail_rejected',
            'worker_unavailable',
            'callback_rejected'
          )
          AND substr(
            coalesce(
              json_extract(
                worker_submit_request_json,
                '$.request.conversationId'
              ),
              json_extract(
                execution_recovery_submit_request_json,
                '$.request.conversationId'
              )
            ),
            1,
            length(?)
          ) = ?
        ORDER BY
          center_agent_task_terminal_projection_attempted_at_ms ASC,
          coalesce(callback_received_at_ms, updated_at_ms) ASC,
          delivery_id ASC
        LIMIT ?
      `
    )
    .bind(conversationIdPrefix, conversationIdPrefix, limit)
    .all<RemoteAgentNativeDeliveryRow>();
  return rows.results.map(mapNativeDeliveryRow);
}

export async function markCenterAgentTaskTerminalProjectionAttempted(input: {
  attemptedAtMs: number;
  db: D1Database;
  deliveryId: string;
  idempotencyKey: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET center_agent_task_terminal_projection_attempted_at_ms = ?
        WHERE delivery_id = ?
          AND idempotency_key = ?
          AND final_publication_payload_json IS NOT NULL
      `
    )
    .bind(input.attemptedAtMs, input.deliveryId, input.idempotencyKey)
    .run();
}

const NATIVE_DELIVERY_ID_LOOKUP_CHUNK_SIZE = 80;

export async function listRemoteAgentNativeDeliveriesByDeliveryIds(input: {
  db: D1Database;
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
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await input.db
      .prepare(
        `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
          WHERE delivery_id IN (${placeholders})
          ORDER BY delivery_id ASC
        `
      )
      .bind(...chunk)
      .all<RemoteAgentNativeDeliveryRow>();
    deliveries.push(...rows.results.map(mapNativeDeliveryRow));
  }
  return deliveries;
}

export async function readRemoteAgentNativeDeliveryByExecution(input: {
  db: D1Database;
  dispatchId: string;
  profileId: string;
  spaceId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const row = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE dispatch_id = ?
          AND profile_id = ?
          AND space_id = ?
        ORDER BY created_at_ms DESC, delivery_id DESC
        LIMIT 1
      `
    )
    .bind(input.dispatchId, input.profileId, input.spaceId)
    .first<RemoteAgentNativeDeliveryRow>();

  return row ? mapNativeDeliveryRow(row) : null;
}

export async function readRemoteAgentNativeDeliveryByDispatchAndConversation(input: {
  conversationId: string;
  db: D1Database;
  dispatchId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `${REMOTE_AGENT_NATIVE_DELIVERY_SELECT}
        WHERE dispatch_id = ?
          AND space_id = ?
        ORDER BY created_at_ms DESC, delivery_id DESC
        LIMIT 2
      `
    )
    .bind(input.dispatchId, input.conversationId)
    .all<RemoteAgentNativeDeliveryRow>();
  if (result.results.length > 1) {
    throw new Error("execution_recovery.execution_identity_ambiguous");
  }
  const row = result.results[0];
  return row ? mapNativeDeliveryRow(row) : null;
}

export async function readActiveRemoteAgentNativeDeliveryCancellationTarget(input: {
  db: D1Database;
  dispatchId: string;
  profileId: string;
  spaceId: string;
}): Promise<ActiveRemoteAgentNativeDeliveryCancellationTarget | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          COALESCE(
            json_extract(worker_submit_request_json, '$.request.runtimeConversation.id'),
            json_extract(worker_submit_request_json, '$.runtimeConversation.id'),
            json_extract(worker_submit_request_json, '$.request.conversationId'),
            json_extract(worker_submit_request_json, '$.conversationId'),
            json_extract(execution_recovery_submit_request_json, '$.request.runtimeConversation.id'),
            json_extract(execution_recovery_submit_request_json, '$.runtimeConversation.id'),
            json_extract(execution_recovery_submit_request_json, '$.request.conversationId'),
            json_extract(execution_recovery_submit_request_json, '$.conversationId')
          ) AS conversation_id,
          idempotency_key,
          organization_id,
          space_id,
          submission_id
        FROM openMeldRemoteAgent_native_delivery_ledger
        WHERE dispatch_id = ?
          AND profile_id = ?
          AND space_id = ?
          AND conversation_kind = 'space'
          AND status IN ('accepted', 'retry_observed')
          AND submission_id IS NOT NULL
        ORDER BY updated_at_ms DESC, delivery_id DESC
        LIMIT 1
      `
    )
    .bind(input.dispatchId, input.profileId, input.spaceId)
    .first<{
      conversation_id: string | null;
      idempotency_key: string;
      organization_id: string;
      space_id: string;
      submission_id: string;
    }>();
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
  db: D1Database;
  organizationId: string;
  profileId: string;
}): Promise<ActiveRemoteAgentNativeDeliveryCancellationTarget[]> {
  const rows = await input.db
    .prepare(
      `
        SELECT
          COALESCE(
            json_extract(worker_submit_request_json, '$.request.runtimeConversation.id'),
            json_extract(worker_submit_request_json, '$.runtimeConversation.id'),
            json_extract(worker_submit_request_json, '$.request.conversationId'),
            json_extract(worker_submit_request_json, '$.conversationId'),
            json_extract(execution_recovery_submit_request_json, '$.request.runtimeConversation.id'),
            json_extract(execution_recovery_submit_request_json, '$.runtimeConversation.id'),
            json_extract(execution_recovery_submit_request_json, '$.request.conversationId'),
            json_extract(execution_recovery_submit_request_json, '$.conversationId')
          ) AS conversation_id,
          idempotency_key,
          organization_id,
          space_id,
          submission_id
        FROM openMeldRemoteAgent_native_delivery_ledger
        WHERE organization_id = ?
          AND profile_id = ?
          AND status IN ('submitted', 'accepted', 'retry_observed')
          AND submission_id IS NOT NULL
        ORDER BY updated_at_ms ASC, delivery_id ASC
      `
    )
    .bind(input.organizationId, input.profileId)
    .all<{
      conversation_id: string | null;
      idempotency_key: string;
      organization_id: string;
      space_id: string;
      submission_id: string;
    }>();
  return (rows.results ?? []).map((row) => ({
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    submissionId: row.submission_id,
  }));
}

export async function markRemoteAgentCallbackRejected(input: {
  db: D1Database;
  nowMs: number;
  submissionId: string | null;
  idempotencyKey: string | null;
  failureCode: string;
}): Promise<void> {
  if (input.submissionId) {
    await input.db
      .prepare(
        `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            status = 'callback_rejected',
            failure_code = ?,
            callback_received_at_ms = ?,
            completed_at_ms = COALESCE(completed_at_ms, ?),
            worker_submit_request_json = NULL,
            updated_at_ms = ?
          WHERE submission_id = ?
            AND status IN ('submitted', 'accepted', 'retry_observed')
        `
      )
      .bind(
        input.failureCode,
        input.nowMs,
        input.nowMs,
        input.nowMs,
        input.submissionId
      )
      .run();
    return;
  }
  if (input.idempotencyKey) {
    await input.db
      .prepare(
        `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            status = 'callback_rejected',
            failure_code = ?,
            callback_received_at_ms = ?,
            completed_at_ms = COALESCE(completed_at_ms, ?),
            worker_submit_request_json = NULL,
            updated_at_ms = ?
          WHERE idempotency_key = ?
            AND status IN ('submitted', 'accepted', 'retry_observed')
        `
      )
      .bind(
        input.failureCode,
        input.nowMs,
        input.nowMs,
        input.nowMs,
        input.idempotencyKey
      )
      .run();
  }
}

export async function insertRemoteAgentRejectedCallbackRecord(input: {
  db: D1Database;
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
  await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, null, ?, ?, null, ?, ?, 'callback_rejected', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(submission_id) DO UPDATE SET
          status = CASE
            WHEN openMeldRemoteAgent_native_delivery_ledger.status = 'completed'
              THEN openMeldRemoteAgent_native_delivery_ledger.status
            ELSE 'callback_rejected'
          END,
          failure_code = excluded.failure_code,
          callback_received_at_ms = excluded.callback_received_at_ms,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
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
      input.nowMs
    )
    .run();

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
  db: D1Database;
  nowMs: number;
  submissionId: string;
  failureCode: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          failure_code = ?,
          callback_received_at_ms = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND status IN ('accepted', 'retry_observed')
      `
    )
    .bind(input.failureCode, input.nowMs, input.nowMs, input.submissionId)
    .run();
}

export async function claimRemoteAgentNativeDeliveryTerminalFailure(input: {
  db: D1Database;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'failed',
          failure_code = ?,
          worker_submit_request_json = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey
    )
    .run();
  if (!didD1Write(result)) {
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
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
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
          retired_deadline_failure_reconciled_at_ms = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = 'remote_agent.delivery_expired'
      `
    )
    .bind(input.nowMs, input.nowMs, input.submissionId, input.idempotencyKey)
    .run();
  if (!didD1Write(result)) {
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
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'failed',
          failure_code = ?,
          final_publication_state = 'claimed',
          final_publication_claim_id = ?,
          final_publication_claimed_at_ms = ?,
          final_publication_claim_expires_at_ms = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'submitted'
          AND final_publication_state IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  const record = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
  return record?.finalPublicationClaimId === input.claimId ? record : null;
}

export async function releaseRemoteAgentNativeDeliveryAdmissionWatchdog(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'submitted',
          failure_code = NULL,
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'failed'
          AND failure_code = ?
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(input.nowMs, input.idempotencyKey, input.failureCode, input.claimId)
    .run();
  return didD1Write(result);
}

export async function markRemoteAgentNativeDeliveryAdmissionWatchdogPublished(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          published_signal_id = ?,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status = 'failed'
          AND failure_code = ?
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
      `
    )
    .bind(
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function markRemoteAgentMessageChannelAdmissionWatchdogPublished(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  providerPublicationResultId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          provider_progress_state = CASE
            WHEN ? IS NULL THEN provider_progress_state
            ELSE 'finalized'
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = COALESCE(
            ?,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN ? IS NULL THEN provider_progress_pending_sequence
            ELSE NULL
          END,
          provider_publication_result_id = ?,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = ?
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND final_publication_claim_expires_at_ms > ?
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
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
      input.providerPublicationIdempotencyKey
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function markRemoteAgentMessageChannelAdmissionWatchdogOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
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
            ?,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN provider_progress_card_id IS NOT NULL THEN NULL
            ELSE provider_progress_pending_sequence
          END,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = ?
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.providerProgressSequence,
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function releaseRemoteAgentMessageChannelAdmissionWatchdogClaim(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'submitted',
          failure_code = NULL,
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = ?
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return didD1Write(result);
}

export async function releaseRemoteAgentMessageChannelTerminalFailureClaim(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND submission_id IS NULL
          AND accepted_at_ms IS NULL
          AND status IN ('failed', 'worker_unavailable')
          AND failure_code = ?
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.nowMs,
      input.idempotencyKey,
      input.failureCode,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return didD1Write(result);
}

export async function claimRemoteAgentFinalPublication(input: {
  db: D1Database;
  claimExpiresAtMs: number;
  claimId: string;
  nowMs: number;
  payload: RemoteAgentFinalPublicationPayload;
  submissionId: string;
  idempotencyKey: string;
  terminalFailureCode?: string | null;
  terminalFailureDetail?: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  if (input.terminalFailureDetail && !input.terminalFailureCode) {
    throw new Error(
      "Remote Agent terminal failure detail requires a failure code"
    );
  }
  const payloadJson = serializeFinalPublicationPayload(input.payload);
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = CASE WHEN ? IS NULL THEN status ELSE 'failed' END,
          failure_code = CASE WHEN ? IS NULL THEN failure_code ELSE ? END,
          failure_detail = CASE
            WHEN ? IS NULL THEN failure_detail
            ELSE ?
          END,
          final_publication_state = 'claimed',
          final_publication_claim_id = ?,
          final_publication_claimed_at_ms = ?,
          final_publication_claim_expires_at_ms = ?,
          final_publication_payload_json = COALESCE(
            final_publication_payload_json,
            ?
          ),
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          AND (
            final_publication_payload_json IS NULL
            OR final_publication_payload_json = ?
          )
      `
    )
    .bind(
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
      payloadJson
    )
    .run();
  if (!didD1Write(result)) {
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
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  payload: RemoteAgentFinalPublicationPayload;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const payloadJson = serializeFinalPublicationPayload(input.payload);
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_payload_json = COALESCE(
            final_publication_payload_json,
            ?
          ),
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          AND (
            final_publication_payload_json IS NULL
            OR final_publication_payload_json = ?
          )
      `
    )
    .bind(
      payloadJson,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      payloadJson
    )
    .run();

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
  db: D1Database;
  deliveryId: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET final_publication_payload_json = NULL
        WHERE delivery_id = ?
          AND idempotency_key = ?
          AND final_publication_payload_json IS NOT NULL
          AND status IN (
            'completed',
            'failed',
            'flag_rejected',
            'guardrail_rejected',
            'worker_unavailable',
            'callback_rejected'
          )
      `
    )
    .bind(input.deliveryId, input.idempotencyKey)
    .run();
  return didD1Write(result);
}

export async function claimRemoteAgentMessageChannelFinalPublication(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  payload: RemoteAgentFinalPublicationPayload;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const payloadJson = serializeFinalPublicationPayload(input.payload);
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = CASE
            WHEN final_publication_payload_json IS NULL
              THEN CASE WHEN ? IS NULL THEN status ELSE 'failed' END
            WHEN json_extract(
              final_publication_payload_json,
              '$.failureCode'
            ) IS NULL
              THEN json_extract(
                final_publication_payload_json,
                '$.resumeStatus'
              )
            ELSE 'failed'
          END,
          failure_code = CASE
            WHEN final_publication_payload_json IS NULL THEN ?
            ELSE json_extract(
              final_publication_payload_json,
              '$.failureCode'
            )
          END,
          failure_detail = CASE
            WHEN final_publication_payload_json IS NULL THEN ?
            ELSE json_extract(
              final_publication_payload_json,
              '$.failureDetail'
            )
          END,
          final_publication_state = 'claimed',
          final_publication_claim_id = ?,
          final_publication_claimed_at_ms = ?,
          final_publication_claim_expires_at_ms = MIN(
            ?,
            COALESCE(final_publication_ambiguity_deadline_at_ms, ?)
          ),
          final_publication_payload_json = COALESCE(
            final_publication_payload_json,
            ?
          ),
          final_publication_attempt_count =
            final_publication_attempt_count + 1,
          final_publication_next_attempt_at_ms = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state IS NULL
          AND (
            final_publication_next_attempt_at_ms IS NULL
            OR final_publication_next_attempt_at_ms <= ?
          )
          AND (
            final_publication_ambiguity_deadline_at_ms IS NULL
            OR final_publication_ambiguity_deadline_at_ms > ?
          )
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
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
      input.providerPublicationIdempotencyKey
    )
    .run();
  if (!didD1Write(result)) {
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
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND final_publication_claim_expires_at_ms > ?
          AND final_publication_payload_json IS NOT NULL
          AND final_publication_provider_progress_sequence IS NULL
          AND (
            final_publication_ambiguity_deadline_at_ms IS NULL
            OR final_publication_ambiguity_deadline_at_ms > ?
          )
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.nowMs,
      input.nowMs,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return didD1Write(result);
}

export async function freezeRemoteAgentMessageChannelFinalPublicationSequence(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_provider_progress_sequence = COALESCE(
            final_publication_provider_progress_sequence,
            ?
          ),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND final_publication_claim_expires_at_ms > ?
          AND final_publication_payload_json IS NOT NULL
          AND (
            final_publication_provider_progress_sequence IS NULL
            OR final_publication_provider_progress_sequence = ?
          )
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.providerProgressSequence,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.nowMs,
      input.providerProgressSequence,
      input.providerPublicationIdempotencyKey
    )
    .run();
  if (!didD1Write(result)) {
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
  db: D1Database;
  failureCode: string;
  failureDetail: string;
  idempotencyKey: string;
  nowMs: number;
  status: "failed" | "flag_rejected" | "worker_unavailable";
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = ?,
          failure_code = ?,
          failure_detail = COALESCE(failure_detail, ?),
          worker_submit_request_json = NULL,
          final_publication_state = 'claimed',
          final_publication_claim_id = ?,
          final_publication_claimed_at_ms = ?,
          final_publication_claim_expires_at_ms = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'slack'
          AND submission_id IS NULL
          AND status IN ('submitted', 'failed', 'flag_rejected', 'worker_unavailable')
          AND final_publication_state IS NULL
      `
    )
    .bind(
      input.status,
      input.failureCode,
      input.failureDetail,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey
    )
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
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
  db: D1Database;
  failureCode: string;
  failureDetail: string;
  idempotencyKey: string;
  nowMs: number;
  status: "failed" | "worker_unavailable";
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = ?,
          failure_code = ?,
          failure_detail = COALESCE(failure_detail, ?),
          worker_submit_request_json = NULL,
          final_publication_state = 'claimed',
          final_publication_claim_id = ?,
          final_publication_claimed_at_ms = ?,
          final_publication_claim_expires_at_ms = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
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
              AND final_publication_claim_expires_at_ms <= ?
              AND failure_code = ?
            )
          )
          AND provider_publication_idempotency_key IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.status,
      input.failureCode,
      input.failureDetail,
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey,
      input.nowMs,
      input.failureCode
    )
    .run();
  if (!didD1Write(result)) {
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
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          published_signal_id = ?,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'slack'
          AND submission_id IS NULL
          AND status IN ('failed', 'flag_rejected', 'worker_unavailable')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey,
      input.claimId
    )
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function markRemoteAgentSlackAdmissionFailureOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'outcome_unknown',
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'slack'
          AND submission_id IS NULL
          AND status IN ('failed', 'flag_rejected', 'worker_unavailable')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(input.nowMs, input.idempotencyKey, input.claimId)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function releaseRemoteAgentSlackAdmissionFailureClaim(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND submission_id IS NULL
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(input.nowMs, input.idempotencyKey, input.claimId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function releaseRemoteAgentFinalPublicationClaim(input: {
  db: D1Database;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
  restoreStatus?: "accepted" | "retry_observed";
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = COALESCE(?, status),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = ?,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.restoreStatus ?? null,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId
    )
    .run();
  return didD1Write(result);
}

export async function markRemoteAgentSlackFinalPublicationPublished(input: {
  db: D1Database;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'completed',
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = NULL,
          published_signal_id = ?,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'slack'
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }

  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentSlackFinalPublicationOutcomeUnknown(input: {
  db: D1Database;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'outcome_unknown',
          failure_code = 'remote_agent.callback_publication_outcome_unknown',
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'slack'
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentRetainedResultPublicationRecovered(input: {
  db: D1Database;
  deliveryId: string;
  idempotencyKey: string;
  nowMs: number;
  publicationId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'completed',
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = NULL,
          failure_detail = NULL,
          published_signal_id = CASE
            WHEN conversation_kind = 'slack' THEN ?
            ELSE published_signal_id
          END,
          provider_publication_result_id = CASE
            WHEN conversation_kind = 'message_channel' THEN ?
            ELSE provider_publication_result_id
          END,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE delivery_id = ?
          AND idempotency_key = ?
          AND conversation_kind IN ('slack', 'message_channel')
          AND status IN ('accepted', 'retry_observed')
          AND final_publication_state = 'outcome_unknown'
          AND final_publication_payload_json IS NOT NULL
          AND json_extract(final_publication_payload_json, '$.failureCode')
            IS NULL
          AND published_signal_id IS NULL
          AND provider_publication_result_id IS NULL
      `
    )
    .bind(
      input.publicationId,
      input.publicationId,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
      input.idempotencyKey
    )
    .run();
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
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  providerPublicationResultId: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = CASE
            WHEN status = 'failed' THEN 'failed'
            ELSE 'completed'
          END,
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_payload_json = NULL,
          final_publication_next_attempt_at_ms = NULL,
          failure_code = CASE
            WHEN status = 'failed' THEN failure_code
            ELSE NULL
          END,
          provider_progress_state = CASE
            WHEN ? IS NULL THEN provider_progress_state
            ELSE 'finalized'
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = COALESCE(
            ?,
            final_publication_provider_progress_sequence,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN ? IS NULL THEN provider_progress_pending_sequence
            ELSE NULL
          END,
          provider_publication_result_id = ?,
          final_publication_provider_progress_sequence = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND final_publication_claim_expires_at_ms > ?
          AND (
            final_publication_ambiguity_deadline_at_ms IS NULL
            OR final_publication_ambiguity_deadline_at_ms > ?
          )
          AND provider_publication_idempotency_key = ?
          AND (
            final_publication_provider_progress_sequence IS NULL
            OR final_publication_provider_progress_sequence = ?
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
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
      input.providerProgressSequence
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentMessageChannelFinalPublicationOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'failed',
          final_publication_state = 'outcome_unknown',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_payload_json = NULL,
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
            ?,
            final_publication_provider_progress_sequence,
            provider_progress_sequence
          ),
          provider_progress_pending_sequence = CASE
            WHEN provider_progress_card_id IS NOT NULL THEN NULL
            ELSE provider_progress_pending_sequence
          END,
          final_publication_provider_progress_sequence = NULL,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.providerProgressSequence,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function releaseRemoteAgentMessageChannelFinalPublicationClaim(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  nextAttemptAtMs?: number | null;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = json_extract(
            final_publication_payload_json,
            '$.resumeStatus'
          ),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_next_attempt_at_ms = ?,
          failure_code = ?,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND provider_publication_idempotency_key = ?
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.nextAttemptAtMs ?? null,
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return didD1Write(result);
}

export async function scheduleRemoteAgentMessageChannelFinalPublicationRetry(input: {
  ambiguityDeadlineAtMs: number;
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nextAttemptAtMs: number;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = json_extract(
            final_publication_payload_json,
            '$.resumeStatus'
          ),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_ambiguity_deadline_at_ms = COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            ?
          ),
          final_publication_next_attempt_at_ms = MIN(
            ?,
            COALESCE(final_publication_ambiguity_deadline_at_ms, ?)
          ),
          final_publication_provider_progress_sequence = COALESCE(
            final_publication_provider_progress_sequence,
            ?
          ),
          failure_code = ?,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND final_publication_payload_json IS NOT NULL
          AND COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            ?
          ) > ?
          AND provider_publication_idempotency_key = ?
          AND (
            final_publication_provider_progress_sequence IS NULL
            OR final_publication_provider_progress_sequence = ?
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
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
      input.providerProgressSequence
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function recoverExpiredRemoteAgentMessageChannelFinalPublicationClaim(input: {
  ambiguityWindowMs: number;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nextAttemptAtMs: number;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = json_extract(
            final_publication_payload_json,
            '$.resumeStatus'
          ),
          final_publication_state = NULL,
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_ambiguity_deadline_at_ms = COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            final_publication_claimed_at_ms + ?
          ),
          final_publication_next_attempt_at_ms = MIN(
            ?,
            COALESCE(
              final_publication_ambiguity_deadline_at_ms,
              final_publication_claimed_at_ms + ?
            )
          ),
          failure_code = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND final_publication_payload_json IS NOT NULL
          AND final_publication_claimed_at_ms IS NOT NULL
          AND final_publication_provider_progress_sequence IS NULL
          AND (
            final_publication_claim_expires_at_ms IS NULL
            OR final_publication_claim_expires_at_ms <= ?
          )
          AND COALESCE(
            final_publication_ambiguity_deadline_at_ms,
            final_publication_claimed_at_ms + ?
          ) > ?
          AND provider_publication_idempotency_key IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.ambiguityWindowMs,
      input.nextAttemptAtMs,
      input.ambiguityWindowMs,
      input.failureCode,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.nowMs,
      input.ambiguityWindowMs,
      input.nowMs
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function expireRemoteAgentMessageChannelFinalPublicationAmbiguity(input: {
  ambiguityWindowMs: number;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'failed',
          final_publication_state = 'outcome_unknown',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          final_publication_payload_json = NULL,
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
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
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
              AND final_publication_ambiguity_deadline_at_ms <= ?
            )
            OR (
              final_publication_state = 'claimed'
              AND (
                final_publication_claim_expires_at_ms IS NULL
                OR final_publication_claim_expires_at_ms <= ?
              )
              AND COALESCE(
                final_publication_ambiguity_deadline_at_ms,
                final_publication_claimed_at_ms + ?
              ) <= ?
            )
          )
          AND provider_publication_idempotency_key IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.nowMs,
      input.nowMs,
      input.ambiguityWindowMs,
      input.nowMs
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function expireRemoteAgentFinalPublicationClaim(input: {
  db: D1Database;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'outcome_unknown',
          failure_code = CASE
            WHEN status = 'failed' THEN failure_code
            ELSE 'remote_agent.callback_publication_outcome_unknown'
          END,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status IN ('accepted', 'retry_observed', 'failed')
          AND final_publication_state = 'claimed'
          AND (
            final_publication_claim_expires_at_ms IS NULL
            OR final_publication_claim_expires_at_ms <= ?
          )
          AND published_signal_id IS NULL
      `
    )
    .bind(input.nowMs, input.submissionId, input.idempotencyKey, input.nowMs)
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentFailedCallbackPublicationPublished(input: {
  db: D1Database;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'failed',
          final_publication_state = 'published',
          final_publication_claim_id = NULL,
          final_publication_claimed_at_ms = NULL,
          final_publication_claim_expires_at_ms = NULL,
          failure_code = ?,
          published_signal_id = ?,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status = 'failed'
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentFailedCallbackPublicationOutcomeUnknown(input: {
  db: D1Database;
  claimId: string;
  nowMs: number;
  submissionId: string;
  idempotencyKey: string;
  failureCode: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'failed',
          final_publication_state = 'outcome_unknown',
          failure_code = ?,
          callback_received_at_ms = COALESCE(callback_received_at_ms, ?),
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE submission_id = ?
          AND idempotency_key = ?
          AND status = 'failed'
          AND final_publication_state = 'claimed'
          AND final_publication_claim_id = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId,
      input.idempotencyKey,
      input.claimId
    )
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentNativeDeliveryFailurePublished(input: {
  db: D1Database;
  nowMs: number;
  submissionId: string;
  failureCode: string;
  publishedSignalId: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          published_signal_id = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND status = 'failed'
          AND failure_code = ?
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.publishedSignalId,
      input.nowMs,
      input.submissionId,
      input.failureCode
    )
    .run();

  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentRoutineAdmissionFailurePublished(input: {
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  publishedSignalId: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          final_publication_state = 'published',
          failure_code = ?,
          published_signal_id = ?,
          completed_at_ms = COALESCE(completed_at_ms, ?),
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND routine_run_id IS NOT NULL
          AND status IN ('flag_rejected', 'worker_unavailable', 'failed')
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.idempotencyKey
    )
    .run();
  return await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function markRemoteAgentNativeDeliveryCompleted(input: {
  db: D1Database;
  nowMs: number;
  submissionId: string;
  publishedSignalId: string | null;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = 'completed',
          published_signal_id = ?,
          worker_submit_request_json = NULL,
          callback_received_at_ms = ?,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND status IN ('accepted', 'retry_observed')
      `
    )
    .bind(
      input.publishedSignalId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId
    )
    .run();

  return await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
}

export async function markRemoteAgentNativeDeliveryIntermediateTerminal(input: {
  db: D1Database;
  failureCode: string | null;
  failureDetail: string | null;
  nowMs: number;
  submissionId: string;
  status: "completed" | "failed";
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          status = ?,
          failure_code = ?,
          failure_detail = ?,
          callback_received_at_ms = ?,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE submission_id = ?
          AND status IN ('accepted', 'retry_observed')
          AND routine_run_id IS NOT NULL
          AND final_publication_state IS NULL
      `
    )
    .bind(
      input.status,
      input.failureCode,
      input.failureDetail,
      input.nowMs,
      input.nowMs,
      input.nowMs,
      input.submissionId
    )
    .run();
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
    acceptedAtMs: row.accepted_at_ms,
    callbackReceivedAtMs: row.callback_received_at_ms,
    completedAtMs: row.completed_at_ms,
    deadlineProbeEnqueuedAtMs: row.deadline_probe_enqueued_at_ms,
    acceptedProbeNextDueAtMs: row.accepted_probe_next_due_at_ms,
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

function isVersionedWorkerSubmitRequest(
  value: unknown
): value is { request: unknown; storageVersion: 1 } {
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

function didD1Write(result: D1Result): boolean {
  return Number(result.meta?.changes ?? 0) > 0;
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
    if (
      !(
        attachments.success &&
        files.success &&
        Object.keys(record).length === 7
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

function parseSlackConversationId(
  value: string
): { channelId: string; teamId: string; threadTs: string } | null {
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
