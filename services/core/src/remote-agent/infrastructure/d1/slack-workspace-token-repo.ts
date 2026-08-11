export type SlackWorkspaceTokenRecord = {
  botUserId: string;
  createdAtMs: number;
  encryptedBotToken: string;
  installedByUserId: string;
  organizationId: string;
  slackTeamId: string;
  updatedAtMs: number;
};

type SlackWorkspaceTokenRow = {
  bot_user_id: string;
  created_at_ms: number;
  encrypted_bot_token: string;
  installed_by_user_id: string;
  organization_id: string;
  slack_team_id: string;
  updated_at_ms: number;
};

export async function readSlackWorkspaceToken(input: {
  db: D1Database;
  slackTeamId: string;
}): Promise<SlackWorkspaceTokenRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          slack_team_id,
          encrypted_bot_token,
          bot_user_id,
          installed_by_user_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        FROM slack_workspace_tokens
        WHERE slack_team_id = ?
        LIMIT 1
      `
    )
    .bind(input.slackTeamId)
    .first<SlackWorkspaceTokenRow>();

  return row ? mapSlackWorkspaceTokenRow(row) : null;
}

export function prepareUpsertSlackWorkspaceTokenStatement(input: {
  db: D1Database;
  record: SlackWorkspaceTokenRecord;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        INSERT INTO slack_workspace_tokens (
          slack_team_id,
          encrypted_bot_token,
          bot_user_id,
          installed_by_user_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slack_team_id) DO UPDATE SET
          encrypted_bot_token = excluded.encrypted_bot_token,
          bot_user_id = excluded.bot_user_id,
          installed_by_user_id = excluded.installed_by_user_id,
          organization_id = excluded.organization_id,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
      input.record.slackTeamId,
      input.record.encryptedBotToken,
      input.record.botUserId,
      input.record.installedByUserId,
      input.record.organizationId,
      input.record.createdAtMs,
      input.record.updatedAtMs
    );
}

export async function upsertSlackWorkspaceToken(input: {
  db: D1Database;
  record: SlackWorkspaceTokenRecord;
}): Promise<void> {
  await prepareUpsertSlackWorkspaceTokenStatement(input).run();
}

export function prepareDeleteSlackWorkspaceTokenStatement(input: {
  db: D1Database;
  slackTeamId: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        DELETE FROM slack_workspace_tokens
        WHERE slack_team_id = ?
      `
    )
    .bind(input.slackTeamId);
}

export function prepareDeleteSlackWorkspaceTokenByOrganizationStatement(input: {
  db: D1Database;
  organizationId: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        DELETE FROM slack_workspace_tokens
        WHERE organization_id = ?
      `
    )
    .bind(input.organizationId);
}

function mapSlackWorkspaceTokenRow(
  row: SlackWorkspaceTokenRow
): SlackWorkspaceTokenRecord {
  return {
    botUserId: row.bot_user_id,
    createdAtMs: row.created_at_ms,
    encryptedBotToken: row.encrypted_bot_token,
    installedByUserId: row.installed_by_user_id,
    organizationId: row.organization_id,
    slackTeamId: row.slack_team_id,
    updatedAtMs: row.updated_at_ms,
  };
}
