const DELETED_PROFILE_RECONCILE_RETRY_BASE_DELAY_MS = 15 * 60_000;
const DELETED_PROFILE_RECONCILE_RETRY_MAX_DELAY_MS = 24 * 60 * 60_000;
const DELETED_PROFILE_RECONCILE_ERROR_MAX_LENGTH = 500;

export type DeletedProfileReconcileOutboxRecord = {
  attemptCount: number;
  ownerUserId: string;
  profileId: string;
  profileKind: "agent" | "human";
};

type DeletedProfileReconcileOutboxRow = {
  attempt_count: number;
  owner_user_id: string;
  profile_id: string;
  profile_kind: "agent" | "human";
};

export async function listDueDeletedProfileReconcileOutbox(input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<DeletedProfileReconcileOutboxRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          profile_id,
          owner_user_id,
          profile_kind,
          attempt_count
        FROM openmeld_profile_deletion_outbox
        WHERE next_attempt_at_ms <= ?
        ORDER BY next_attempt_at_ms ASC, created_at_ms ASC, profile_id ASC
        LIMIT ?
      `
    )
    .bind(input.nowMs, input.limit)
    .all<DeletedProfileReconcileOutboxRow>();

  return (result.results ?? []).map((row) => ({
    attemptCount: row.attempt_count,
    ownerUserId: row.owner_user_id,
    profileId: row.profile_id,
    profileKind: row.profile_kind,
  }));
}

export async function deleteDeletedProfileReconcileOutboxRecord(input: {
  db: D1Database;
  profileId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        DELETE FROM openmeld_profile_deletion_outbox
        WHERE profile_id = ?
      `
    )
    .bind(input.profileId)
    .run();
}

export async function recordDeletedProfileReconcileFailure(input: {
  attemptCount?: number;
  db: D1Database;
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
  await input.db
    .prepare(
      `
        UPDATE openmeld_profile_deletion_outbox
        SET
          attempt_count = attempt_count + 1,
          next_attempt_at_ms = ?,
          last_attempt_at_ms = ?,
          last_error = ?,
          updated_at_ms = MAX(updated_at_ms, ?)
        WHERE profile_id = ?
      `
    )
    .bind(
      nextAttemptAtMs,
      input.nowMs,
      normalizeOutboxError(input.error),
      input.nowMs,
      input.profileId
    )
    .run();
}

async function readDeletedProfileReconcileAttemptCount(input: {
  db: D1Database;
  profileId: string;
}): Promise<number> {
  const row = await input.db
    .prepare(
      `
        SELECT attempt_count
        FROM openmeld_profile_deletion_outbox
        WHERE profile_id = ?
      `
    )
    .bind(input.profileId)
    .first<{ attempt_count: number }>();
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
