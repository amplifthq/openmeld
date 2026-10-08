import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
  record: GitHubAppInstallationStateRecord;
}): Promise<void> {
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
          DELETE FROM "openmeld"."github_app_installation_states"
          WHERE organization_id = $1
            AND user_id = $2
            AND status IN ('installing', 'verifying')
        `,
          values: [input.record.organizationId, input.record.userId],
        }),
        await client.query({
          text: `
          INSERT INTO "openmeld"."github_app_installation_states" (
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
          VALUES ($1, $2, $3, $4, $5, NULL, NULL, 'installing', $6, $7, $8)
        `,
          values: [
            input.record.stateDigest,
            input.record.organizationId,
            input.record.userId,
            input.record.actorProfileId,
            input.record.targetConnectionName,
            input.record.expiresAtMs,
            input.record.createdAtMs,
            input.record.updatedAtMs,
          ],
        }),
      ] as const
  );
}
export async function deleteExpiredGitHubAppInstallationStates(input: {
  db: PostgresDatabase;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `
        DELETE FROM "openmeld"."github_app_installation_states"
        WHERE expires_at_ms <= $1
      `,
    values: [input.nowMs],
  });
}
export async function beginGitHubAppInstallationVerificationRecord(input: {
  db: PostgresDatabase;
  installationId: string;
  nowMs: number;
  stateDigest: string;
  verificationConnectionName: string;
}): Promise<GitHubAppInstallationStateRecord | null> {
  const row = await input.db
    .query<GitHubAppInstallationStateRow>({
      text: `
        UPDATE "openmeld"."github_app_installation_states"
        SET
          installation_id = $1,
          verification_connection_name = $2,
          status = 'verifying',
          updated_at_ms = $3
        WHERE state_digest = $4
          AND status = 'installing'
          AND expires_at_ms > $5
        RETURNING ${SELECT_COLUMNS}
      `,
      values: [
        input.installationId,
        input.verificationConnectionName,
        input.nowMs,
        input.stateDigest,
        input.nowMs,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRow(row) : null;
}
export async function consumeExpiredGitHubAppInstallationState(input: {
  db: PostgresDatabase;
  nowMs: number;
  stateDigest: string;
}): Promise<boolean> {
  const row = await input.db
    .query<{
      state_digest: string;
    }>({
      text: `
        DELETE FROM "openmeld"."github_app_installation_states"
        WHERE state_digest = $1
          AND status = 'installing'
          AND expires_at_ms <= $2
        RETURNING state_digest
      `,
      values: [input.stateDigest, input.nowMs],
    })
    .then((result) => result.rows[0] ?? null);
  return row !== null;
}
export async function readPendingGitHubAppInstallationRecord(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  userId: string;
}): Promise<GitHubAppInstallationStateRecord | null> {
  const row = await input.db
    .query<GitHubAppInstallationStateRow>({
      text: `
        SELECT ${SELECT_COLUMNS}
        FROM "openmeld"."github_app_installation_states"
        WHERE organization_id = $1
          AND user_id = $2
          AND status IN ('installing', 'verifying')
          AND expires_at_ms > $3
        ORDER BY created_at_ms DESC NULLS LAST
        LIMIT 1
      `,
      values: [input.organizationId, input.userId, input.nowMs],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRow(row) : null;
}
export async function completeGitHubAppInstallationRecord(input: {
  db: PostgresDatabase;
  installationId: string;
  nowMs: number;
  organizationId: string;
  targetConnectionName: string;
  userId: string;
  verificationConnectionName: string;
}): Promise<boolean> {
  const row = await input.db
    .query<{
      state_digest: string;
    }>({
      text: `
        UPDATE "openmeld"."github_app_installation_states"
        SET
          status = 'completed',
          updated_at_ms = $1
        WHERE organization_id = $2
          AND user_id = $3
          AND target_connection_name = $4
          AND verification_connection_name = $5
          AND installation_id = $6
          AND status = 'verifying'
          AND expires_at_ms > $7
        RETURNING state_digest
      `,
      values: [
        input.nowMs,
        input.organizationId,
        input.userId,
        input.targetConnectionName,
        input.verificationConnectionName,
        input.installationId,
        input.nowMs,
      ],
    })
    .then((result) => result.rows[0] ?? null);
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
