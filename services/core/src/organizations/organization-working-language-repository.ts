import {
  organizationWorkingLanguagePreferenceResponseSchema,
  workingLanguageGuidanceSchema,
  workingLanguageTagSchema,
} from "@openmeld/schemas";
import type {
  OrganizationWorkingLanguageMode,
  OrganizationWorkingLanguagePreferenceResponse,
  WorkingLanguageGuidance,
} from "@openmeld/schemas/types";

type OrganizationWorkingLanguagePreferenceRow = {
  language_tag: string;
  mode: OrganizationWorkingLanguageMode;
  organization_id: string;
  revision: number;
  updated_at_ms: number;
  updated_by_user_id: string | null;
};

export type OrganizationWorkingLanguagePreferenceRecord = {
  languageTag: string | null;
  mode: OrganizationWorkingLanguageMode;
  organizationId: string;
  revision: number;
  updatedAtMs: number | null;
  updatedByUserId: string | null;
};

export async function readOrganizationWorkingLanguagePreference(input: {
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationWorkingLanguagePreferenceRecord> {
  const row = await input.db
    .prepare(
      `
        SELECT
          organization_id,
          mode,
          language_tag,
          revision,
          updated_by_user_id,
          updated_at_ms
        FROM organization_working_language_preferences
        WHERE organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<OrganizationWorkingLanguagePreferenceRow>();
  return mapPreferenceRow(input.organizationId, row);
}

export async function readOrganizationWorkingLanguagePreferenceForSpace(input: {
  db: D1Database;
  spaceId: string;
}): Promise<OrganizationWorkingLanguagePreferenceRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          spaces.organization_id,
          preferences.mode,
          preferences.language_tag,
          preferences.revision,
          preferences.updated_by_user_id,
          preferences.updated_at_ms
        FROM space_index_spaces AS spaces
        LEFT JOIN organization_working_language_preferences AS preferences
          ON preferences.organization_id = spaces.organization_id
        WHERE spaces.space_id = ?
        LIMIT 1
      `
    )
    .bind(input.spaceId)
    .first<OrganizationWorkingLanguagePreferenceRow>();
  if (!row?.organization_id) {
    return null;
  }
  return mapPreferenceRow(row.organization_id, row);
}

export async function setOrganizationWorkingLanguagePreference(input: {
  db: D1Database;
  languageTag?: string;
  mode: "automatic" | "selected";
  nowMs: number;
  organizationId: string;
  updatedByUserId: string;
}): Promise<OrganizationWorkingLanguagePreferenceRecord> {
  if (input.mode === "automatic") {
    await input.db
      .prepare(
        `
          DELETE FROM organization_working_language_preferences
          WHERE organization_id = ?
        `
      )
      .bind(input.organizationId)
      .run();
    return defaultPreference(input.organizationId);
  }

  const languageTag = workingLanguageTagSchema.parse(input.languageTag);
  await input.db
    .prepare(
      `
        INSERT INTO organization_working_language_preferences (
          organization_id,
          mode,
          language_tag,
          revision,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, 'selected', ?, 1, ?, ?, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          mode = 'selected',
          language_tag = excluded.language_tag,
          revision = organization_working_language_preferences.revision + 1,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
      input.organizationId,
      languageTag,
      input.updatedByUserId,
      input.nowMs,
      input.nowMs
    )
    .run();
  return await readOrganizationWorkingLanguagePreference(input);
}

export async function observeOrganizationWorkingLanguage(input: {
  db: D1Database;
  languageTag: string;
  nowMs: number;
  organizationId: string;
}): Promise<{
  changed: boolean;
  preference: OrganizationWorkingLanguagePreferenceRecord;
}> {
  const languageTag = workingLanguageTagSchema.parse(input.languageTag);
  const result = await input.db
    .prepare(
      `
        INSERT INTO organization_working_language_preferences (
          organization_id,
          mode,
          language_tag,
          revision,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, 'automatic', ?, 1, NULL, ?, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          language_tag = excluded.language_tag,
          revision = organization_working_language_preferences.revision + 1,
          updated_at_ms = excluded.updated_at_ms
        WHERE organization_working_language_preferences.mode = 'automatic'
          AND organization_working_language_preferences.language_tag != excluded.language_tag
      `
    )
    .bind(input.organizationId, languageTag, input.nowMs, input.nowMs)
    .run();
  return {
    changed: Number(result.meta.changes ?? 0) === 1,
    preference: await readOrganizationWorkingLanguagePreference(input),
  };
}

export function toWorkingLanguageGuidance(
  preference: OrganizationWorkingLanguagePreferenceRecord
): WorkingLanguageGuidance | null {
  if (!preference.languageTag) {
    return null;
  }
  return workingLanguageGuidanceSchema.parse({
    languageTag: preference.languageTag,
    mode: preference.mode,
  });
}

export function toOrganizationWorkingLanguagePreferenceResponse(
  preference: OrganizationWorkingLanguagePreferenceRecord
): OrganizationWorkingLanguagePreferenceResponse {
  return organizationWorkingLanguagePreferenceResponseSchema.parse({
    languageTag: preference.languageTag,
    mode: preference.mode,
    organizationId: preference.organizationId,
    revision: preference.revision,
    updatedAt:
      preference.updatedAtMs === null
        ? null
        : new Date(preference.updatedAtMs).toISOString(),
    updatedByUserId: preference.updatedByUserId,
  });
}

function mapPreferenceRow(
  organizationId: string,
  row: OrganizationWorkingLanguagePreferenceRow | null
): OrganizationWorkingLanguagePreferenceRecord {
  if (!(row?.mode && row.language_tag)) {
    return defaultPreference(organizationId);
  }
  return {
    languageTag: workingLanguageTagSchema.parse(row.language_tag),
    mode: row.mode,
    organizationId,
    revision: row.revision,
    updatedAtMs: row.updated_at_ms,
    updatedByUserId: row.updated_by_user_id,
  };
}

function defaultPreference(
  organizationId: string
): OrganizationWorkingLanguagePreferenceRecord {
  return {
    languageTag: null,
    mode: "automatic",
    organizationId,
    revision: 0,
    updatedAtMs: null,
    updatedByUserId: null,
  };
}
