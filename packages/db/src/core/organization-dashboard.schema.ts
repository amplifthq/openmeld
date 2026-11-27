import { sql } from "drizzle-orm";
import { check, index, jsonb, text } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";
import { epochMilliseconds } from "../postgresql/schema-types.ts";

export const organizationDashboards = applicationTable(
  "organization_dashboards",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    creatorUserId: text("creator_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    repository: text("repository"),
    artifact: jsonb("artifact"),
    createdAt: epochMilliseconds("created_at_ms").notNull(),
    updatedAt: epochMilliseconds("updated_at_ms").notNull(),
    archivedAt: epochMilliseconds("archived_at_ms"),
  },
  (table) => [
    index("organization_dashboards_active_idx")
      .on(table.organizationId, table.updatedAt)
      .where(sql`${table.archivedAt} IS NULL`),
    check(
      "organization_dashboards_kind_check",
      sql`${table.kind} IN ('github_issues', 'ugc', 'traffic')`
    ),
    check(
      "organization_dashboards_source_check",
      sql`(${table.kind} = 'github_issues' AND ${table.repository} IS NOT NULL AND ${table.artifact} IS NULL) OR (${table.kind} <> 'github_issues' AND ${table.repository} IS NULL)`
    ),
  ]
);
