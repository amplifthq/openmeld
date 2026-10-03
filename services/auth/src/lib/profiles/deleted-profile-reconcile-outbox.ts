import type { PostgresDatabase } from "@openmeld/db/postgresql";

const DELETED_PROFILE_RECONCILE_RETRY_BASE_DELAY_MS = 15 * 60_000;
const DELETED_PROFILE_RECONCILE_RETRY_MAX_DELAY_MS = 24 * 60 * 60_000;
const DELETED_PROFILE_RECONCILE_ERROR_MAX_LENGTH = 500;
export type DeletedProfileReconcileOutboxRecord = {
  attemptCount: number;
  ownerUserId: string | null;
  organizationId: string | null;
  profileId: string;
  profileKind: "agent" | "human";
};
type DeletedProfileReconcileOutboxRow = {
  attempt_count: number;
  owner_user_id: string | null;
  organization_id: string | null;
  profile_id: string;
  profile_kind: "agent" | "human";
};
export async function listDueDeletedProfileReconcileOutbox(input: {
  db: PostgresDatabase;
  limit: number;
  nowMs: number;
}): Promise<DeletedProfileReconcileOutboxRecord[]> {
  const result = await input.db.query<DeletedProfileReconcileOutboxRow>({
    text: `
        SELECT
          profile_id,
          owner_user_id,
          organization_id,
          profile_kind,
          attempt_count
        FROM "openmeld"."openmeld_profile_deletion_outbox"
        WHERE next_attempt_at_ms <= $1
        ORDER BY next_attempt_at_ms ASC NULLS FIRST, created_at_ms ASC NULLS FIRST, profile_id ASC NULLS FIRST
        LIMIT $2
      `,
    values: [input.nowMs, input.limit],
  });
  return (result.rows ?? []).map((row) => ({
    attemptCount: row.attempt_count,
    ownerUserId: row.owner_user_id,
    organizationId: row.organization_id,
    profileId: row.profile_id,
    profileKind: row.profile_kind,
  }));
}
export async function deleteDeletedProfileReconcileOutboxRecord(input: {
  db: PostgresDatabase;
  profileId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        DELETE FROM "openmeld"."openmeld_profile_deletion_outbox"
        WHERE profile_id = $1
      `,
    values: [input.profileId],
  });
}
export async function recordDeletedProfileReconcileFailure(input: {
  attemptCount?: number;
  db: PostgresDatabase;
  error: string;
  nowMs: number;
  profileId: string;
}): Promise<void> {
  const currentAttemptCount =
    input.attemptCount ??
    (await readDeletedProfileReconcileAttemptCount({
      db: input.db,
      profileId: input.profileId,
    }));
  const nextAttemptAtMs =
    input.nowMs + resolveDeletedProfileReconcileRetryDelay(currentAttemptCount);
  await input.db.query({
    text: `
        UPDATE "openmeld"."openmeld_profile_deletion_outbox"
        SET
          attempt_count = attempt_count + 1,
          next_attempt_at_ms = $1,
          last_attempt_at_ms = $2,
          last_error = $3,
          updated_at_ms = GREATEST(updated_at_ms, $4)
        WHERE profile_id = $5
      `,
    values: [
      nextAttemptAtMs,
      input.nowMs,
      normalizeOutboxError(input.error),
      input.nowMs,
      input.profileId,
    ],
  });
}
async function readDeletedProfileReconcileAttemptCount(input: {
  db: PostgresDatabase;
  profileId: string;
}): Promise<number> {
  const row = await input.db
    .query<{
      attempt_count: number;
    }>({
      text: `
        SELECT attempt_count
        FROM "openmeld"."openmeld_profile_deletion_outbox"
        WHERE profile_id = $1
      `,
      values: [input.profileId],
    })
    .then((result) => result.rows[0] ?? null);
  return Math.max(0, row?.attempt_count ?? 0);
}
function resolveDeletedProfileReconcileRetryDelay(
  attemptCount: number
): number {
  const exponent = Math.min(Math.max(0, attemptCount), 7);
  return Math.min(
    DELETED_PROFILE_RECONCILE_RETRY_MAX_DELAY_MS,
    DELETED_PROFILE_RECONCILE_RETRY_BASE_DELAY_MS * 2 ** exponent
  );
}
function normalizeOutboxError(error: string): string {
  const normalized = error.trim() || "deleted_profile_reconcile_failed";
  return normalized.slice(0, DELETED_PROFILE_RECONCILE_ERROR_MAX_LENGTH);
}
