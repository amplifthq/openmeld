export type SlackInvitedMemberWelcomeDeliveryStatus =
  | "delivered"
  | "failed"
  | "outcome_unknown"
  | "pending";

export type SlackInvitedMemberWelcomeDeliveryKey = {
  interactionId: string;
  researchTaskId: string | null;
  targetSlackUserId: string;
};

export type SlackInvitedMemberWelcomeDelivery = {
  failureCode: string | null;
  messageTs: string | null;
  status: SlackInvitedMemberWelcomeDeliveryStatus;
};

export type SlackInvitedMemberWelcomeDeliveryClaim = {
  attemptCount: number;
  claimId: string;
  key: SlackInvitedMemberWelcomeDeliveryKey;
};

type SlackInvitedMemberWelcomeDeliveryRow = {
  attempt_count: number;
  claim_id: string;
  failure_code: string | null;
  interaction_id: string;
  message_ts: string | null;
  research_task_id: string | null;
  status: SlackInvitedMemberWelcomeDeliveryStatus;
  target_slack_user_id: string;
};

const STALE_PENDING_WELCOME_MS = 5 * 60 * 1000;

export async function claimSlackInvitedMemberWelcomeDelivery(input: {
  claimId: string;
  db: D1Database;
  key: SlackInvitedMemberWelcomeDeliveryKey;
  nowMs: number;
}): Promise<SlackInvitedMemberWelcomeDeliveryClaim | null> {
  await markStalePendingOutcomeUnknown(input);
  const inserted = await input.db
    .prepare(
      `
        INSERT INTO slack_invited_member_welcome_deliveries (
          interaction_id,
          target_slack_user_id,
          research_task_id,
          status,
          claim_id,
          attempt_count,
          message_ts,
          failure_code,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, 'pending', ?, 1, NULL, NULL, ?, ?)
        ON CONFLICT DO NOTHING
        RETURNING *
      `
    )
    .bind(
      input.key.interactionId,
      input.key.targetSlackUserId,
      input.key.researchTaskId,
      input.claimId,
      input.nowMs,
      input.nowMs
    )
    .first<SlackInvitedMemberWelcomeDeliveryRow>();
  if (inserted) {
    return mapClaim(inserted);
  }

  const retried = await input.db
    .prepare(
      `
        UPDATE slack_invited_member_welcome_deliveries
        SET
          status = 'pending',
          claim_id = ?,
          attempt_count = attempt_count + 1,
          message_ts = NULL,
          failure_code = NULL,
          updated_at_ms = ?
        WHERE interaction_id = ?
          AND target_slack_user_id = ?
          AND research_task_id IS ?
          AND status = 'failed'
        RETURNING *
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.key.interactionId,
      input.key.targetSlackUserId,
      input.key.researchTaskId
    )
    .first<SlackInvitedMemberWelcomeDeliveryRow>();
  return retried ? mapClaim(retried) : null;
}

export async function completeSlackInvitedMemberWelcomeDelivery(input: {
  claim: SlackInvitedMemberWelcomeDeliveryClaim;
  db: D1Database;
  failureCode: string | null;
  messageTs: string | null;
  nowMs: number;
  status: Exclude<SlackInvitedMemberWelcomeDeliveryStatus, "pending">;
}): Promise<void> {
  const completed = await input.db
    .prepare(
      `
        UPDATE slack_invited_member_welcome_deliveries
        SET status = ?, message_ts = ?, failure_code = ?, updated_at_ms = ?
        WHERE interaction_id = ?
          AND target_slack_user_id = ?
          AND research_task_id IS ?
          AND claim_id = ?
          AND status = 'pending'
        RETURNING status
      `
    )
    .bind(
      input.status,
      input.messageTs,
      input.failureCode,
      input.nowMs,
      input.claim.key.interactionId,
      input.claim.key.targetSlackUserId,
      input.claim.key.researchTaskId,
      input.claim.claimId
    )
    .first<{ status: SlackInvitedMemberWelcomeDeliveryStatus }>();
  if (!completed) {
    throw new Error("Slack invited-member welcome claim is no longer pending.");
  }
}

export async function readSlackInvitedMemberWelcomeDelivery(input: {
  db: D1Database;
  key: SlackInvitedMemberWelcomeDeliveryKey;
}): Promise<SlackInvitedMemberWelcomeDelivery | null> {
  const row = await input.db
    .prepare(
      `
        SELECT research_task_id, status, message_ts, failure_code
        FROM slack_invited_member_welcome_deliveries
        WHERE interaction_id = ? AND target_slack_user_id = ?
        LIMIT 1
      `
    )
    .bind(input.key.interactionId, input.key.targetSlackUserId)
    .first<{
      failure_code: string | null;
      message_ts: string | null;
      research_task_id: string | null;
      status: SlackInvitedMemberWelcomeDeliveryStatus;
    }>();
  if (!row) {
    return null;
  }
  if (row.research_task_id !== input.key.researchTaskId) {
    throw new Error(
      "Slack invited-member welcome belongs to a different research task."
    );
  }
  return {
    failureCode: row.failure_code,
    messageTs: row.message_ts,
    status: row.status,
  };
}

async function markStalePendingOutcomeUnknown(input: {
  db: D1Database;
  key: SlackInvitedMemberWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE slack_invited_member_welcome_deliveries
        SET
          status = 'outcome_unknown',
          failure_code = 'stale_pending',
          updated_at_ms = ?
        WHERE interaction_id = ?
          AND target_slack_user_id = ?
          AND research_task_id IS ?
          AND status = 'pending'
          AND updated_at_ms <= ?
      `
    )
    .bind(
      input.nowMs,
      input.key.interactionId,
      input.key.targetSlackUserId,
      input.key.researchTaskId,
      input.nowMs - STALE_PENDING_WELCOME_MS
    )
    .run();
}

function mapClaim(
  row: SlackInvitedMemberWelcomeDeliveryRow
): SlackInvitedMemberWelcomeDeliveryClaim {
  return {
    attemptCount: Number(row.attempt_count),
    claimId: row.claim_id,
    key: {
      interactionId: row.interaction_id,
      researchTaskId: row.research_task_id,
      targetSlackUserId: row.target_slack_user_id,
    },
  };
}
