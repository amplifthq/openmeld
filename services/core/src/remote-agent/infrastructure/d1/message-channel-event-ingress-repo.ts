import type { MessageChannelProvider } from "@openmeld/schemas/types";

export type RemoteAgentMessageChannelEventIngressState =
  | "completed"
  | "failed"
  | "processing"
  | "queued";

export type RemoteAgentMessageChannelEventIngressRecord = {
  claimExpiresAtMs: number | null;
  claimId: string | null;
  completedAtMs: number | null;
  connectionId: string;
  deliveryAttemptCount: number;
  eventKey: string;
  failureReasonCode: string | null;
  firstReceivedAtMs: number;
  gatewayRequestId: string;
  lastReceivedAtMs: number;
  nativeDeliveryId: string | null;
  outcomeStatus: string | null;
  provider: MessageChannelProvider;
  providerEventId: string;
  providerRetrySequence: number | null;
  queueAttempts: number | null;
  queueMessageId: string | null;
  retryReasonCode: string | null;
  state: RemoteAgentMessageChannelEventIngressState;
  updatedAtMs: number;
};

type RemoteAgentMessageChannelEventIngressRow = {
  claim_expires_at_ms: number | null;
  claim_id: string | null;
  completed_at_ms: number | null;
  connection_id: string;
  delivery_attempt_count: number;
  event_key: string;
  failure_reason_code: string | null;
  first_received_at_ms: number;
  gateway_request_id: string;
  last_received_at_ms: number;
  native_delivery_id: string | null;
  outcome_status: string | null;
  provider: MessageChannelProvider;
  provider_event_id: string;
  provider_retry_sequence: number | null;
  queue_attempts: number | null;
  queue_message_id: string | null;
  retry_reason_code: string | null;
  state: RemoteAgentMessageChannelEventIngressState;
  updated_at_ms: number;
};

export function buildRemoteAgentMessageChannelEventKey(input: {
  connectionId: string;
  provider: MessageChannelProvider;
  providerEventId: string;
}): string {
  return [
    "message-channel-event-v1",
    input.provider,
    encodeURIComponent(input.connectionId),
    encodeURIComponent(input.providerEventId),
  ].join(":");
}

export async function claimRemoteAgentMessageChannelEventIngress(input: {
  claimExpiresAtMs: number;
  claimId: string;
  connectionId: string;
  db: D1Database;
  gatewayRequestId: string;
  nowMs: number;
  provider: MessageChannelProvider;
  providerEventId: string;
  providerRetrySequence: number | null;
  queueAttempts: number | null;
  queueMessageId: string | null;
  receivedAtMs: number;
  retryReasonCode: string | null;
}): Promise<
  | { record: RemoteAgentMessageChannelEventIngressRecord; status: "claimed" }
  | {
      record: RemoteAgentMessageChannelEventIngressRecord;
      status: "duplicate";
    }
