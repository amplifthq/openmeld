import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { openMeldDaemonAgentProfileBindings } from "./agent-profile-binding.schema.ts";

export const organizationBindingAuthorizations = sqliteTable(
  "organization_binding_authorizations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bindingId: text("binding_id")
      .notNull()
      .references(() => openMeldDaemonAgentProfileBindings.bindingId, {
        onDelete: "cascade",
      }),
    authorizedBy: text("authorized_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_binding_authorizations_org_binding_uq_idx").on(
      table.organizationId,
      table.bindingId
    ),
    index("organization_binding_authorizations_binding_idx").on(
      table.bindingId
    ),
    index("organization_binding_authorizations_authorized_by_idx").on(
      table.authorizedBy
    ),
    check(
      "organization_binding_authorizations_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "organization_binding_authorizations_organization_id_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "organization_binding_authorizations_binding_id_non_empty_check",
      sql`length(trim("binding_id")) > 0`
    ),
    check(
      "organization_binding_authorizations_authorized_by_non_empty_check",
      sql`length(trim("authorized_by")) > 0`
    ),
  ]
);
