import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "./native-delivery-ledger-repo";

const SHA256_HEX_PATTERN = /^[\da-f]{64}$/u;

type ProviderProgressClaimInput = {
  claimExpiresAtMs: number;
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
};

type ProviderProgressClaimResult =
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "claimed";
    }
  | {
      delivery: RemoteAgentNativeDeliveryRecord | null;
      status: "not_claimed";
    };

export async function expireRemoteAgentMessageChannelProviderProgressClaim(input: {
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = CASE provider_progress_state
            WHEN 'create_claimed' THEN 'create_outcome_unknown'
            WHEN 'send_claimed' THEN 'send_outcome_unknown'
            WHEN 'rollover_create_claimed' THEN 'rollover_finalized'
            WHEN 'rollover_send_claimed'
              THEN 'rollover_send_outcome_unknown'
          END,
          provider_progress_failure_code = CASE provider_progress_state
            WHEN 'create_claimed'
              THEN 'message_channel.card_create_outcome_unknown'
            WHEN 'send_claimed'
              THEN 'message_channel.card_send_outcome_unknown'
            WHEN 'rollover_create_claimed'
              THEN 'message_channel.rollover_card_create_outcome_unknown'
            WHEN 'rollover_send_claimed'
              THEN 'message_channel.rollover_card_send_outcome_unknown'
          END,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state IN (
            'create_claimed',
            'send_claimed',
            'rollover_create_claimed',
            'rollover_send_claimed'
          )
          AND provider_progress_claim_expires_at_ms <= ?
          AND (
            final_publication_state IS NULL
            OR final_publication_state = 'claimed'
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(input.nowMs, input.idempotencyKey, input.nowMs)
    .run();
  if (!didD1Write(result)) {
    return null;
  }
  return await readRemoteAgentNativeDeliveryByIdempotencyKey(input);
}

export async function claimRemoteAgentMessageChannelProviderCardCreation(
  input: ProviderProgressClaimInput
): Promise<ProviderProgressClaimResult> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'create_claimed',
          provider_progress_claim_id = ?,
          provider_progress_claimed_at_ms = ?,
          provider_progress_claim_expires_at_ms = ?,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status = 'submitted'
          AND provider_progress_state IS NULL
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
          AND message_channel_provider IN ('lark', 'feishu')
          AND message_channel_connection_id IS NOT NULL
          AND message_channel_locator_json IS NOT NULL
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey
    )
    .run();
  return await resolveClaimResult(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardCreated(input: {
  cardId: string;
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
          provider_progress_state = 'created',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_card_id = ?,
          provider_progress_sequence = 0,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'create_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_card_id IS NULL
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(input.cardId, input.nowMs, input.idempotencyKey, input.claimId)
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardCreationOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return await markClaimedProviderProgressTerminal({
    ...input,
    expectedState: "create_claimed",
    nextState: "create_outcome_unknown",
  });
}

export async function claimRemoteAgentMessageChannelProviderCardSend(
  input: ProviderProgressClaimInput & {
    providerPublicationIdempotencyKey: string;
  }
): Promise<ProviderProgressClaimResult> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'send_claimed',
          provider_progress_claim_id = ?,
          provider_progress_claimed_at_ms = ?,
          provider_progress_claim_expires_at_ms = ?,
          provider_progress_publication_idempotency_key = ?,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status = 'submitted'
          AND provider_progress_state = 'created'
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NULL
          AND provider_progress_publication_idempotency_key IS NULL
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.providerPublicationIdempotencyKey,
      input.nowMs,
      input.idempotencyKey
    )
    .run();
  return await resolveClaimResult(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardSent(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  messageId: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'sent',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_message_id = ?,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'send_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NULL
          AND provider_progress_publication_idempotency_key = ?
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.messageId,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardSendOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return await markClaimedProviderProgressTerminal({
    ...input,
    expectedState: "send_claimed",
    nextState: "send_outcome_unknown",
  });
}

export async function markRemoteAgentMessageChannelProviderCardUnavailable(input: {
  claimId: string;
  db: D1Database;
  expectedState: "create_claimed" | "send_claimed";
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return await markClaimedProviderProgressTerminal({
    ...input,
    nextState: "unavailable",
  });
}

export async function claimRemoteAgentMessageChannelProviderCardUpdate(
  input: ProviderProgressClaimInput & {
    providerPublicationIdempotencyKey: string;
    sequence: number;
  }
): Promise<ProviderProgressClaimResult> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'update_claimed',
          provider_progress_claim_id = ?,
          provider_progress_claimed_at_ms = ?,
          provider_progress_claim_expires_at_ms = ?,
          provider_progress_publication_idempotency_key = ?,
          provider_progress_pending_sequence = ?,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND (
            (
              provider_progress_state = 'sent'
              AND provider_progress_sequence < ?
              AND provider_progress_pending_sequence IS NULL
            )
            OR (
              provider_progress_state = 'update_claimed'
              AND provider_progress_claim_id = ?
              AND provider_progress_publication_idempotency_key = ?
              AND provider_progress_pending_sequence = ?
            )
          )
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.providerPublicationIdempotencyKey,
      input.sequence,
      input.nowMs,
      input.idempotencyKey,
      input.sequence,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.sequence
    )
    .run();
  return await resolveClaimResult(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardUpdatePublished(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
  sequence: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'sent',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_sequence = ?,
          provider_progress_pending_sequence = NULL,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND provider_progress_state = 'update_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_sequence = ?
          AND provider_progress_sequence < ?
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.sequence,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.sequence,
      input.sequence
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardUpdateFailed(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
  sequence: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'sent',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_pending_sequence = NULL,
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND provider_progress_state = 'update_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_sequence = ?
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.sequence
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardUpdateOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
  sequence: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND provider_progress_state = 'update_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_sequence = ?
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.sequence
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function claimRemoteAgentMessageChannelProviderCardRolloverFinalize(
  input: ProviderProgressClaimInput & {
    finalPublicationClaimId?: string | null;
    pendingSourceOffset: number;
    pendingTextHash: string;
    providerPublicationIdempotencyKey: string;
    sequence: number;
  }
): Promise<ProviderProgressClaimResult> {
  assertValidRolloverBoundary(input);
  const finalPublicationClaimId = input.finalPublicationClaimId?.trim() || null;
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'rollover_finalize_claimed',
          provider_progress_claim_id = ?,
          provider_progress_claimed_at_ms = CASE
            WHEN provider_progress_state = 'sent' THEN ?
            ELSE provider_progress_claimed_at_ms
          END,
          provider_progress_claim_expires_at_ms = CASE
            WHEN provider_progress_state = 'sent' THEN ?
            ELSE provider_progress_claim_expires_at_ms
          END,
          provider_progress_publication_idempotency_key = ?,
          provider_progress_pending_sequence = ?,
          provider_progress_pending_source_offset = ?,
          provider_progress_pending_text_hash = ?,
          provider_progress_pending_card_id = NULL,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND (
            (
              provider_progress_state = 'sent'
              AND provider_progress_sequence <= ?
              AND provider_progress_source_offset < ?
              AND provider_progress_pending_sequence IS NULL
              AND provider_progress_pending_source_offset IS NULL
              AND provider_progress_pending_text_hash IS NULL
              AND provider_progress_pending_card_id IS NULL
            )
            OR (
              provider_progress_state = 'rollover_finalize_claimed'
              AND provider_progress_claim_id = ?
              AND provider_progress_publication_idempotency_key = ?
              AND provider_progress_pending_sequence = ?
              AND provider_progress_pending_source_offset = ?
              AND provider_progress_pending_text_hash = ?
              AND provider_progress_pending_card_id IS NULL
            )
          )
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND (
            (? IS NULL AND final_publication_state IS NULL)
            OR (
              ? IS NOT NULL
              AND final_publication_state = 'claimed'
              AND final_publication_claim_id = ?
            )
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.providerPublicationIdempotencyKey,
      input.sequence,
      input.pendingSourceOffset,
      input.pendingTextHash,
      input.nowMs,
      input.idempotencyKey,
      input.sequence,
      input.pendingSourceOffset,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.sequence,
      input.pendingSourceOffset,
      input.pendingTextHash,
      finalPublicationClaimId,
      finalPublicationClaimId,
      finalPublicationClaimId
    )
    .run();
  return await resolveClaimResult(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverFinalizePublished(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  pendingSourceOffset: number;
  pendingTextHash: string;
  providerPublicationIdempotencyKey: string;
  sequence: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  assertValidRolloverBoundary(input);
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'rollover_finalized',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_publication_idempotency_key = NULL,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'rollover_finalize_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_sequence = ?
          AND provider_progress_pending_source_offset = ?
          AND provider_progress_pending_text_hash = ?
          AND provider_progress_pending_card_id IS NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND (
            final_publication_state IS NULL
            OR final_publication_state = 'claimed'
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.sequence,
      input.pendingSourceOffset,
      input.pendingTextHash
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverFinalizeFailed(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  pendingSourceOffset: number;
  pendingTextHash: string;
  providerPublicationIdempotencyKey: string;
  sequence: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  assertValidRolloverBoundary(input);
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'sent',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_publication_idempotency_key = NULL,
          provider_progress_pending_sequence = NULL,
          provider_progress_pending_source_offset = NULL,
          provider_progress_pending_text_hash = NULL,
          provider_progress_pending_card_id = NULL,
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'rollover_finalize_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_sequence = ?
          AND provider_progress_pending_source_offset = ?
          AND provider_progress_pending_text_hash = ?
          AND provider_progress_pending_card_id IS NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.sequence,
      input.pendingSourceOffset,
      input.pendingTextHash
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverFinalizeOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  pendingSourceOffset: number;
  pendingTextHash: string;
  providerPublicationIdempotencyKey: string;
  sequence: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  assertValidRolloverBoundary(input);
  return await markRolloverClaimOutcomeUnknown({
    ...input,
    expectedState: "rollover_finalize_claimed",
  });
}

export async function claimRemoteAgentMessageChannelProviderCardRolloverCreation(
  input: ProviderProgressClaimInput
): Promise<ProviderProgressClaimResult> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'rollover_create_claimed',
          provider_progress_claim_id = ?,
          provider_progress_claimed_at_ms = ?,
          provider_progress_claim_expires_at_ms = ?,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND provider_progress_state = 'rollover_finalized'
          AND provider_progress_claim_id IS NULL
          AND provider_progress_pending_sequence IS NOT NULL
          AND provider_progress_pending_source_offset IS NOT NULL
          AND provider_progress_pending_text_hash IS NOT NULL
          AND provider_progress_pending_card_id IS NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND (
            final_publication_state IS NULL
            OR final_publication_state = 'claimed'
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.nowMs,
      input.idempotencyKey
    )
    .run();
  return await resolveClaimResult(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverCreationFailed(input: {
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
          provider_progress_state = 'rollover_finalized',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'rollover_create_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_pending_sequence IS NOT NULL
          AND provider_progress_pending_source_offset IS NOT NULL
          AND provider_progress_pending_text_hash IS NOT NULL
          AND provider_progress_pending_card_id IS NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(input.failureCode, input.nowMs, input.idempotencyKey, input.claimId)
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverCreated(input: {
  cardId: string;
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const cardId = input.cardId.trim();
  if (!cardId) {
    throw new Error("Message Channel rollover card id is required");
  }
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'rollover_created',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_pending_card_id = ?,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'rollover_create_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_pending_sequence IS NOT NULL
          AND provider_progress_pending_source_offset IS NOT NULL
          AND provider_progress_pending_text_hash IS NOT NULL
          AND provider_progress_pending_card_id IS NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(cardId, input.nowMs, input.idempotencyKey, input.claimId)
    .run();
  return await readAfterWrite(input, result);
}

export async function claimRemoteAgentMessageChannelProviderCardRolloverSend(
  input: ProviderProgressClaimInput & {
    providerPublicationIdempotencyKey: string;
  }
): Promise<ProviderProgressClaimResult> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'rollover_send_claimed',
          provider_progress_claim_id = ?,
          provider_progress_claimed_at_ms = CASE
            WHEN provider_progress_state = 'rollover_created' THEN ?
            ELSE provider_progress_claimed_at_ms
          END,
          provider_progress_claim_expires_at_ms = CASE
            WHEN provider_progress_state = 'rollover_created' THEN ?
            ELSE provider_progress_claim_expires_at_ms
          END,
          provider_progress_publication_idempotency_key = ?,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND status IN ('accepted', 'retry_observed')
          AND (
            (
              provider_progress_state = 'rollover_created'
              AND provider_progress_claim_id IS NULL
              AND provider_progress_publication_idempotency_key IS NULL
            )
            OR (
              provider_progress_state = 'rollover_send_claimed'
              AND provider_progress_claim_id = ?
              AND provider_progress_publication_idempotency_key = ?
            )
          )
          AND provider_progress_pending_sequence IS NOT NULL
          AND provider_progress_pending_source_offset IS NOT NULL
          AND provider_progress_pending_text_hash IS NOT NULL
          AND provider_progress_pending_card_id IS NOT NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND (
            final_publication_state IS NULL
            OR final_publication_state = 'claimed'
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.claimExpiresAtMs,
      input.providerPublicationIdempotencyKey,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return await resolveClaimResult(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverSendFailed(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'rollover_created',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_publication_idempotency_key = NULL,
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'rollover_send_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_card_id IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverSendOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return await markRolloverClaimOutcomeUnknown({
    ...input,
    expectedState: "rollover_send_claimed",
  });
}

export async function markRemoteAgentMessageChannelProviderCardRolloverSendExpired(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'rollover_send_outcome_unknown',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'rollover_send_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_claim_expires_at_ms <= ?
          AND provider_progress_pending_card_id IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey,
      input.nowMs
    )
    .run();
  return await readAfterWrite(input, result);
}

export async function markRemoteAgentMessageChannelProviderCardRolloverSent(input: {
  claimId: string;
  db: D1Database;
  idempotencyKey: string;
  messageId: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  if (!input.messageId.trim()) {
    throw new Error("Message Channel rollover message id is required");
  }
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = 'sent',
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_card_id = provider_progress_pending_card_id,
          provider_progress_publication_idempotency_key = NULL,
          provider_progress_sequence = provider_progress_pending_sequence,
          provider_progress_pending_sequence = NULL,
          provider_progress_source_offset =
            provider_progress_pending_source_offset,
          provider_progress_rollover_index =
            provider_progress_rollover_index + 1,
          provider_progress_pending_source_offset = NULL,
          provider_progress_pending_text_hash = NULL,
          provider_progress_pending_card_id = NULL,
          provider_progress_failure_code = NULL,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = 'rollover_send_claimed'
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_sequence IS NOT NULL
          AND provider_progress_pending_source_offset IS NOT NULL
          AND provider_progress_pending_text_hash IS NOT NULL
          AND provider_progress_pending_card_id IS NOT NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND (
            final_publication_state IS NULL
            OR final_publication_state = 'claimed'
          )
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.nowMs,
      input.idempotencyKey,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return await readAfterWrite(input, result);
}

async function markRolloverClaimOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  expectedState: "rollover_finalize_claimed" | "rollover_send_claimed";
  failureCode: string;
  idempotencyKey: string;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = ?
          AND provider_progress_claim_id = ?
          AND provider_progress_publication_idempotency_key = ?
          AND provider_progress_pending_sequence IS NOT NULL
          AND provider_progress_pending_source_offset IS NOT NULL
          AND provider_progress_pending_text_hash IS NOT NULL
          AND provider_progress_card_id IS NOT NULL
          AND provider_progress_message_id IS NOT NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.idempotencyKey,
      input.expectedState,
      input.claimId,
      input.providerPublicationIdempotencyKey
    )
    .run();
  return await readAfterWrite(input, result);
}

function assertValidRolloverBoundary(input: {
  pendingSourceOffset: number;
  pendingTextHash: string;
  providerPublicationIdempotencyKey: string;
  sequence: number;
}): void {
  if (
    !Number.isSafeInteger(input.sequence) ||
    input.sequence <= 0 ||
    !Number.isSafeInteger(input.pendingSourceOffset) ||
    input.pendingSourceOffset <= 0 ||
    !SHA256_HEX_PATTERN.test(input.pendingTextHash) ||
    !input.providerPublicationIdempotencyKey.trim()
  ) {
    throw new Error("Message Channel rollover boundary is invalid");
  }
}

async function markClaimedProviderProgressTerminal(input: {
  claimId: string;
  db: D1Database;
  expectedState: "create_claimed" | "send_claimed";
  failureCode: string;
  idempotencyKey: string;
  nextState: "create_outcome_unknown" | "send_outcome_unknown" | "unavailable";
  nowMs: number;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_native_delivery_ledger
        SET
          provider_progress_state = ?,
          provider_progress_claim_id = NULL,
          provider_progress_claimed_at_ms = NULL,
          provider_progress_claim_expires_at_ms = NULL,
          provider_progress_failure_code = ?,
          updated_at_ms = ?
        WHERE idempotency_key = ?
          AND conversation_kind = 'message_channel'
          AND provider_progress_state = ?
          AND provider_progress_claim_id = ?
          AND final_publication_state IS NULL
          AND provider_publication_result_id IS NULL
          AND published_signal_id IS NULL
      `
    )
    .bind(
      input.nextState,
      input.failureCode,
      input.nowMs,
      input.idempotencyKey,
      input.expectedState,
      input.claimId
    )
    .run();
  return await readAfterWrite(input, result);
}

async function resolveClaimResult(
  input: {
    db: D1Database;
    idempotencyKey: string;
  },
  result: D1Result
): Promise<ProviderProgressClaimResult> {
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey(input);
  return didD1Write(result) && delivery
    ? { delivery, status: "claimed" }
    : { delivery, status: "not_claimed" };
}

async function readAfterWrite(
  input: {
    db: D1Database;
    idempotencyKey: string;
  },
  result: D1Result
): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return didD1Write(result)
    ? await readRemoteAgentNativeDeliveryByIdempotencyKey(input)
    : null;
}

function didD1Write(result: D1Result): boolean {
  return Number(result.meta?.changes ?? 0) > 0;
}
