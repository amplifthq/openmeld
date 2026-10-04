import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
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
  const result = await input.db.query(
    prepareEnqueueSlackInstallationWelcomePreparationStatement(input)
  );
  return Number(result.rowCount ?? 0) === 1;
}
export function prepareEnqueueSlackInstallationWelcomePreparationStatement(input: {
  connectionCreatedAtMs: number;
  db: PostgresDatabase;
  installedByProfileId: string;
  installedByUserId: string;
  messageKind: SlackInstallationWelcomeMessageKind;
  nowMs: number;
  organizationId: string;
  recipientSlackUserId: string;
  slackTeamId: string;
}): QueryConfig {
  return {
    text: `
        INSERT INTO "openmeld"."slack_installation_welcome_preparations" (
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', NULL, NULL, NULL, $9, $10)
        ON CONFLICT DO NOTHING
      `,
    values: [
      input.slackTeamId,
      input.organizationId,
      input.recipientSlackUserId,
      input.connectionCreatedAtMs,
      SLACK_INSTALLATION_WELCOME_VERSION,
      input.messageKind,
      input.installedByUserId,
      input.installedByProfileId,
      input.nowMs,
      input.nowMs,
    ],
  };
}
export async function authorizeFailedSlackInstallationWelcomeRetry(input: {
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."slack_installation_welcome_preparations"
        SET
          status = 'ready',
          failure_code = 'slack_delivery_retry_authorized',
          updated_at_ms = $1
        WHERE slack_team_id = $2
          AND organization_id = $3
          AND recipient_slack_user_id = $4
          AND connection_created_at_ms = $5
          AND welcome_version = $6
          AND status = 'failed'
          AND failure_code = 'slack_delivery_failed'
          AND research_task_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."slack_installation_welcome_deliveries" AS deliveries
            WHERE deliveries.slack_team_id = slack_installation_welcome_preparations.slack_team_id
              AND deliveries.organization_id = slack_installation_welcome_preparations.organization_id
              AND deliveries.recipient_slack_user_id = slack_installation_welcome_preparations.recipient_slack_user_id
              AND deliveries.connection_created_at_ms = slack_installation_welcome_preparations.connection_created_at_ms
              AND deliveries.welcome_version = slack_installation_welcome_preparations.welcome_version
              AND deliveries.status = 'failed'
          )
      `,
    values: [
      input.nowMs,
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function claimQueuedSlackInstallationWelcomePreparations(input: {
  db: PostgresDatabase;
  limit?: number;
  nowMs: number;
}): Promise<SlackInstallationWelcomePreparation[]> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_installation_welcome_preparations"
        SET status = 'queued', claim_id = NULL, updated_at_ms = $1
        WHERE status = 'researching'
          AND research_task_id IS NULL
          AND updated_at_ms <= $2
      `,
    values: [input.nowMs, input.nowMs - STALE_UNSTARTED_PREPARATION_MS],
  });
  const queued = await input.db.query<{
    connection_created_at_ms: number;
    organization_id: string;
    recipient_slack_user_id: string;
    slack_team_id: string;
    welcome_version: number;
  }>({
    text: `
        SELECT
          slack_team_id,
          organization_id,
          recipient_slack_user_id,
          connection_created_at_ms,
          welcome_version
        FROM "openmeld"."slack_installation_welcome_preparations"
        WHERE status = 'queued'
        ORDER BY created_at_ms ASC NULLS FIRST
        LIMIT $1
      `,
    values: [input.limit ?? 10],
  });
  const claimed: SlackInstallationWelcomePreparation[] = [];
  for (const row of queued.rows) {
    const claimId = crypto.randomUUID();
    const result = await input.db
      .query<PreparationRow>({
        text: `
          UPDATE "openmeld"."slack_installation_welcome_preparations"
          SET status = 'researching', claim_id = $1, updated_at_ms = $2
          WHERE slack_team_id = $3
            AND organization_id = $4
            AND recipient_slack_user_id = $5
            AND connection_created_at_ms = $6
            AND welcome_version = $7
            AND status = 'queued'
          RETURNING *
        `,
        values: [
          claimId,
          input.nowMs,
          row.slack_team_id,
          row.organization_id,
          row.recipient_slack_user_id,
          row.connection_created_at_ms,
          row.welcome_version,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    if (result) {
      claimed.push(mapPreparation(result));
    }
  }
  return claimed;
}
export async function listActiveSlackInstallationWelcomePreparations(input: {
  db: PostgresDatabase;
  limit?: number;
}): Promise<SlackInstallationWelcomePreparation[]> {
  const rows = await input.db.query<PreparationRow>({
    text: `
        SELECT *
        FROM "openmeld"."slack_installation_welcome_preparations"
        WHERE status IN ('researching', 'ready')
        ORDER BY updated_at_ms ASC NULLS FIRST
        LIMIT $1
      `,
    values: [input.limit ?? 25],
  });
  return rows.rows.map(mapPreparation);
}
export async function attachSlackInstallationWelcomeResearchTask(input: {
  claimId: string;
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
  researchTaskId: string;
}): Promise<void> {
  const updated = await updatePreparation({
    db: input.db,
    key: input.key,
    setSql: "research_task_id = $6, updated_at_ms = $7",
    bindValues: [input.researchTaskId, input.nowMs],
    whereSql: "status = 'researching' AND claim_id = $8",
    whereValues: [input.claimId],
  });
  if (!updated) {
    throw new Error("Slack welcome preparation claim is no longer active.");
  }
}
export async function releaseSlackInstallationWelcomePreparation(input: {
  claimId: string;
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await requirePreparationUpdate({
    bindValues: [input.nowMs],
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not be released.",
    setSql:
      "status = 'queued', claim_id = NULL, failure_code = NULL, updated_at_ms = $6",
    whereSql:
      "status = 'researching' AND claim_id = $7 AND research_task_id IS NULL",
    whereValues: [input.claimId],
  });
}
export async function markSlackInstallationWelcomePreparationReady(input: {
  claimId: string;
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
  researchTaskId: string;
}): Promise<void> {
  await requirePreparationUpdate({
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not become ready.",
    setSql: "status = 'ready', updated_at_ms = $6",
    bindValues: [input.nowMs],
    whereSql:
      "status = 'researching' AND claim_id = $7 AND research_task_id = $8",
    whereValues: [input.claimId, input.researchTaskId],
  });
}
export async function completeSlackInstallationWelcomePreparation(input: {
  claimId: string;
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
  researchTaskId: string;
}): Promise<void> {
  await requirePreparationUpdate({
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not be completed.",
    setSql: "status = 'completed', updated_at_ms = $6",
    bindValues: [input.nowMs],
    whereSql: "status = 'ready' AND claim_id = $7 AND research_task_id = $8",
    whereValues: [input.claimId, input.researchTaskId],
  });
}
export async function failSlackInstallationWelcomePreparation(input: {
  claimId: string;
  db: PostgresDatabase;
  failureCode: string;
  key: SlackInstallationWelcomeDeliveryKey;
  nowMs: number;
}): Promise<void> {
  await requirePreparationUpdate({
    db: input.db,
    key: input.key,
    message: "Slack welcome preparation could not record its failure.",
    setSql: "status = 'failed', failure_code = $6, updated_at_ms = $7",
    bindValues: [input.failureCode, input.nowMs],
    whereSql: "status IN ('researching', 'ready') AND claim_id = $8",
    whereValues: [input.claimId],
  });
}
async function requirePreparationUpdate(
  input: Parameters<typeof updatePreparation>[0] & {
    message: string;
  }
): Promise<void> {
  if (!(await updatePreparation(input))) {
    throw new Error(input.message);
  }
}
async function updatePreparation(input: {
  bindValues: unknown[];
  db: PostgresDatabase;
  key: SlackInstallationWelcomeDeliveryKey;
  setSql: string;
  whereSql: string;
  whereValues: unknown[];
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."slack_installation_welcome_preparations"
        SET ${input.setSql}
        WHERE slack_team_id = $1
          AND organization_id = $2
          AND recipient_slack_user_id = $3
          AND connection_created_at_ms = $4
          AND welcome_version = $5
          AND ${input.whereSql}
      `,
    values: [
      input.key.slackTeamId,
      input.key.organizationId,
      input.key.recipientSlackUserId,
      input.key.connectionCreatedAtMs,
      input.key.welcomeVersion,
      ...input.bindValues,
      ...input.whereValues,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
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
