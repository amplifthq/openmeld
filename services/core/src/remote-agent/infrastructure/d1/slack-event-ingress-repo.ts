export type RemoteAgentSlackEventIngressState =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type RemoteAgentSlackEventIngressRecord = {
  claimExpiresAtMs: number | null;
  claimId: string | null;
  completedAtMs: number | null;
  deliveryAttemptCount: number;
  eventId: string | null;
  eventKey: string;
  failureCode: string | null;
  firstReceivedAtMs: number;
  gatewayRequestId: string;
  lastReceivedAtMs: number;
  outcomeStatus: string | null;
  queueAttempts: number | null;
  queueMessageId: string | null;
  slackRetryNum: number | null;
  slackRetryReason: string | null;
  slackTeamId: string;
  state: RemoteAgentSlackEventIngressState;
  updatedAtMs: number;
};

type RemoteAgentSlackEventIngressRow = {
  claim_expires_at_ms: number | null;
  claim_id: string | null;
  completed_at_ms: number | null;
  delivery_attempt_count: number;
  event_id: string | null;
  event_key: string;
  failure_code: string | null;
  first_received_at_ms: number;
  gateway_request_id: string;
  last_received_at_ms: number;
  outcome_status: string | null;
  queue_attempts: number | null;
  queue_message_id: string | null;
  slack_retry_num: number | null;
  slack_retry_reason: string | null;
  slack_team_id: string;
  state: RemoteAgentSlackEventIngressState;
  updated_at_ms: number;
};

export async function claimRemoteAgentSlackEventIngress(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: D1Database;
  eventId: string | null;
  eventKey: string;
  gatewayRequestId: string;
  nowMs: number;
  queueAttempts: number | null;
  queueMessageId: string | null;
  receivedAtMs: number;
  slackRetryNum: number | null;
  slackRetryReason: string | null;
  slackTeamId: string;
}): Promise<
  | { record: RemoteAgentSlackEventIngressRecord; status: "claimed" }
  | { record: RemoteAgentSlackEventIngressRecord; status: "duplicate" }
> {
  const recordAttempt = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_slack_event_ingress (
          event_key,
          event_id,
          slack_team_id,
          state,
          first_received_at_ms,
          last_received_at_ms,
          delivery_attempt_count,
          slack_retry_num,
          slack_retry_reason,
          gateway_request_id,
          queue_message_id,
          queue_attempts,
          updated_at_ms
        )
        VALUES (?, ?, ?, 'queued', ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_key) DO UPDATE SET
          last_received_at_ms = excluded.last_received_at_ms,
          delivery_attempt_count = delivery_attempt_count + 1,
          slack_retry_num = excluded.slack_retry_num,
          slack_retry_reason = excluded.slack_retry_reason,
          gateway_request_id = excluded.gateway_request_id,
          queue_message_id = excluded.queue_message_id,
          queue_attempts = excluded.queue_attempts,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
      input.eventKey,
      input.eventId,
      input.slackTeamId,
      input.receivedAtMs,
      input.receivedAtMs,
      input.slackRetryNum,
      input.slackRetryReason,
      input.gatewayRequestId,
      input.queueMessageId,
      input.queueAttempts,
      input.nowMs
    );
  const acquireClaim = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_slack_event_ingress
        SET
          state = 'processing',
          claim_id = ?,
          claim_expires_at_ms = ?,
          outcome_status = NULL,
          failure_code = NULL,
          completed_at_ms = NULL,
          updated_at_ms = ?
        WHERE event_key = ?
          AND (
            state = 'queued'
            OR state = 'failed'
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
      input.eventKey,
      input.nowMs
    );

  await input.db.batch([recordAttempt, acquireClaim]);
  const record = await readRemoteAgentSlackEventIngress({
    db: input.db,
    eventKey: input.eventKey,
  });
  if (!record) {
    throw new Error("Slack event ingress claim did not produce a durable row");
  }
  return record.claimId === input.claimId && record.state === "processing"
    ? { record, status: "claimed" }
    : { record, status: "duplicate" };
}

