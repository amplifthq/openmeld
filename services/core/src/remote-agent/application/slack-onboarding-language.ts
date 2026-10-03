import type { PostgresDatabase } from "@openmeld/db/postgresql";
export async function resolveSlackOnboardingLanguageTag(input: {
  db: PostgresDatabase;
  organizationId: string;
  researchTaskId: string | null;
}): Promise<string | null> {
  const row = await input.db
    .query<{
      language_tag: string | null;
    }>({
      text: `
        SELECT COALESCE(
          (
            SELECT tasks.observed_language_tag
            FROM "openmeld"."center_agent_member_research_tasks" AS tasks
            WHERE tasks.id = $1
            LIMIT 1
          ),
          preferences.language_tag
        ) AS language_tag
        FROM "openmeld"."organizations"
        LEFT JOIN "openmeld"."organization_working_language_preferences" AS preferences
          ON preferences.organization_id = organizations.id
        WHERE organizations.id = $2
        LIMIT 1
      `,
      values: [input.researchTaskId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  const languageTag = row?.language_tag?.trim() ?? "";
  return languageTag || null;
}
