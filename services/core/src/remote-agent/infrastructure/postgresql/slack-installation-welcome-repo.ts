import type { PostgresDatabase } from "@openmeld/db/postgresql";
export const SLACK_INSTALLATION_WELCOME_VERSION = 2;
export type SlackInstallationWelcomeMessageKind = "connected" | "moved";
export type SlackInstallationWelcomeDeliveryStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "outcome_unknown";
export type SlackInstallationWelcomeDeliveryKey = {
  connectionCreatedAtMs: number;
  organizationId: string;
  recipientSlackUserId: string;
  slackTeamId: string;
  welcomeVersion: number;
};
export type SlackInstallationWelcomeClaim = {
  attemptCount: number;
  claimId: string;
  key: SlackInstallationWelcomeDeliveryKey;
  messageKind: SlackInstallationWelcomeMessageKind;
};
type SlackInstallationWelcomeDeliveryRow = {
  attempt_count: number;
  claim_id: string;
  connection_created_at_ms: number;
  message_kind: SlackInstallationWelcomeMessageKind;
  organization_id: string;
  recipient_slack_user_id: string;
  slack_team_id: string;
  welcome_version: number;
};
const STALE_PENDING_WELCOME_MS = 5 * 60 * 1000;
export async function claimSlackInstallationWelcomeDelivery(input: {
  allowCreate: boolean;
  allowRetry: boolean;
  claimId: string;
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  messageKind: SlackInstallationWelcomeMessageKind;
  nowMs: number;
}): Promise<SlackInstallationWelcomeClaim | null> {
  await markStaleSlackInstallationWelcomePendingOutcomeUnknown({
    db: input.db,
    key: input.key,
    nowMs: input.nowMs,
  });
  if (input.allowCreate) {
    const inserted = await input.db
      .query<SlackInstallationWelcomeDeliveryRow>({
        text: `
          INSERT INTO "openmeld"."slack_installation_welcome_deliveries" (
            slack_team_id,
            organization_id,
            recipient_slack_user_id,
            connection_created_at_ms,
            welcome_version,
            message_kind,
            status,
            claim_id,
            attempt_count,
            message_ts,
            failure_code,
            created_at_ms,
            updated_at_ms
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, 1, NULL, NULL, $8, $9)
          ON CONFLICT DO NOTHING
          RETURNING
            slack_team_id,
            organization_id,
            recipient_slack_user_id,
            connection_created_at_ms,
            welcome_version,
            message_kind,
            claim_id,
            attempt_count
        `,
        values: [
          input.key.slackTeamId,
          input.key.organizationId,
          input.key.recipientSlackUserId,
          input.key.connectionCreatedAtMs,
          input.key.welcomeVersion,
          input.messageKind,
          input.claimId,
          input.nowMs,
          input.nowMs,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    if (inserted) {
      return mapSlackInstallationWelcomeClaim(inserted);
    }
  }
  if (!input.allowRetry) {
    return null;
  }
  const retried = await input.db
    .query<SlackInstallationWelcomeDeliveryRow>({
      text: `
        UPDATE "openmeld"."slack_installation_welcome_deliveries"
        SET
          status = 'pending',
          claim_id = $1,
          attempt_count = attempt_count + 1,
          message_ts = NULL,
          failure_code = NULL,
          updated_at_ms = $2
        WHERE
          slack_team_id = $3
          AND organization_id = $4
          AND recipient_slack_user_id = $5
          AND connection_created_at_ms = $6
          AND welcome_version = $7
          AND status = 'failed'
        RETURNING
          slack_team_id,
          organization_id,
          recipient_slack_user_id,
          connection_created_at_ms,
          welcome_version,
          message_kind,
          claim_id,
          attempt_count
      `,
      values: [
        input.claimId,
        input.nowMs,
        input.key.slackTeamId,
        input.key.organizationId,
        input.key.recipientSlackUserId,
        input.key.connectionCreatedAtMs,
        input.key.welcomeVersion,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return retried ? mapSlackInstallationWelcomeClaim(retried) : null;
}
export async function completeSlackInstallationWelcomeDelivery(input: {
  claim: SlackInstallationWelcomeClaim;
  db: PostgresDatabase;
  failureCode: string | null;
  messageTs: string | null;
  nowMs: number;
  status: Exclude<SlackInstallationWelcomeDeliveryStatus, "pending">;
}): Promise<void> {
  const completed = await input.db
    .query<{
      status: SlackInstallationWelcomeDeliveryStatus;
    }>({
      text: `
        UPDATE "openmeld"."slack_installation_welcome_deliveries"
        SET
          status = $1,
          message_ts = $2,
          failure_code = $3,
          updated_at_ms = $4
        WHERE
          slack_team_id = $5
          AND organization_id = $6
          AND recipient_slack_user_id = $7
          AND connection_created_at_ms = $8
          AND welcome_version = $9
          AND claim_id = $10
          AND status = 'pending'
        RETURNING status
      `,
      values: [
        input.status,
        input.messageTs,
        input.failureCode,
        input.nowMs,
        input.claim.key.slackTeamId,
        input.claim.key.organizationId,
        input.claim.key.recipientSlackUserId,
        input.claim.key.connectionCreatedAtMs,
        input.claim.key.welcomeVersion,
        input.claim.claimId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!completed) {
    throw new Error(
      "Slack installation welcome claim was no longer pending during completion"
    );
  }
}
export async function readSlackInstallationWelcomeDeliveryStatus(input: {
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
}): Promise<SlackInstallationWelcomeDeliveryStatus | null> {
  const row = await input.db
    .query<{
      status: SlackInstallationWelcomeDeliveryStatus;
    }>({
      text: `
        SELECT status
        FROM "openmeld"."slack_installation_welcome_deliveries"
        WHERE slack_team_id = $1
          AND organization_id = $2
          AND recipient_slack_user_id = $3
          AND connection_created_at_ms = $4
          AND welcome_version = $5
        LIMIT 1
      `,
      values: [
        input.key.slackTeamId,
        input.key.organizationId,
        input.key.recipientSlackUserId,
        input.key.connectionCreatedAtMs,
        input.key.welcomeVersion,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row?.status ?? null;
}
async function markStaleSlackInstallationWelcomePendingOutcomeUnknown(input: {
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_installation_welcome_deliveries"
        SET
          status = 'outcome_unknown',
          failure_code = 'stale_pending',
          updated_at_ms = $1
        WHERE
          slack_team_id = $2
          AND organization_id = $3
          AND recipient_slack_user_id = $4
          AND connection_created_at_ms = $5
          AND welcome_version = $6
          AND status = 'pending'
          AND updated_at_ms <= $7
      `,
    values: [
      input.nowMs,
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion,
      input.nowMs - STALE_PENDING_WELCOME_MS,
    ],
  });
}
function mapSlackInstallationWelcomeClaim(
  row: SlackInstallationWelcomeDeliveryRow
): SlackInstallationWelcomeClaim {
  return {
    attemptCount: row.attempt_count,
    claimId: row.claim_id,
    key: {
      connectionCreatedAtMs: row.connection_created_at_ms,
      organizationId: row.organization_id,
      recipientSlackUserId: row.recipient_slack_user_id,
      slackTeamId: row.slack_team_id,
      welcomeVersion: row.welcome_version,
    },
    messageKind: row.message_kind,
  };
}
