import type { SpaceCursorRecord } from "../../rules/parsers/space-cursor";
import { isoToTimestampMs, timestampMsToIso } from "./space-schema-repo";

const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

type SqlCursorRow = {
  profile_id: string;
  last_seen_ts: number | null;
  role: string | null;
  mention_alias: string | null;
  created_at: number;
  updated_at: number;
};

export const readSpaceCursorRecordFromSql = (
  sql: SqlStorage,
  profileId: string,
  requestSpaceId: string
): SpaceCursorRecord | null => {
  const row = readOne<SqlCursorRow>(
    sql.exec(
      `
        SELECT
          profile_id,
          last_seen_ts,
          role,
          mention_alias,
          created_at,
          updated_at
        FROM space_cursors
        WHERE profile_id = ?
        LIMIT 1
      `,
      profileId
    )
  );
  if (!row) {
    return null;
  }

  const parsedLastSeenTs = parseOptionalNonNegativeInteger(row.last_seen_ts);
  if (parsedLastSeenTs === null && row.last_seen_ts !== null) {
    return null;
  }

  const createdAt = timestampMsToIso(
    parseRequiredTimestampMs(row.created_at, "space_cursors.created_at")
  );
  const updatedAt = timestampMsToIso(
    parseRequiredTimestampMs(row.updated_at, "space_cursors.updated_at")
  );

  const role = normalizeOptionalString(row.role);
  const mentionAlias = normalizeOptionalString(row.mention_alias);

  return {
    v: 1,
    spaceId: requestSpaceId,
    profileId: row.profile_id,
    ...(typeof parsedLastSeenTs === "number"
      ? { lastSeenTs: parsedLastSeenTs }
      : {}),
    ...(role ? { role } : {}),
    ...(mentionAlias ? { mentionAlias } : {}),
    createdAt,
    updatedAt,
  };
};

export const upsertSpaceCursorRecord = (
  sql: SqlStorage,
  cursor: SpaceCursorRecord
): void => {
  const createdAtMs = parseIsoTimestampMs(cursor.createdAt, "cursor.createdAt");
  const updatedAtMs = parseIsoTimestampMs(cursor.updatedAt, "cursor.updatedAt");

  sql.exec(
    `
      INSERT INTO space_cursors (
        profile_id,
        last_seen_ts,
        role,
        mention_alias,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        last_seen_ts = excluded.last_seen_ts,
        role = excluded.role,
        mention_alias = excluded.mention_alias,
        updated_at = excluded.updated_at
    `,
    cursor.profileId,
    cursor.lastSeenTs ?? null,
    cursor.role ?? null,
    cursor.mentionAlias ?? null,
    createdAtMs,
    updatedAtMs
  );
};

function readOne<T extends Record<string, SqlStorageValue>>(
  cursor: SqlStorageCursor<T>
): T | null {
  const next = cursor.next();
  return next.done ? null : next.value;
}

function parseRequiredTimestampMs(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    throw new Error(`invalid ${field}`);
  }
  return clampTimestampMs(value);
}

function parseIsoTimestampMs(value: string, field: string): number {
  const parsed = isoToTimestampMs(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${field}`);
  }
  return clampTimestampMs(parsed);
}

function parseOptionalNonNegativeInteger(
  value: unknown
): number | undefined | null {
  if (value === null) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    return null;
  }
  if (value < 0) {
    return null;
  }
  return value;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function clampTimestampMs(value: number): number {
  if (value > MAX_DATE_TIMESTAMP_MS) {
    return MAX_DATE_TIMESTAMP_MS;
  }
  if (value < -MAX_DATE_TIMESTAMP_MS) {
    return -MAX_DATE_TIMESTAMP_MS;
  }
  return value;
}
