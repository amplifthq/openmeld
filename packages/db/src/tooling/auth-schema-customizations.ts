const POSTGRESQL_IMPORT = /import\s*\{[^}]+\}\s*from "drizzle-orm\/pg-core";/u;
const ORGANIZATION_TABLE =
  /export const organizations = applicationTable\("organizations", \{([\s\S]*?)\n\}\);/u;
const SUPPORTED_PRIMITIVES = new Set([
  "pgTable",
  "text",
  "timestamp",
  "boolean",
  "integer",
  "uuid",
  "index",
  "bigint",
]);

/** Preserve OpenMeld's storage contract around the version-matched official generator. */
export function applyAuthSchemaCustomizations(schemaSource: string): string {
  const primitives = schemaSource
    .match(POSTGRESQL_IMPORT)?.[0]
    .split("{")[1]
    ?.split("}")[0]
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (
    !(
      primitives?.every((name) => SUPPORTED_PRIMITIVES.has(name)) &&
      schemaSource.includes('export const users = pgTable("users", {') &&
      schemaSource.includes(
        'export const organizations = pgTable("organizations", {'
      )
    )
  ) {
    throw new Error(
      "Generated Better Auth PostgreSQL schema did not match the supported contract."
    );
  }
  const native = schemaSource
    .replace(
      POSTGRESQL_IMPORT,
      `import { bigint, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { applicationTable, currentTimestampMilliseconds } from "../postgresql/schema.ts";
import { epochMilliseconds, integerBoolean } from "../postgresql/schema-types.ts";`
    )
    .replaceAll(/\bpgTable\(/gu, "applicationTable(")
    .replaceAll(/\btimestamp\(/gu, "epochMilliseconds(")
    .replaceAll(/\bboolean\(/gu, "integerBoolean(")
    .replaceAll(/\buuid\(/gu, "text(")
    .replaceAll(/\binteger\("([^"]+)"\)/gu, 'bigint("$1", { mode: "number" })')
    .replaceAll(
      "sql`pg_catalog.gen_random_uuid()`",
      "sql`gen_random_uuid()::text`"
    )
    .replaceAll(".defaultNow()", ".default(currentTimestampMilliseconds)")
    .replaceAll(".default(false)", ".default(sql`0`)")
    .replaceAll(".default(true)", ".default(sql`1`)")
    .replaceAll(
      /id: text\("id"\)\s*\.default\(sql`gen_random_uuid\(\)::text`\)\s*\.primaryKey\(\)/gu,
      'id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)'
    );
  if (!ORGANIZATION_TABLE.test(native)) {
    throw new Error(
      "Generated Better Auth Organization schema did not match the supported contract."
    );
  }
  return native.replace(
    ORGANIZATION_TABLE,
    `export const organizations = applicationTable("organizations", {$1
}, (table) => [
  uniqueIndex("organizations_slug_uidx").on(table.slug),
  uniqueIndex("organizations_personal_created_by_user_uidx")
    .on(table.createdByUserId)
    .where(sql\`\${table.createdByUserId} is not null and case when (\${table.metadata} is json) then (\${table.metadata})::jsonb -> 'personal' in ('true'::jsonb, '1'::jsonb) else false end\`),
]);`
  );
}
