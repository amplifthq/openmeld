import type {
  PoolClient,
  PostgresDatabase,
  QueryConfig,
} from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
  organizationId: string;
}): Promise<OrganizationWorkingLanguagePreferenceRecord> {
  const row = await input.db
    .query<OrganizationWorkingLanguagePreferenceRow>({
      text: `
        SELECT
          organization_id,
          mode,
          language_tag,
          revision,
          updated_by_user_id,
          updated_at_ms
        FROM "openmeld"."organization_working_language_preferences"
        WHERE organization_id = $1
        LIMIT 1
      `,
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return mapPreferenceRow(input.organizationId, row);
}
export async function readOrganizationWorkingLanguagePreferenceForSpace(input: {
  db: PostgresDatabase;
  spaceId: string;
}): Promise<OrganizationWorkingLanguagePreferenceRecord | null> {
  const row = await input.db
    .query<OrganizationWorkingLanguagePreferenceRow>({
      text: `
        SELECT
          spaces.organization_id,
          preferences.mode,
          preferences.language_tag,
          preferences.revision,
          preferences.updated_by_user_id,
          preferences.updated_at_ms
        FROM "openmeld"."space_index_spaces" AS spaces
        LEFT JOIN "openmeld"."organization_working_language_preferences" AS preferences
          ON preferences.organization_id = spaces.organization_id
        WHERE spaces.space_id = $1
        LIMIT 1
      `,
      values: [input.spaceId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row?.organization_id) {
    return null;
  }
  return mapPreferenceRow(row.organization_id, row);
}
export async function setOrganizationWorkingLanguagePreference(input: {
  atomicStatements?: readonly QueryConfig[];
  db: PostgresDatabase;
  languageTag?: string;
  mode: "automatic" | "selected";
  nowMs: number;
  organizationId: string;
  updatedByUserId: string;
}): Promise<OrganizationWorkingLanguagePreferenceRecord> {
  const preferenceStatement =
    prepareSetOrganizationWorkingLanguagePreferenceStatement(input);
  await input.db.transaction(async (client) =>
    Promise.all([
      client.query(preferenceStatement),
      ...(input.atomicStatements ?? []).map((query) => client.query(query)),
    ])
  );
  return input.mode === "automatic"
    ? defaultPreference(input.organizationId)
    : await readOrganizationWorkingLanguagePreference(input);
}
export function prepareSetOrganizationWorkingLanguagePreferenceStatement(input: {
  db: PostgresDatabase;
  languageTag?: string;
  mode: "automatic" | "selected";
  nowMs: number;
  organizationId: string;
  updatedByUserId: string;
}): QueryConfig {
  if (input.mode === "automatic") {
    return {
      text: `
          DELETE FROM "openmeld"."organization_working_language_preferences"
          WHERE organization_id = $1
        `,
      values: [input.organizationId],
    };
  }
  const languageTag = workingLanguageTagSchema.parse(input.languageTag);
  return {
    text: `
        INSERT INTO "openmeld"."organization_working_language_preferences" (
          organization_id,
          mode,
          language_tag,
          revision,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, 'selected', $2, 1, $3, $4, $5)
        ON CONFLICT(organization_id) DO UPDATE SET
          mode = 'selected',
          language_tag = excluded.language_tag,
          revision = organization_working_language_preferences.revision + 1,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      input.organizationId,
      languageTag,
      input.updatedByUserId,
      input.nowMs,
      input.nowMs,
    ],
  };
}
export async function observeOrganizationWorkingLanguage(input: {
  beforeMutation?: (client: PoolClient) => Promise<void>;
  db: PostgresDatabase;
  languageTag: string;
  nowMs: number;
  onChangedStatements?: readonly QueryConfig[];
  organizationId: string;
}): Promise<{
  changed: boolean;
  preference: OrganizationWorkingLanguagePreferenceRecord;
}> {
  const languageTag = workingLanguageTagSchema.parse(input.languageTag);
  const current = await readOrganizationWorkingLanguagePreference(input);
  const mutationStatement =
    current.mode === "automatic" && current.languageTag !== languageTag
      ? prepareObserveOrganizationWorkingLanguageStatement({
          ...input,
          languageTag,
        })
      : null;
  const changed = mutationStatement !== null;
  if (input.beforeMutation || mutationStatement) {
    await input.db.transaction(async (client) => {
      await input.beforeMutation?.(client);
      if (mutationStatement) {
        const result = await client.query(mutationStatement);
        if (result.rowCount !== 1) {
          throw new Error(
            "Working language changed concurrently; observation was rolled back."
          );
        }
        for (const statement of input.onChangedStatements ?? []) {
          await client.query(statement);
        }
      }
    });
  }
  return {
    changed,
    preference: await readOrganizationWorkingLanguagePreference(input),
  };
}
function prepareObserveOrganizationWorkingLanguageStatement(input: {
  db: PostgresDatabase;
  languageTag: string;
  nowMs: number;
  organizationId: string;
}): QueryConfig {
  const languageTag = workingLanguageTagSchema.parse(input.languageTag);
  const mutationStatement = {
    text: `
        INSERT INTO "openmeld"."organization_working_language_preferences" (
          organization_id,
          mode,
          language_tag,
          revision,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, 'automatic', $2, 1, NULL, $3, $4)
        ON CONFLICT(organization_id) DO UPDATE SET
          language_tag = excluded.language_tag,
          revision = organization_working_language_preferences.revision + 1,
          updated_at_ms = excluded.updated_at_ms
        WHERE organization_working_language_preferences.mode = 'automatic'
          AND organization_working_language_preferences.language_tag != excluded.language_tag
      `,
    values: [input.organizationId, languageTag, input.nowMs, input.nowMs],
  };
  return mutationStatement;
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
