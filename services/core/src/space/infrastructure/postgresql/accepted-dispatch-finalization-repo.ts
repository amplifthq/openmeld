import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
export type AcceptedDispatchFinalizationFact = {
  attemptId: string;
  dispatchId: string;
  dispatchOwner: OpenMeldDaemonDispatchQueueMessage["dispatchOwner"] | null;
  idempotencyKey: string;
  sourceClientMessageId: string | null;
  sourceEventId: string;
  spaceId: string;
  targetProfileId: string;
  taskId: string;
  enqueuedAtMs: number;
};
type AcceptedDispatchFinalizationRow = {
  attemptId?: unknown;
  dispatchId?: unknown;
  dispatchOwnerId?: unknown;
  dispatchOwnerKind?: unknown;
  firstSeenAtMs?: unknown;
  idempotencyKey?: unknown;
  sourceClientMessageId?: unknown;
  sourceEventId?: unknown;
  spaceId?: unknown;
  targetProfileId?: unknown;
  taskId?: unknown;
};
export const readAcceptedDispatchFinalizationFact = async (input: {
  attemptId: string;
  db: PostgresDatabase;
  dispatchId: string;
  spaceId: string;
}): Promise<AcceptedDispatchFinalizationFact | null> => {
  const row = await input.db
    .query<AcceptedDispatchFinalizationRow>({
      text: `
        SELECT
          attempts.attempt_id AS "attemptId",
          ledger.dispatch_id AS "dispatchId",
          ledger.dispatch_owner_id AS "dispatchOwnerId",
          ledger.dispatch_owner_kind AS "dispatchOwnerKind",
          ledger.first_seen_at_ms AS "firstSeenAtMs",
          ledger.idempotency_key AS "idempotencyKey",
          ledger.source_client_message_id AS "sourceClientMessageId",
          ledger.source_event_id AS "sourceEventId",
          ledger.space_id AS "spaceId",
          COALESCE(attempts.target_profile_id, ledger.target_profile_id) AS "targetProfileId",
          attempts.task_id AS "taskId"
        FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
        INNER JOIN "openmeld"."openMeldDaemon_dispatch_attempts" AS attempts
          ON attempts.dispatch_id = ledger.dispatch_id
        WHERE ledger.dispatch_id = $1
          AND ledger.space_id = $2
          AND attempts.attempt_id = $3
        LIMIT 1
      `,
      values: [input.dispatchId, input.spaceId, input.attemptId],
    })
    .then((result) => result.rows[0] ?? null);
  const attemptId = normalizeOptionalText(row?.attemptId);
  const dispatchId = normalizeOptionalText(row?.dispatchId);
  const idempotencyKey = normalizeOptionalText(row?.idempotencyKey);
  const sourceEventId = normalizeOptionalText(row?.sourceEventId);
  const spaceId = normalizeOptionalText(row?.spaceId);
  const targetProfileId = normalizeOptionalText(row?.targetProfileId);
  const taskId = normalizeOptionalText(row?.taskId);
  const enqueuedAtMs = normalizeTimestampMs(row?.firstSeenAtMs);
  if (
    !(
      attemptId === input.attemptId &&
      dispatchId === input.dispatchId &&
      idempotencyKey &&
      sourceEventId &&
      spaceId === input.spaceId &&
      targetProfileId &&
      taskId &&
      enqueuedAtMs !== null
    )
  ) {
    return null;
  }
  return {
    attemptId,
    dispatchId,
    dispatchOwner: normalizeDispatchOwner(row),
    enqueuedAtMs,
    idempotencyKey,
    sourceClientMessageId: normalizeOptionalText(row?.sourceClientMessageId),
    sourceEventId,
    spaceId,
    targetProfileId,
    taskId,
  };
};
export const listAcceptedDispatchResultInboxRefsForSpace = async (input: {
  db: PostgresDatabase;
  limit: number;
  spaceId: string;
}): Promise<
  {
    attemptId: string;
    dispatchId: string;
  }[]
> => {
  const rows = await input.db.query<{
    attemptId?: unknown;
    dispatchId?: unknown;
  }>({
    text: `
        SELECT
          inbox.attempt_id AS "attemptId",
          inbox.dispatch_id AS "dispatchId"
        FROM "openmeld"."openMeldDaemon_dispatch_result_inbox" AS inbox
        INNER JOIN "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
          ON ledger.dispatch_id = inbox.dispatch_id
        WHERE ledger.space_id = $1
          AND inbox.publish_state IN ('result_accepted', 'reply_publication_failed')
        ORDER BY inbox.updated_at_ms ASC NULLS FIRST
        LIMIT $2
      `,
    values: [input.spaceId, Math.max(1, Math.min(25, Math.trunc(input.limit)))],
  });
  return (rows.rows ?? []).flatMap((row) => {
    const attemptId = normalizeOptionalText(row.attemptId);
    const dispatchId = normalizeOptionalText(row.dispatchId);
    return attemptId && dispatchId ? [{ attemptId, dispatchId }] : [];
  });
};
function normalizeDispatchOwner(
  row: AcceptedDispatchFinalizationRow | null | undefined
): OpenMeldDaemonDispatchQueueMessage["dispatchOwner"] | null {
  const ownerKind = normalizeOptionalText(row?.dispatchOwnerKind);
  const ownerId = normalizeOptionalText(row?.dispatchOwnerId);
  if (ownerKind !== "owner_account" || !ownerId) {
    return null;
  }
  return {
    id: ownerId,
    kind: "owner_account",
  };
}
function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
function normalizeTimestampMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}
