import type {
  SpaceMemberKind,
  SpaceMemberSource,
  SpaceMemberStatus,
} from "@openmeld/schemas/types";
import { isoToTimestampMs, timestampMsToIso } from "./space-schema-repo";

const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

type SqlSpaceMemberRow = {
  space_id: string;
  profile_id: string;
  profile_kind_snapshot: string;
  profile_name_snapshot: string;
  owner_user_id_snapshot: string | null;
  owner_name_snapshot: string | null;
  controller_ref_snapshot: string | null;
  status: string;
  member_source: string;
  added_at: number;
  removed_at: number | null;
  added_by_profile_id: string | null;
  added_by_owner_user_id: string | null;
  added_by_display_name_snapshot: string | null;
  removed_by_profile_id: string | null;
  removed_by_owner_user_id: string | null;
  removal_reason: string | null;
  first_entered_at: number | null;
  last_entered_at: number | null;
  created_at: number;
  updated_at: number;
};

export type SpaceMemberRecord = {
  spaceId: string;
  profileId: string;
  profileKindSnapshot: SpaceMemberKind;
  profileNameSnapshot: string;
  ownerUserIdSnapshot: string | null;
  ownerNameSnapshot: string | null;
  controllerRefSnapshot: string | null;
  status: SpaceMemberStatus;
  memberSource: SpaceMemberSource;
  addedAt: string;
  removedAt: string | null;
  addedByProfileId: string | null;
  addedByOwnerUserId: string | null;
  addedByDisplayNameSnapshot: string | null;
  removedByProfileId: string | null;
  removedByOwnerUserId: string | null;
  removalReason: string | null;
  firstEnteredAt: string | null;
  lastEnteredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const listSpaceMemberRecords = (
  sql: SqlStorage,
  options?: { status?: SpaceMemberStatus }
): SpaceMemberRecord[] => {
  const rows =
    options?.status === undefined
      ? sql
          .exec<SqlSpaceMemberRow>(
            `
              SELECT
                space_id,
                profile_id,
                profile_kind_snapshot,
                profile_name_snapshot,
                owner_user_id_snapshot,
                owner_name_snapshot,
                controller_ref_snapshot,
                status,
                member_source,
                added_at,
                removed_at,
                added_by_profile_id,
                added_by_owner_user_id,
                added_by_display_name_snapshot,
                removed_by_profile_id,
                removed_by_owner_user_id,
                removal_reason,
                first_entered_at,
                last_entered_at,
                created_at,
                updated_at
              FROM space_members
              ORDER BY added_at ASC, profile_id ASC
            `
          )
          .toArray()
      : sql
          .exec<SqlSpaceMemberRow>(
            `
              SELECT
                space_id,
                profile_id,
                profile_kind_snapshot,
                profile_name_snapshot,
                owner_user_id_snapshot,
                owner_name_snapshot,
                controller_ref_snapshot,
                status,
                member_source,
                added_at,
                removed_at,
                added_by_profile_id,
                added_by_owner_user_id,
                added_by_display_name_snapshot,
                removed_by_profile_id,
                removed_by_owner_user_id,
                removal_reason,
                first_entered_at,
                last_entered_at,
                created_at,
                updated_at
              FROM space_members
              WHERE status = ?
              ORDER BY added_at ASC, profile_id ASC
            `,
            options.status
          )
          .toArray();

  return rows.map(readSpaceMemberRecordRow);
};

export const readSpaceMemberRecord = (
  sql: SqlStorage,
  profileId: string
): SpaceMemberRecord | null => {
  const row = readOne(
    sql.exec<SqlSpaceMemberRow>(
      `
        SELECT
          space_id,
          profile_id,
          profile_kind_snapshot,
          profile_name_snapshot,
          owner_user_id_snapshot,
          owner_name_snapshot,
          controller_ref_snapshot,
          status,
          member_source,
          added_at,
          removed_at,
          added_by_profile_id,
          added_by_owner_user_id,
          added_by_display_name_snapshot,
          removed_by_profile_id,
          removed_by_owner_user_id,
          removal_reason,
          first_entered_at,
          last_entered_at,
          created_at,
          updated_at
        FROM space_members
        WHERE profile_id = ?
        LIMIT 1
      `,
      profileId
    )
  );
  return row ? readSpaceMemberRecordRow(row) : null;
};

export const countSpaceMemberRecords = (sql: SqlStorage): number => {
  const row = readOne(
    sql.exec<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM space_members
      `
    )
  );
  return Number(row?.count ?? 0);
};

export const hasActiveSpaceMemberRecordForOwnerUserId = (
  sql: SqlStorage,
  ownerUserId: string
): boolean => {
  const normalizedOwnerUserId = normalizeOptionalText(ownerUserId);
  if (!normalizedOwnerUserId) {
    return false;
  }

  const row = readOne(
    sql.exec<{ found: number }>(
      `
        SELECT 1 AS found
        FROM space_members
        WHERE owner_user_id_snapshot = ?
          AND status = 'active'
        LIMIT 1
      `,
      normalizedOwnerUserId
    )
  );
  return row?.found === 1;
};

export const listActiveSpaceMemberProfileIdsForOwnerUserId = (
  sql: SqlStorage,
  ownerUserId: string
): string[] => {
  const normalizedOwnerUserId = normalizeOptionalText(ownerUserId);
  if (!normalizedOwnerUserId) {
    return [];
  }
  return sql
    .exec<{ profile_id: string }>(
      `
        SELECT profile_id
        FROM space_members
        WHERE owner_user_id_snapshot = ?
          AND status = 'active'
        ORDER BY profile_id
      `,
      normalizedOwnerUserId
    )
    .toArray()
    .map((row) => row.profile_id);
};

export const hasActiveHumanSpaceMemberRecordForOwnerUserId = (
  sql: SqlStorage,
  ownerUserId: string
): boolean => {
  const normalizedOwnerUserId = normalizeOptionalText(ownerUserId);
  if (!normalizedOwnerUserId) {
    return false;
  }

  const row = readOne(
    sql.exec<{ found: number }>(
      `
        SELECT 1 AS found
        FROM space_members
        WHERE owner_user_id_snapshot = ?
          AND profile_kind_snapshot = 'human'
          AND status = 'active'
        LIMIT 1
      `,
      normalizedOwnerUserId
    )
  );
  return row?.found === 1;
};

export const upsertSpaceMemberRecord = (
  sql: SqlStorage,
  record: SpaceMemberRecord
): void => {
  sql.exec(
    `
      INSERT INTO space_members (
        space_id,
        profile_id,
        profile_kind_snapshot,
        profile_name_snapshot,
        owner_user_id_snapshot,
        owner_name_snapshot,
        controller_ref_snapshot,
        status,
        member_source,
        added_at,
        removed_at,
        added_by_profile_id,
        added_by_owner_user_id,
        added_by_display_name_snapshot,
        removed_by_profile_id,
        removed_by_owner_user_id,
        removal_reason,
        first_entered_at,
        last_entered_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        profile_kind_snapshot = excluded.profile_kind_snapshot,
        profile_name_snapshot = excluded.profile_name_snapshot,
        owner_user_id_snapshot = excluded.owner_user_id_snapshot,
        owner_name_snapshot = excluded.owner_name_snapshot,
        controller_ref_snapshot = excluded.controller_ref_snapshot,
        status = excluded.status,
        member_source = excluded.member_source,
        added_at = excluded.added_at,
        removed_at = excluded.removed_at,
        added_by_profile_id = excluded.added_by_profile_id,
        added_by_owner_user_id = excluded.added_by_owner_user_id,
        added_by_display_name_snapshot = excluded.added_by_display_name_snapshot,
        removed_by_profile_id = excluded.removed_by_profile_id,
        removed_by_owner_user_id = excluded.removed_by_owner_user_id,
        removal_reason = excluded.removal_reason,
        first_entered_at = excluded.first_entered_at,
        last_entered_at = excluded.last_entered_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    record.spaceId,
    record.profileId,
    record.profileKindSnapshot,
    record.profileNameSnapshot,
    record.ownerUserIdSnapshot,
    record.ownerNameSnapshot,
    record.controllerRefSnapshot,
    record.status,
    record.memberSource,
    parseIsoTimestampMs(record.addedAt, "space_members.added_at"),
    parseOptionalIsoTimestampMs(record.removedAt, "space_members.removed_at"),
    record.addedByProfileId,
    record.addedByOwnerUserId,
    record.addedByDisplayNameSnapshot,
    record.removedByProfileId,
    record.removedByOwnerUserId,
    record.removalReason,
    parseOptionalIsoTimestampMs(
      record.firstEnteredAt,
      "space_members.first_entered_at"
    ),
    parseOptionalIsoTimestampMs(
      record.lastEnteredAt,
      "space_members.last_entered_at"
    ),
    parseIsoTimestampMs(record.createdAt, "space_members.created_at"),
    parseIsoTimestampMs(record.updatedAt, "space_members.updated_at")
  );
  markSpaceMemberProjectionDirty(sql);
};

// Every member-row write marks the membership projection dirty so the Space
// background alarm re-projects the index snapshot even when a call site (or a
// read-path backfill) forgets the explicit projection call. The flag is a
// single-row table; projecting is an idempotent full snapshot, so spurious
// marks only cost one redundant projection.
export const markSpaceMemberProjectionDirty = (sql: SqlStorage): void => {
  sql.exec(
    `
      INSERT INTO space_member_projection_dirty (id, marked_at_ms)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET marked_at_ms = excluded.marked_at_ms
    `,
    Date.now()
  );
};

export const clearSpaceMemberProjectionDirty = (sql: SqlStorage): void => {
  sql.exec("DELETE FROM space_member_projection_dirty WHERE id = 1");
};

export const isSpaceMemberProjectionDirty = (sql: SqlStorage): boolean => {
  const rows = sql
    .exec<{ id: number }>(
      "SELECT id FROM space_member_projection_dirty WHERE id = 1 LIMIT 1"
    )
    .toArray();
  return rows.length > 0;
};

function readSpaceMemberRecordRow(row: SqlSpaceMemberRow): SpaceMemberRecord {
  return {
    spaceId: row.space_id,
    profileId: row.profile_id,
    profileKindSnapshot: parseSpaceMemberKind(
      row.profile_kind_snapshot,
      "space_members.profile_kind_snapshot"
    ),
    profileNameSnapshot: parseRequiredText(
      row.profile_name_snapshot,
      "space_members.profile_name_snapshot"
    ),
    ownerUserIdSnapshot: normalizeOptionalText(row.owner_user_id_snapshot),
    ownerNameSnapshot: normalizeOptionalText(row.owner_name_snapshot),
    controllerRefSnapshot: normalizeOptionalText(row.controller_ref_snapshot),
    status: parseSpaceMemberStatus(row.status, "space_members.status"),
    memberSource: parseSpaceMemberSource(
      row.member_source,
      "space_members.member_source"
    ),
    addedAt: timestampMsToIso(
      parseRequiredTimestampMs(row.added_at, "space_members.added_at")
    ),
    removedAt: toOptionalIsoTimestamp(
      row.removed_at,
      "space_members.removed_at"
    ),
    addedByProfileId: normalizeOptionalText(row.added_by_profile_id),
    addedByOwnerUserId: normalizeOptionalText(row.added_by_owner_user_id),
    addedByDisplayNameSnapshot: normalizeOptionalText(
      row.added_by_display_name_snapshot
    ),
    removedByProfileId: normalizeOptionalText(row.removed_by_profile_id),
    removedByOwnerUserId: normalizeOptionalText(row.removed_by_owner_user_id),
    removalReason: normalizeOptionalText(row.removal_reason),
    firstEnteredAt: toOptionalIsoTimestamp(
      row.first_entered_at,
      "space_members.first_entered_at"
    ),
    lastEnteredAt: toOptionalIsoTimestamp(
      row.last_entered_at,
      "space_members.last_entered_at"
    ),
    createdAt: timestampMsToIso(
      parseRequiredTimestampMs(row.created_at, "space_members.created_at")
    ),
    updatedAt: timestampMsToIso(
      parseRequiredTimestampMs(row.updated_at, "space_members.updated_at")
    ),
  };
}

function readOne<T extends Record<string, SqlStorageValue>>(
  cursor: SqlStorageCursor<T>
): T | null {
  const [firstRow] = cursor.toArray();
  return firstRow ?? null;
}

function parseRequiredText(value: unknown, field: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(`invalid ${field}`);
  }
  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSpaceMemberKind(value: unknown, field: string): SpaceMemberKind {
  if (value === "human" || value === "agent") {
    return value;
  }
  throw new Error(`invalid ${field}`);
}

function parseSpaceMemberStatus(
  value: unknown,
  field: string
): SpaceMemberStatus {
  if (value === "active" || value === "removed") {
    return value;
  }
  throw new Error(`invalid ${field}`);
}

function parseSpaceMemberSource(
  value: unknown,
  field: string
): SpaceMemberSource {
  if (
    value === "space_creator" ||
    value === "joined_directly" ||
    value === "added_by_member" ||
    value === "backfilled"
  ) {
    return value;
  }
  throw new Error(`invalid ${field}`);
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

function parseOptionalIsoTimestampMs(
  value: string | null,
  field: string
): number | null {
  if (value === null) {
    return null;
  }
  return parseIsoTimestampMs(value, field);
}

function toOptionalIsoTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return timestampMsToIso(parseRequiredTimestampMs(value, field));
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
