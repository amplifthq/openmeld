import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  markSpaceIndexProjectionOutboxCompleted,
  markSpaceIndexProjectionOutboxFailed,
  type SpaceIndexProjectionOutboxRecord,
} from "../space/infrastructure/sql/space-index-projection-outbox-repo";
import {
  projectActiveSpaceIndexSnapshot,
  projectDeletedSpaceIndexSnapshot,
} from "./space-index-projection-service";
import { projectSpaceMessagePreview } from "./space-message-preview";

const SPACE_INDEX_PROJECTION_RETRY_DELAYS_MS = [
  2000, 5000, 15_000, 60_000,
] as const;
const SPACE_INDEX_PROJECTION_MAX_RETRY_DELAY_MS = 60_000;
export type SpaceIndexProjectionOutboxAttemptResult =
  | {
      completedAtMs: number;
      projectionEventId: string;
      projectionId: string;
      status: "completed";
    }
  | {
      error: Error;
      failedAtMs: number;
      nextRetryAtMs: number;
      projectionId: string;
      status: "failed";
    };
export async function attemptSpaceIndexProjectionOutboxRecord(input: {
  db: PostgresDatabase;
  nowMs?: number;
  record: SpaceIndexProjectionOutboxRecord;
  sql: SqlStorage;
}): Promise<SpaceIndexProjectionOutboxAttemptResult> {
  const nowMs = input.nowMs ?? Date.now();
  try {
    const projection = await projectSpaceIndexProjectionSnapshot({
      db: input.db,
      record: input.record,
    });
    markSpaceIndexProjectionOutboxCompleted(input.sql, {
      completedAtMs: nowMs,
      projectionId: input.record.projectionId,
    });
    return {
      completedAtMs: nowMs,
      projectionEventId: projection.projectionEventId,
      projectionId: input.record.projectionId,
      status: "completed",
    };
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    const nextRetryAtMs =
      nowMs + resolveSpaceIndexProjectionRetryDelayMs(input.record);
    markSpaceIndexProjectionOutboxFailed(input.sql, {
      failedAtMs: nowMs,
      lastError: normalizedError.message,
      nextRetryAtMs,
      projectionId: input.record.projectionId,
    });
    return {
      error: normalizedError,
      failedAtMs: nowMs,
      nextRetryAtMs,
      projectionId: input.record.projectionId,
      status: "failed",
    };
  }
}
async function projectSpaceIndexProjectionSnapshot(input: {
  db: PostgresDatabase;
  record: SpaceIndexProjectionOutboxRecord;
}): Promise<{
  projectionEventId: string;
}> {
  const snapshot = input.record.snapshot;
  if (snapshot.kind === "message_preview") {
    await projectSpaceMessagePreview({
      db: input.db,
      spaceId: input.record.spaceId,
      revision: snapshot.revision,
      preview: snapshot.preview,
    });
    return { projectionEventId: input.record.projectionId };
  }
  if (snapshot.kind === "active") {
    const result = await projectActiveSpaceIndexSnapshot({
      db: input.db,
      eventType: snapshot.eventType,
      memberRecords: snapshot.memberRecords,
      metaRecord: snapshot.metaRecord,
    });
    return { projectionEventId: result.projectionEventId };
  }
  const result = await projectDeletedSpaceIndexSnapshot({
    db: input.db,
    deletedAt: snapshot.deletedAt,
    deletedByOwnerUserId: snapshot.deletedByOwnerUserId ?? null,
    deletedByProfileId: snapshot.deletedByProfileId ?? null,
    deletedByProfileName: snapshot.deletedByProfileName ?? null,
    eventType: "space.deleted",
    memberRecords: snapshot.memberRecords,
    metaRecord: snapshot.metaRecord,
  });
  await input.db.query({
    text: 'UPDATE "openmeld"."space_index_spaces" SET message_preview_json = NULL WHERE space_id = $1 AND status = \'deleted\'',
    values: [input.record.spaceId],
  });
  return { projectionEventId: result.projectionEventId };
}
function resolveSpaceIndexProjectionRetryDelayMs(
  record: SpaceIndexProjectionOutboxRecord
): number {
  const attemptIndex = Math.max(0, record.attemptCount);
  return (
    SPACE_INDEX_PROJECTION_RETRY_DELAYS_MS[attemptIndex] ??
    SPACE_INDEX_PROJECTION_MAX_RETRY_DELAY_MS
  );
}