export async function completeRemoteAgentSlackEventIngress(input: {
  claimId: string;
  db: D1Database;
  eventKey: string;
  nowMs: number;
  outcomeStatus: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_slack_event_ingress
        SET
          state = 'completed',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          outcome_status = ?,
          failure_code = NULL,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE event_key = ?
          AND state = 'processing'
          AND claim_id = ?
      `
    )
    .bind(
      input.outcomeStatus,
      input.nowMs,
      input.nowMs,
      input.eventKey,
      input.claimId
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function releaseRemoteAgentSlackEventIngressForRetry(input: {
  claimId: string;
  db: D1Database;
  eventKey: string;
  failureCode: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_slack_event_ingress
        SET
          state = 'queued',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          failure_code = ?,
          updated_at_ms = ?
        WHERE event_key = ?
          AND state = 'processing'
          AND claim_id = ?
      `
    )
    .bind(input.failureCode, input.nowMs, input.eventKey, input.claimId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function failRemoteAgentSlackEventIngress(input: {
  claimId: string;
  db: D1Database;
  eventKey: string;
  failureCode: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_slack_event_ingress
        SET
          state = 'failed',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          outcome_status = 'failed',
          failure_code = ?,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE event_key = ?
          AND state = 'processing'
          AND claim_id = ?
      `
    )
    .bind(
      input.failureCode,
      input.nowMs,
      input.nowMs,
      input.eventKey,
      input.claimId
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function readRemoteAgentSlackEventIngress(input: {
  db: D1Database;
  eventKey: string;
}): Promise<RemoteAgentSlackEventIngressRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          event_key,
          event_id,
          slack_team_id,
          state,
          claim_id,
          claim_expires_at_ms,
          first_received_at_ms,
          last_received_at_ms,
          delivery_attempt_count,
          slack_retry_num,
          slack_retry_reason,
          gateway_request_id,
          queue_message_id,
          queue_attempts,
          outcome_status,
          failure_code,
          completed_at_ms,
          updated_at_ms
        FROM openMeldRemoteAgent_slack_event_ingress
        WHERE event_key = ?
        LIMIT 1
      `
    )
    .bind(input.eventKey)
    .first<RemoteAgentSlackEventIngressRow>();
  return row ? mapRemoteAgentSlackEventIngressRow(row) : null;
}

export async function countStrandedRemoteAgentSlackEventIngress(input: {
  db: D1Database;
  nowMs: number;
}): Promise<number> {
  const row = await input.db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM openMeldRemoteAgent_slack_event_ingress
        WHERE state = 'processing'
          AND (
            claim_expires_at_ms IS NULL
            OR claim_expires_at_ms <= ?
          )
      `
    )
    .bind(input.nowMs)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function mapRemoteAgentSlackEventIngressRow(
  row: RemoteAgentSlackEventIngressRow
): RemoteAgentSlackEventIngressRecord {
  return {
    claimExpiresAtMs: row.claim_expires_at_ms,
    claimId: row.claim_id,
    completedAtMs: row.completed_at_ms,
    deliveryAttemptCount: Number(row.delivery_attempt_count),
    eventId: row.event_id,
    eventKey: row.event_key,
    failureCode: row.failure_code,
    firstReceivedAtMs: row.first_received_at_ms,
    gatewayRequestId: row.gateway_request_id,
    lastReceivedAtMs: row.last_received_at_ms,
    outcomeStatus: row.outcome_status,
    queueAttempts: row.queue_attempts,
    queueMessageId: row.queue_message_id,
    slackRetryNum: row.slack_retry_num,
    slackRetryReason: row.slack_retry_reason,
    slackTeamId: row.slack_team_id,
    state: row.state,
    updatedAtMs: row.updated_at_ms,
  };
}
