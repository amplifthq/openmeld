export type SlackOAuthStateRecord = {
  actorProfileId: string;
  createdAtMs: number;
  expiresAtMs: number;
  moveFromOrganizationId: string | null;
  organizationId: string;
  returnPath: string;
  stateDigest: string;
  userId: string;
};

type SlackOAuthStateRow = {
  actor_profile_id: string;
  created_at_ms: number;
  expires_at_ms: number;
  move_from_organization_id: string | null;
  organization_id: string;
  return_path: string;
  state_digest: string;
  user_id: string;
};

export async function insertSlackOAuthState(input: {
  db: D1Database;
  record: SlackOAuthStateRecord;
}): Promise<void> {
  await input.db
    .prepare(
      `
        INSERT INTO slack_oauth_states (
          state_digest,
          organization_id,
          user_id,
          actor_profile_id,
          return_path,
          move_from_organization_id,
          expires_at_ms,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.record.stateDigest,
      input.record.organizationId,
      input.record.userId,
      input.record.actorProfileId,
      input.record.returnPath,
      input.record.moveFromOrganizationId,
      input.record.expiresAtMs,
      input.record.createdAtMs
    )
    .run();
}

export async function deleteExpiredSlackOAuthStateRecords(input: {
  db: D1Database;
  nowMs: number;
}): Promise<void> {
  await input.db
    .prepare(
      `
        DELETE FROM slack_oauth_states
        WHERE expires_at_ms <= ?
      `
    )
    .bind(input.nowMs)
    .run();
}

export async function consumeSlackOAuthStateRecord(input: {
  db: D1Database;
  stateDigest: string;
}): Promise<SlackOAuthStateRecord | null> {
  const row = await input.db
    .prepare(
      `
        DELETE FROM slack_oauth_states
        WHERE state_digest = ?
        RETURNING
          state_digest,
          organization_id,
          user_id,
          actor_profile_id,
          return_path,
          move_from_organization_id,
          expires_at_ms,
          created_at_ms
      `
    )
    .bind(input.stateDigest)
    .first<SlackOAuthStateRow>();

  return row ? mapSlackOAuthStateRow(row) : null;
}

function mapSlackOAuthStateRow(row: SlackOAuthStateRow): SlackOAuthStateRecord {
  return {
    actorProfileId: row.actor_profile_id,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    moveFromOrganizationId: row.move_from_organization_id,
    organizationId: row.organization_id,
    returnPath: row.return_path,
    stateDigest: row.state_digest,
    userId: row.user_id,
  };
}
