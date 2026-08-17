export async function resolveSlackOnboardingLanguageTag(input: {
  db: D1Database;
  organizationId: string;
  researchTaskId: string | null;
}): Promise<string | null> {
  const row = await input.db
    .prepare(
      `
        SELECT COALESCE(
          (
            SELECT tasks.observed_language_tag
            FROM center_agent_member_research_tasks AS tasks
            WHERE tasks.id = ?
            LIMIT 1
          ),
          preferences.language_tag
        ) AS language_tag
        FROM organizations
        LEFT JOIN organization_working_language_preferences AS preferences
          ON preferences.organization_id = organizations.id
        WHERE organizations.id = ?
        LIMIT 1
      `
    )
    .bind(input.researchTaskId, input.organizationId)
    .first<{ language_tag: string | null }>();
  const languageTag = row?.language_tag?.trim() ?? "";
  return languageTag || null;
}
