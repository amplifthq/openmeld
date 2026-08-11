import type { SpaceCreator } from "@openmeld/protocol";
import { parseSpaceCreator } from "@openmeld/protocol";
import {
  spaceAccessModeSchema,
  spaceDirectMessageMetaSchema,
  spaceOrganizationVisibilitySchema,
} from "@openmeld/schemas";
import type {
  SpaceAccessMode,
  SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";
import {
  parseSpacePasswordProofJson,
  type SpacePasswordProof,
} from "../../../lib/space-password-proof";
import { isoToTimestampMs, timestampMsToIso } from "./space-schema-repo";

const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

type SqlMetaRow = {
  space_id: string;
  name: string | null;
  purpose: string | null;
  direct_message_json: string | null;
  creator_json: string | null;
  organization_id: string | null;
  organization_visibility: string | null;
  guide: string | null;
  access_mode: string | null;
  password_proof_json: string | null;
  created_at: number;
  updated_at: number;
};

export type SpaceMetaRecord = {
  v: 1;
  spaceId: string;
  name?: string;
  purpose?: string;
  directMessage?: {
    convertedAt?: string;
    pairKey: string;
  };
  creator?: SpaceCreator;
  organizationId: string;
  visibility: SpaceOrganizationVisibility;
  guide?: string;
  accessMode: SpaceAccessMode;
  passwordProof?: SpacePasswordProof;
  createdAt: string;
  updatedAt: string;
};

export const readSpaceMetaRecordFromSql = (
  sql: SqlStorage,
  spaceId: string
): SpaceMetaRecord | null => {
  const row = readOne<SqlMetaRow>(
    sql.exec(
      `
        SELECT
          space_id,
          name,
          purpose,
          direct_message_json,
          creator_json,
          organization_id,
          organization_visibility,
          guide,
          access_mode,
          password_proof_json,
          created_at,
          updated_at
        FROM space_meta
        WHERE space_id = ?
        LIMIT 1
      `,
      spaceId
    )
  );
  if (!row) {
    return null;
  }

  const creator = parseCreatorJson(row.creator_json);
  const directMessage = parseDirectMessageJson(row.direct_message_json);
  const organizationId = parseSpaceMetaOrganizationId(row.organization_id);
  const visibility = parseSpaceMetaOrganizationVisibility(
    row.organization_visibility
  );
  const passwordProof = parsePasswordProofJson(row.password_proof_json ?? null);
  const accessMode = parseSpaceMetaAccessMode({
    rawAccessMode: row.access_mode,
    passwordProof,
  });
  const createdAt = timestampMsToIso(
    parseRequiredTimestampMs(row.created_at, "space_meta.created_at")
  );
  const updatedAt = timestampMsToIso(
    parseRequiredTimestampMs(row.updated_at, "space_meta.updated_at")
  );

  return {
    v: 1,
    spaceId: row.space_id,
    ...(row.name ? { name: row.name } : {}),
    ...(row.purpose ? { purpose: row.purpose } : {}),
    ...(directMessage ? { directMessage } : {}),
    ...(creator ? { creator } : {}),
    organizationId,
    visibility,
    ...(row.guide ? { guide: row.guide } : {}),
    accessMode,
    ...(passwordProof ? { passwordProof } : {}),
    createdAt,
    updatedAt,
  };
};

export const initializeSpaceMetaRecordIfAbsent = (
  sql: SqlStorage,
  record: SpaceMetaRecord
): SpaceMetaRecord => {
  const createdAtMs = parseIsoTimestampMs(record.createdAt, "meta.createdAt");
  const updatedAtMs = parseIsoTimestampMs(record.updatedAt, "meta.updatedAt");
  assertSpaceMetaAccessModeInvariant(record);
  const organizationId = parseSpaceMetaOrganizationId(record.organizationId);
  const visibility = parseSpaceMetaOrganizationVisibility(record.visibility);
  const creatorJson = record.creator ? JSON.stringify(record.creator) : null;
  const directMessageJson = record.directMessage
    ? JSON.stringify(record.directMessage)
    : null;
  const passwordProofJson = record.passwordProof
    ? JSON.stringify(record.passwordProof)
    : null;

  sql.exec(
    `
      INSERT OR IGNORE INTO space_meta (
        space_id,
        name,
        purpose,
        direct_message_json,
        creator_json,
        organization_id,
        organization_visibility,
        guide,
        access_mode,
        password_proof_json,
        archive_cursor_ts,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `,
    record.spaceId,
    record.name ?? null,
    record.purpose ?? null,
    directMessageJson,
    creatorJson,
    organizationId,
    visibility,
    record.guide ?? null,
    record.accessMode,
    passwordProofJson,
    createdAtMs,
    updatedAtMs
  );

  const current = readSpaceMetaRecordFromSql(sql, record.spaceId);
  if (!current) {
    throw new Error("space meta initialization failed");
  }

  return current;
};

export const upsertSpaceMetaRecord = (
  sql: SqlStorage,
  record: SpaceMetaRecord
): void => {
  const createdAtMs = parseIsoTimestampMs(record.createdAt, "meta.createdAt");
  const updatedAtMs = parseIsoTimestampMs(record.updatedAt, "meta.updatedAt");
  assertSpaceMetaAccessModeInvariant(record);
  const organizationId = parseSpaceMetaOrganizationId(record.organizationId);
  const visibility = parseSpaceMetaOrganizationVisibility(record.visibility);
  const creatorJson = record.creator ? JSON.stringify(record.creator) : null;
  const directMessageJson = record.directMessage
    ? JSON.stringify(record.directMessage)
    : null;
  const passwordProofJson = record.passwordProof
    ? JSON.stringify(record.passwordProof)
    : null;

  sql.exec(
    `
      INSERT INTO space_meta (
        space_id,
        name,
        purpose,
        direct_message_json,
        creator_json,
        organization_id,
        organization_visibility,
        guide,
        access_mode,
        password_proof_json,
        archive_cursor_ts,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        name = excluded.name,
        purpose = excluded.purpose,
        direct_message_json = excluded.direct_message_json,
        creator_json = excluded.creator_json,
        organization_id = excluded.organization_id,
        organization_visibility = excluded.organization_visibility,
        guide = excluded.guide,
        access_mode = excluded.access_mode,
        password_proof_json = excluded.password_proof_json,
        updated_at = excluded.updated_at
    `,
    record.spaceId,
    record.name ?? null,
    record.purpose ?? null,
    directMessageJson,
    creatorJson,
    organizationId,
    visibility,
    record.guide ?? null,
    record.accessMode,
    passwordProofJson,
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

function parseCreatorJson(raw: string | null): SpaceCreator | undefined {
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return parseSpaceCreator(parsed) ?? undefined;
}

function parseDirectMessageJson(
  raw: string | null
): SpaceMetaRecord["directMessage"] | undefined {
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`space_meta.direct_message_json invalid: ${reason}`);
  }

  const result = spaceDirectMessageMetaSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("space_meta.direct_message_json invalid");
  }
  return result.data;
}

