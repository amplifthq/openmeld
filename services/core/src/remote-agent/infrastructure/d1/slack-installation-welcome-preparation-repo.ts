import {
  SLACK_INSTALLATION_WELCOME_VERSION,
  type SlackInstallationWelcomeDeliveryKey,
  type SlackInstallationWelcomeMessageKind,
} from "./slack-installation-welcome-repo";

export type SlackInstallationWelcomePreparation = {
  claimId: string;
  failureCode: string | null;
  installedByProfileId: string;
  installedByUserId: string;
  key: SlackInstallationWelcomeDeliveryKey;
  messageKind: SlackInstallationWelcomeMessageKind;
  researchTaskId: string | null;
  status: "researching" | "ready";
};

type PreparationRow = {
  claim_id: string;
  connection_created_at_ms: number;
  failure_code: string | null;
  installed_by_profile_id: string;
  installed_by_user_id: string;
  message_kind: SlackInstallationWelcomeMessageKind;
  organization_id: string;
  recipient_slack_user_id: string;
  research_task_id: string | null;
  slack_team_id: string;
  status: "researching" | "ready";
  welcome_version: number;
};

const STALE_UNSTARTED_PREPARATION_MS = 5 * 60 * 1000;

export async function enqueueSlackInstallationWelcomePreparation(input: {
  allowCreate: boolean;
  connectionCreatedAtMs: number;
  db: D1Database;
  installedByProfileId: string;
  installedByUserId: string;
  messageKind: SlackInstallationWelcomeMessageKind;
  nowMs: number;
  organizationId: string;
  recipientSlackUserId: string;
  slackTeamId: string;
}): Promise<boolean> {
  if (!input.allowCreate) {
    return false;
  }
  const result =
    await prepareEnqueueSlackInstallationWelcomePreparationStatement(
      input
    ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export function prepareEnqueueSlackInstallationWelcomePreparationStatement(input: {
  connectionCreatedAtMs: number;
  db: D1Database;
  installedByProfileId: string;
  installedByUserId: string;
  messageKind: SlackInstallationWelcomeMessageKind;
  nowMs: number;
  organizationId: string;
  recipientSlackUserId: string;
  slackTeamId: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        INSERT INTO slack_installation_welcome_preparations (
          slack_team_id,
          organization_id,
          recipient_slack_user_id,
          connection_created_at_ms,
          welcome_version,
          message_kind,
          installed_by_user_id,
          installed_by_profile_id,
          status,
          claim_id,
          research_task_id,
          failure_code,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, ?)
        ON CONFLICT DO NOTHING
      `
    )
    .bind(
      input.slackTeamId,
      input.organizationId,
      input.recipientSlackUserId,
      input.connectionCreatedAtMs,
      SLACK_INSTALLATION_WELCOME_VERSION,
      input.messageKind,
      input.installedByUserId,
      input.installedByProfileId,
      input.nowMs,
      input.nowMs
    );
}

export async function authorizeFailedSlackInstallationWelcomeRetry(input: {
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE slack_installation_welcome_preparations
        SET
          status = 'ready',
          failure_code = 'slack_delivery_retry_authorized',
          updated_at_ms = ?
        WHERE slack_team_id = ?
          AND organization_id = ?
          AND recipient_slack_user_id = ?
          AND connection_created_at_ms = ?
          AND welcome_version = ?
          AND status = 'failed'
          AND failure_code = 'slack_delivery_failed'
          AND research_task_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM slack_installation_welcome_deliveries AS deliveries
            WHERE deliveries.slack_team_id = slack_installation_welcome_preparations.slack_team_id
              AND deliveries.organization_id = slack_installation_welcome_preparations.organization_id
              AND deliveries.recipient_slack_user_id = slack_installation_welcome_preparations.recipient_slack_user_id
              AND deliveries.connection_created_at_ms = slack_installation_welcome_preparations.connection_created_at_ms
              AND deliveries.welcome_version = slack_installation_welcome_preparations.welcome_version
              AND deliveries.status = 'failed'
          )
      `
    )
    .bind(
      input.nowMs,
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function claimQueuedSlackInstallationWelcomePreparations(input: {
  db: D1Database;
  limit?: number;
  nowMs: number;
}): Promise<SlackInstallationWelcomePreparation[]> {
  await input.db
    .prepare(
      `
        UPDATE slack_installation_welcome_preparations
        SET status = 'queued', claim_id = NULL, updated_at_ms = ?
        WHERE status = 'researching'
          AND research_task_id IS NULL
          AND updated_at_ms <= ?
      `
    )
    .bind(input.nowMs, input.nowMs - STALE_UNSTARTED_PREPARATION_MS)
    .run();
  const queued = await input.db
    .prepare(
      `
        SELECT
          slack_team_id,
          organization_id,
          recipient_slack_user_id,
          connection_created_at_ms,
          welcome_version
        FROM slack_installation_welcome_preparations
        WHERE status = 'queued'
        ORDER BY created_at_ms ASC
        LIMIT ?
      `
    )
    .bind(input.limit ?? 10)
    .all<{
      connection_created_at_ms: number;
      organization_id: string;
      recipient_slack_user_id: string;
      slack_team_id: string;
      welcome_version: number;
    }>();
  const claimed: SlackInstallationWelcomePreparation[] = [];
  for (const row of queued.results) {
    const claimId = crypto.randomUUID();
    const result = await input.db
      .prepare(
        `
          UPDATE slack_installation_welcome_preparations
          SET status = 'researching', claim_id = ?, updated_at_ms = ?
          WHERE slack_team_id = ?
            AND organization_id = ?
            AND recipient_slack_user_id = ?
            AND connection_created_at_ms = ?
            AND welcome_version = ?
            AND status = 'queued'
          RETURNING *
        `
      )
      .bind(
        claimId,
        input.nowMs,
        row.slack_team_id,
        row.organization_id,
        row.recipient_slack_user_id,
        row.connection_created_at_ms,
        row.welcome_version
      )
      .first<PreparationRow>();
    if (result) {
      claimed.push(mapPreparation(result));
    }
  }
  return claimed;
}

export async function listActiveSlackInstallationWelcomePreparations(input: {
  db: D1Database;
  limit?: number;
}): Promise<SlackInstallationWelcomePreparation[]> {
  const rows = await input.db
    .prepare(
      `
        SELECT *
        FROM slack_installation_welcome_preparations
        WHERE status IN ('researching', 'ready')
        ORDER BY updated_at_ms ASC
        LIMIT ?
      `
    )
    .bind(input.limit ?? 25)
    .all<PreparationRow>();
  return rows.results.map(mapPreparation);
}

export async function attachSlackInstallationWelcomeResearchTask(input: {
  claimId: string;
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
  researchTaskId: string;
}): Promise<void> {
  const updated = await updatePreparation({
    db: input.db,
    key: input.key,
    setSql: "research_task_id = ?, updated_at_ms = ?",
    bindValues: [input.researchTaskId, input.nowMs],
    whereSql: "status = 'researching' AND claim_id = ?",
    whereValues: [input.claimId],
  });
  if (!updated) {
    throw new Error("Slack welcome preparation claim is no longer active.");
  }
}

export async function releaseSlackInstallationWelcomePreparation(input: {
  claimId: string;
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await requirePreparationUpdate({
    bindValues: [input.nowMs],
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not be released.",
    setSql:
      "status = 'queued', claim_id = NULL, failure_code = NULL, updated_at_ms = ?",
    whereSql:
      "status = 'researching' AND claim_id = ? AND research_task_id IS NULL",
    whereValues: [input.claimId],
  });
}

export async function markSlackInstallationWelcomePreparationReady(input: {
  claimId: string;
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
  researchTaskId: string;
}): Promise<void> {
  await requirePreparationUpdate({
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not become ready.",
    setSql: "status = 'ready', updated_at_ms = ?",
    bindValues: [input.nowMs],
    whereSql:
      "status = 'researching' AND claim_id = ? AND research_task_id = ?",
    whereValues: [input.claimId, input.researchTaskId],
  });
}

export async function completeSlackInstallationWelcomePreparation(input: {
  claimId: string;
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
  researchTaskId: string;
}): Promise<void> {
  await requirePreparationUpdate({
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not be completed.",
    setSql: "status = 'completed', updated_at_ms = ?",
    bindValues: [input.nowMs],
    whereSql: "status = 'ready' AND claim_id = ? AND research_task_id = ?",
    whereValues: [input.claimId, input.researchTaskId],
  });
}

export async function failSlackInstallationWelcomePreparation(input: {
  claimId: string;
  db: D1Database;
  failureCode: string;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await requirePreparationUpdate({
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not record its failure.",
    setSql: "status = 'failed', failure_code = ?, updated_at_ms = ?",
    bindValues: [input.failureCode, input.nowMs],
    whereSql: "status IN ('researching', 'ready') AND claim_id = ?",
    whereValues: [input.claimId],
  });
}

async function requirePreparationUpdate(
  input: Parameters<typeof updatePreparation>[0] & { message: string }
): Promise<void> {
  if (!(await updatePreparation(input))) {
    throw new Error(input.message);
  }
}

async function updatePreparation(input: {
  bindValues: unknown[];
  db: D1Database;
  key: SlackInstallationWelcomeDeliveryKey;
  setSql: string;
  whereSql: string;
  whereValues: unknown[];
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE slack_installation_welcome_preparations
        SET ${input.setSql}
        WHERE slack_team_id = ?
          AND organization_id = ?
          AND recipient_slack_user_id = ?
          AND connection_created_at_ms = ?
          AND welcome_version = ?
          AND ${input.whereSql}
      `
    )
    .bind(
      ...input.bindValues,
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion,
      ...input.whereValues
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

function mapPreparation(
  row: PreparationRow
): SlackInstallationWelcomePreparation {
  return {
    claimId: row.claim_id,
    failureCode: row.failure_code,
    installedByProfileId: row.installed_by_profile_id,
    installedByUserId: row.installed_by_user_id,
    key: {
      connectionCreatedAtMs: row.connection_created_at_ms,
      organizationId: row.organization_id,
      recipientSlackUserId: row.recipient_slack_user_id,
      slackTeamId: row.slack_team_id,
      welcomeVersion: row.welcome_version,
    },
    messageKind: row.message_kind,
    researchTaskId: row.research_task_id,
    status: row.status,
  };
}