> {
  if (input.claimExpiresAtMs <= input.nowMs) {
    throw new Error("Message Channel event claim must expire in the future");
  }
  const eventKey = buildRemoteAgentMessageChannelEventKey(input);
  const recordAttempt = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_message_channel_event_ingress (
          event_key,
          provider,
          connection_id,
          provider_event_id,
          state,
          claim_id,
          claim_expires_at_ms,
          first_received_at_ms,
          last_received_at_ms,
          delivery_attempt_count,
          provider_retry_sequence,
          retry_reason_code,
          gateway_request_id,
          queue_message_id,
          queue_attempts,
          native_delivery_id,
          outcome_status,
          failure_reason_code,
          completed_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, 'queued', NULL, NULL, ?, ?, 1, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)
        ON CONFLICT(event_key) DO UPDATE SET
          last_received_at_ms = excluded.last_received_at_ms,
          delivery_attempt_count = delivery_attempt_count + 1,
          provider_retry_sequence = excluded.provider_retry_sequence,
          retry_reason_code = excluded.retry_reason_code,
          gateway_request_id = excluded.gateway_request_id,
          queue_message_id = excluded.queue_message_id,
          queue_attempts = excluded.queue_attempts,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
      eventKey,
      input.provider,
      input.connectionId,
      input.providerEventId,
      input.receivedAtMs,
      input.receivedAtMs,
      input.providerRetrySequence,
      input.retryReasonCode,
      input.gatewayRequestId,
      input.queueMessageId,
      input.queueAttempts,
      input.nowMs
    );
  const acquireClaim = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_message_channel_event_ingress
        SET
          state = 'processing',
          claim_id = ?,
          claim_expires_at_ms = ?,
          outcome_status = NULL,
          failure_reason_code = NULL,
          completed_at_ms = NULL,
          updated_at_ms = ?
        WHERE event_key = ?
          AND (
            state = 'queued'
            OR (
              state = 'processing'
              AND (
                claim_expires_at_ms IS NULL
                OR claim_expires_at_ms <= ?
              )
            )
          )
      `
    )
    .bind(
      input.claimId,
      input.claimExpiresAtMs,
      input.nowMs,
      eventKey,
      input.nowMs
    );
  await input.db.batch([recordAttempt, acquireClaim]);
  const record = await readRemoteAgentMessageChannelEventIngress({
    db: input.db,
    eventKey,
  });
  if (!record) {
    throw new Error(
      "Remote Agent Message Channel event claim did not produce a durable row"
    );
  }
  return record.claimId === input.claimId && record.state === "processing"
    ? { record, status: "claimed" }
    : { record, status: "duplicate" };
}

export async function completeRemoteAgentMessageChannelEventIngress(input: {
  claimId: string;
  db: D1Database;
  eventKey: string;
  nativeDeliveryId: string | null;
  nowMs: number;
  outcomeStatus: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_message_channel_event_ingress
        SET
          state = 'completed',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          native_delivery_id = COALESCE(native_delivery_id, ?),
          outcome_status = ?,
          failure_reason_code = NULL,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE event_key = ?
          AND state = 'processing'
          AND claim_id = ?
          AND claim_expires_at_ms > ?
      `
    )
    .bind(
      input.nativeDeliveryId,
      input.outcomeStatus,
      input.nowMs,
      input.nowMs,
      input.eventKey,
      input.claimId,
      input.nowMs
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function releaseRemoteAgentMessageChannelEventIngressForRetry(input: {
  claimId: string;
  db: D1Database;
  eventKey: string;
  failureReasonCode: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_message_channel_event_ingress
        SET
          state = 'queued',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          failure_reason_code = ?,
          updated_at_ms = ?
        WHERE event_key = ?
          AND state = 'processing'
          AND claim_id = ?
          AND claim_expires_at_ms > ?
      `
    )
    .bind(
      input.failureReasonCode,
      input.nowMs,
      input.eventKey,
      input.claimId,
      input.nowMs
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function failRemoteAgentMessageChannelEventIngress(input: {
  claimId: string;
  db: D1Database;
  eventKey: string;
  failureReasonCode: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_message_channel_event_ingress
        SET
          state = 'failed',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          outcome_status = 'failed',
          failure_reason_code = ?,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE event_key = ?
          AND state = 'processing'
          AND claim_id = ?
          AND claim_expires_at_ms > ?
      `
    )
    .bind(
      input.failureReasonCode,
      input.nowMs,
      input.nowMs,
      input.eventKey,
      input.claimId,
      input.nowMs
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function readRemoteAgentMessageChannelEventIngress(input: {
  db: D1Database;
  eventKey: string;
}): Promise<RemoteAgentMessageChannelEventIngressRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          event_key,
          provider,
          connection_id,
          provider_event_id,
          state,
          claim_id,
          claim_expires_at_ms,
          first_received_at_ms,
          last_received_at_ms,
          delivery_attempt_count,
          provider_retry_sequence,
          retry_reason_code,
          gateway_request_id,
          queue_message_id,
          queue_attempts,
          native_delivery_id,
          outcome_status,
          failure_reason_code,
          completed_at_ms,
          updated_at_ms
        FROM openMeldRemoteAgent_message_channel_event_ingress
        WHERE event_key = ?
        LIMIT 1
      `
    )
    .bind(input.eventKey)
    .first<RemoteAgentMessageChannelEventIngressRow>();
  return row ? mapMessageChannelEventIngressRow(row) : null;
}

function mapMessageChannelEventIngressRow(
  row: RemoteAgentMessageChannelEventIngressRow
): RemoteAgentMessageChannelEventIngressRecord {
  return {
    claimExpiresAtMs: row.claim_expires_at_ms,
    claimId: row.claim_id,
    completedAtMs: row.completed_at_ms,
    connectionId: row.connection_id,
    deliveryAttemptCount: row.delivery_attempt_count,
    eventKey: row.event_key,
    failureReasonCode: row.failure_reason_code,
    firstReceivedAtMs: row.first_received_at_ms,
    gatewayRequestId: row.gateway_request_id,
    lastReceivedAtMs: row.last_received_at_ms,
    nativeDeliveryId: row.native_delivery_id,
    outcomeStatus: row.outcome_status,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerRetrySequence: row.provider_retry_sequence,
    queueAttempts: row.queue_attempts,
    queueMessageId: row.queue_message_id,
    retryReasonCode: row.retry_reason_code,
    state: row.state,
    updatedAtMs: row.updated_at_ms,
  };
}
