const GENERATED_ORGANIZATION_INDEX_BLOCK = [
  '  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],',
  ");",
].join("\n");

const OPENMELD_ORGANIZATION_INDEX_BLOCK = [
  "  (table) => [",
  '    uniqueIndex("organizations_slug_uidx").on(table.slug),',
  '    uniqueIndex("organizations_personal_created_by_user_uidx")',
  "      .on(table.createdByUserId)",
  "      .where(",
  `        sql\`\${table.createdByUserId} is not null and case when json_valid(\${table.metadata}) then json_extract(\${table.metadata}, '$.personal') else 0 end = 1\``,
  "      ),",
  "  ],",
  ");",
].join("\n");

/**
 * Adds OpenMeld-owned database invariants that Better Auth's schema generator
 * cannot express. Exact matching deliberately fails when upstream generation
 * changes so a schema upgrade cannot silently drop an invariant.
 */
export function applyAuthSchemaCustomizations(schemaSource: string): string {
  if (schemaSource.includes(OPENMELD_ORGANIZATION_INDEX_BLOCK)) {
    return schemaSource;
  }

  const matches =
    schemaSource.split(GENERATED_ORGANIZATION_INDEX_BLOCK).length - 1;
  if (matches !== 1) {
    throw new Error(
      "Generated Better Auth Organization schema did not match the expected index block."
    );
  }

  return schemaSource.replace(
    GENERATED_ORGANIZATION_INDEX_BLOCK,
    OPENMELD_ORGANIZATION_INDEX_BLOCK
  );
}