function parsePasswordProofJson(raw: string | null): SpacePasswordProof | null {
  if (raw === null) {
    return null;
  }
  if (raw.trim().length === 0) {
    return null;
  }

  try {
    return parseSpacePasswordProofJson(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`space_meta.password_proof_json invalid: ${reason}`);
  }
}

function parseSpaceMetaOrganizationId(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (normalized.length === 0) {
    throw new Error("space_meta.organization_id required");
  }
  return normalized;
}

function parseSpaceMetaOrganizationVisibility(
  value: unknown
): SpaceOrganizationVisibility {
  const parsed = spaceOrganizationVisibilitySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("space_meta.organization_visibility invalid");
  }
  return parsed.data;
}

function parseSpaceMetaAccessMode(input: {
  rawAccessMode: string | null;
  passwordProof: SpacePasswordProof | null;
}): SpaceAccessMode {
  if (input.rawAccessMode === null || input.rawAccessMode.trim().length === 0) {
    return input.passwordProof ? "protected" : "public";
  }

  const parsed = spaceAccessModeSchema.safeParse(input.rawAccessMode);
  if (!parsed.success) {
    throw new Error("space_meta.access_mode invalid");
  }
  assertSpaceMetaAccessModeInvariant({
    accessMode: parsed.data,
    ...(input.passwordProof ? { passwordProof: input.passwordProof } : {}),
  });
  return parsed.data;
}

function assertSpaceMetaAccessModeInvariant(input: {
  accessMode: SpaceAccessMode;
  passwordProof?: SpacePasswordProof;
}): void {
  const hasPasswordProof = Boolean(input.passwordProof);
  if (input.accessMode === "public" || input.accessMode === "members_only") {
    if (hasPasswordProof) {
      throw new Error(
        `space_meta.access_mode ${input.accessMode} must not have password proof`
      );
    }
    return;
  }
  if (!hasPasswordProof) {
    throw new Error(
      `space_meta.access_mode ${input.accessMode} requires password proof`
    );
  }
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

function clampTimestampMs(value: number): number {
  if (value > MAX_DATE_TIMESTAMP_MS) {
    return MAX_DATE_TIMESTAMP_MS;
  }
  if (value < -MAX_DATE_TIMESTAMP_MS) {
    return -MAX_DATE_TIMESTAMP_MS;
  }
  return value;
}
