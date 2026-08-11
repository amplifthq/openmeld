export type GitHubAppInstallationStateRecord = {
  actorProfileId: string;
  createdAtMs: number;
  expiresAtMs: number;
  installationId: string | null;
  organizationId: string;
  stateDigest: string;
  status: "installing" | "verifying" | "completed";
  targetConnectionName: string;
  updatedAtMs: number;
  userId: string;
  verificationConnectionName: string | null;
};

type GitHubAppInstallationStateRow = {
  actor_profile_id: string;
  created_at_ms: number;
  expires_at_ms: number;
  installation_id: string | null;
  organization_id: string;
  state_digest: string;
  status: GitHubAppInstallationStateRecord["status"];
  target_connection_name: string;
  updated_at_ms: number;
  user_id: string;
  verification_connection_name: string | null;
};

const SELECT_COLUMNS = `
  state_digest,
  organization_id,
  user_id,
  actor_profile_id,
  target_connection_name,
  verification_connection_name,
  installation_id,
  status,
  expires_at_ms,
  created_at_ms,
  updated_at_ms
`;

export async function replaceGitHubAppInstallationState(input: {
  db: D1Database;
  record: GitHubAppInstallationStateRecord;
}): Promise<void> {
  await input.db.batch([
    input.db
      .prepare(
        `
          DELETE FROM github_app_installation_states
          WHERE organization_id = ?
            AND user_id = ?
            AND status IN ('installing', 'verifying')
        `
      )
      .bind(input.record.organizationId, input.record.userId),
    input.db
      .prepare(
        `
          INSERT INTO github_app_installation_states (
            state_digest,
            organization_id,
            user_id,
            actor_profile_id,
            target_connection_name,
            verification_connection_name,
            installation_id,
            status,
            expires_at_ms,
            created_at_ms,
            updated_at_ms
          )
          VALUES (?, ?, ?, ?, ?, NULL, NULL, 'installing', ?, ?, ?)
        `
      )
      .bind(
        input.record.stateDigest,
        input.record.organizationId,
        input.record.userId,
        input.record.actorProfileId,
        input.record.targetConnectionName,
        input.record.expiresAtMs,
        input.record.createdAtMs,
        input.record.updatedAtMs
      ),
  ]);
}

export async function deleteExpiredGitHubAppInstallationStates(input: {
  db: D1Database;
  nowMs: number;
}): Promise<void> {
  await input.db
    .prepare(
      `
        DELETE FROM github_app_installation_states
        WHERE expires_at_ms <= ?
      `
    )
    .bind(input.nowMs)
    .run();
}

export async function beginGitHubAppInstallationVerificationRecord(input: {
  db: D1Database;
  installationId: string;
  nowMs: number;
  stateDigest: string;
  verificationConnectionName: string;
}): Promise<GitHubAppInstallationStateRecord | null> {
  const row = await input.db
    .prepare(
      `
        UPDATE github_app_installation_states
        SET
          installation_id = ?,
          verification_connection_name = ?,
          status = 'verifying',
          updated_at_ms = ?
        WHERE state_digest = ?
          AND status = 'installing'
          AND expires_at_ms > ?
        RETURNING ${SELECT_COLUMNS}
      `
    )
    .bind(
      input.installationId,
      input.verificationConnectionName,
      input.nowMs,
      input.stateDigest,
      input.nowMs
    )
    .first<GitHubAppInstallationStateRow>();
  return row ? mapRow(row) : null;
}

export async function consumeExpiredGitHubAppInstallationState(input: {
  db: D1Database;
  nowMs: number;
  stateDigest: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        DELETE FROM github_app_installation_states
        WHERE state_digest = ?
          AND status = 'installing'
          AND expires_at_ms <= ?
        RETURNING state_digest
      `
    )
    .bind(input.stateDigest, input.nowMs)
    .first<{ state_digest: string }>();
  return row !== null;
}

export async function readPendingGitHubAppInstallationRecord(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  userId: string;
}): Promise<GitHubAppInstallationStateRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${SELECT_COLUMNS}
        FROM github_app_installation_states
        WHERE organization_id = ?
          AND user_id = ?
          AND status = 'verifying'
          AND expires_at_ms > ?
        ORDER BY created_at_ms DESC
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.userId, input.nowMs)
    .first<GitHubAppInstallationStateRow>();
  return row ? mapRow(row) : null;
}

export async function completeGitHubAppInstallationRecord(input: {
  db: D1Database;
  installationId: string;
  nowMs: number;
  organizationId: string;
  targetConnectionName: string;
  userId: string;
  verificationConnectionName: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        UPDATE github_app_installation_states
        SET
          status = 'completed',
          updated_at_ms = ?
        WHERE organization_id = ?
          AND user_id = ?
          AND target_connection_name = ?
          AND verification_connection_name = ?
          AND installation_id = ?
          AND status = 'verifying'
          AND expires_at_ms > ?
        RETURNING state_digest
      `
    )
    .bind(
      input.nowMs,
      input.organizationId,
      input.userId,
      input.targetConnectionName,
      input.verificationConnectionName,
      input.installationId,
      input.nowMs
    )
    .first<{ state_digest: string }>();
  return row !== null;
}

function mapRow(
  row: GitHubAppInstallationStateRow
): GitHubAppInstallationStateRecord {
  return {
    actorProfileId: row.actor_profile_id,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    installationId: row.installation_id,
    organizationId: row.organization_id,
    stateDigest: row.state_digest,
    status: row.status,
    targetConnectionName: row.target_connection_name,
    updatedAtMs: row.updated_at_ms,
    userId: row.user_id,
    verificationConnectionName: row.verification_connection_name,
  };
}
