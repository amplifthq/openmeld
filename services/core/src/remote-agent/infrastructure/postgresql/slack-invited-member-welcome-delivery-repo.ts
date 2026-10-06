import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
  key: SlackInvitedMemberWelcomeDeliveryKey;
  nowMs: number;
}): Promise<SlackInvitedMemberWelcomeDeliveryClaim | null> {
  await markStalePendingOutcomeUnknown(input);
  const inserted = await input.db
    .query<SlackInvitedMemberWelcomeDeliveryRow>({
      text: `
        INSERT INTO "openmeld"."slack_invited_member_welcome_deliveries" (
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
        ) VALUES ($1, $2, $3, 'pending', $4, 1, NULL, NULL, $5, $6)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      values: [
        input.key.interactionId,
        input.key.targetSlackUserId,
        input.key.researchTaskId,
        input.claimId,
        input.nowMs,
        input.nowMs,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (inserted) {
    return mapClaim(inserted);
  }
  const retried = await input.db
    .query<SlackInvitedMemberWelcomeDeliveryRow>({
      text: `
        UPDATE "openmeld"."slack_invited_member_welcome_deliveries"
        SET
          status = 'pending',
          claim_id = $1,
          attempt_count = attempt_count + 1,
          message_ts = NULL,
          failure_code = NULL,
          updated_at_ms = $2
        WHERE interaction_id = $3
          AND target_slack_user_id = $4
          AND research_task_id IS NOT DISTINCT FROM $5
          AND status = 'failed'
        RETURNING *
      `,
      values: [
        input.claimId,
        input.nowMs,
        input.key.interactionId,
        input.key.targetSlackUserId,
        input.key.researchTaskId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return retried ? mapClaim(retried) : null;
}
export async function completeSlackInvitedMemberWelcomeDelivery(input: {
  claim: SlackInvitedMemberWelcomeDeliveryClaim;
  db: PostgresDatabase;
  failureCode: string | null;
  messageTs: string | null;
  nowMs: number;
  status: Exclude<SlackInvitedMemberWelcomeDeliveryStatus, "pending">;
}): Promise<void> {
  const completed = await input.db
    .query<{
      status: SlackInvitedMemberWelcomeDeliveryStatus;
    }>({
      text: `
        UPDATE "openmeld"."slack_invited_member_welcome_deliveries"
        SET status = $1, message_ts = $2, failure_code = $3, updated_at_ms = $4
        WHERE interaction_id = $5
          AND target_slack_user_id = $6
          AND research_task_id IS NOT DISTINCT FROM $7
          AND claim_id = $8
          AND status = 'pending'
        RETURNING status
      `,
      values: [
        input.status,
        input.messageTs,
        input.failureCode,
        input.nowMs,
        input.claim.key.interactionId,
        input.claim.key.targetSlackUserId,
        input.claim.key.researchTaskId,
        input.claim.claimId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!completed) {
    throw new Error("Slack invited-member welcome claim is no longer pending.");
  }
}
export async function readSlackInvitedMemberWelcomeDelivery(input: {
  db: PostgresDatabase;
  key: SlackInvitedMemberWelcomeDeliveryKey;
}): Promise<SlackInvitedMemberWelcomeDelivery | null> {
  const row = await input.db
    .query<{
      failure_code: string | null;
      message_ts: string | null;
      research_task_id: string | null;
      status: SlackInvitedMemberWelcomeDeliveryStatus;
    }>({
      text: `
        SELECT research_task_id, status, message_ts, failure_code
        FROM "openmeld"."slack_invited_member_welcome_deliveries"
        WHERE interaction_id = $1 AND target_slack_user_id = $2
        LIMIT 1
      `,
      values: [input.key.interactionId, input.key.targetSlackUserId],
    })
    .then((result) => result.rows[0] ?? null);
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
  db: PostgresDatabase;
  key: SlackInvitedMemberWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_invited_member_welcome_deliveries"
        SET
          status = 'outcome_unknown',
          failure_code = 'stale_pending',
          updated_at_ms = $1
        WHERE interaction_id = $2
          AND target_slack_user_id = $3
          AND research_task_id IS NOT DISTINCT FROM $4
          AND status = 'pending'
          AND updated_at_ms <= $5
      `,
    values: [
      input.nowMs,
      input.key.interactionId,
      input.key.targetSlackUserId,
      input.key.researchTaskId,
      input.nowMs - STALE_PENDING_WELCOME_MS,
    ],
  });
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
