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
  claimId: string;
  db: D1Database;
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
      .prepare(
        `
          INSERT INTO slack_installation_welcome_deliveries (
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
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 1, NULL, NULL, ?, ?)
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
        `
      )
      .bind(
        input.key.slackTeamId,
        input.key.organizationId,
        input.key.recipientSlackUserId,
        input.key.connectionCreatedAtMs,
        input.key.welcomeVersion,
        input.messageKind,
        input.claimId,
        input.nowMs,
        input.nowMs
      )
      .first<SlackInstallationWelcomeDeliveryRow>();
    if (inserted) {
      return mapSlackInstallationWelcomeClaim(inserted);
    }
  }

  const retried = await input.db
    .prepare(
      `
        UPDATE slack_installation_welcome_deliveries
        SET
          status = 'pending',
          claim_id = ?,
          attempt_count = attempt_count + 1,
          message_ts = NULL,
          failure_code = NULL,
          updated_at_ms = ?
        WHERE
          slack_team_id = ?
          AND organization_id = ?
          AND recipient_slack_user_id = ?
          AND connection_created_at_ms = ?
          AND welcome_version = ?
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
      `
    )
    .bind(
      input.claimId,
      input.nowMs,
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion
    )
    .first<SlackInstallationWelcomeDeliveryRow>();
  return retried ? mapSlackInstallationWelcomeClaim(retried) : null;
}

export async function completeSlackInstallationWelcomeDelivery(input: {
  claim: SlackInstallationWelcomeClaim;
  db: D1Database;
  failureCode: string | null;
  messageTs: string | null;
  nowMs: number;
  status: Exclude<SlackInstallationWelcomeDeliveryStatus, "pending">;
}): Promise<void> {
  const completed = await input.db
    .prepare(
      `
        UPDATE slack_installation_welcome_deliveries
        SET
          status = ?,
          message_ts = ?,
          failure_code = ?,
          updated_at_ms = ?
        WHERE
          slack_team_id = ?
          AND organization_id = ?
          AND recipient_slack_user_id = ?
          AND connection_created_at_ms = ?
          AND welcome_version = ?
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
      input.claim.key.slackTeamId,
      input.claim.key.organizationId,
      input.claim.key.recipientSlackUserId,
      input.claim.key.connectionCreatedAtMs,
      input.claim.key.welcomeVersion,
      input.claim.claimId
    )
    .first<{ status: SlackInstallationWelcomeDeliveryStatus }>();
  if (!completed) {
    throw new Error(
      "Slack installation welcome claim was no longer pending during completion"
    );
  }
}

export async function readSlackInstallationWelcomeDeliveryStatus(input: {
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
}): Promise<SlackInstallationWelcomeDeliveryStatus | null> {
  const row = await input.db
    .prepare(
      `
        SELECT status
        FROM slack_installation_welcome_deliveries
        WHERE slack_team_id = ?
          AND organization_id = ?
          AND recipient_slack_user_id = ?
          AND connection_created_at_ms = ?
          AND welcome_version = ?
        LIMIT 1
      `
    )
    .bind(
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion
    )
    .first<{ status: SlackInstallationWelcomeDeliveryStatus }>();
  return row?.status ?? null;
}

async function markStaleSlackInstallationWelcomePendingOutcomeUnknown(input: {
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE slack_installation_welcome_deliveries
        SET
          status = 'outcome_unknown',
          failure_code = 'stale_pending',
          updated_at_ms = ?
        WHERE
          slack_team_id = ?
          AND organization_id = ?
          AND recipient_slack_user_id = ?
          AND connection_created_at_ms = ?
          AND welcome_version = ?
          AND status = 'pending'
          AND updated_at_ms <= ?
      `
    )
    .bind(
      input.nowMs,
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion,
      input.nowMs - STALE_PENDING_WELCOME_MS
    )
    .run();
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
