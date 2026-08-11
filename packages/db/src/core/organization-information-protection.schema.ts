import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const organizationInformationProtectionPolicies = sqliteTable(
  "organization_information_protection_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    protectedInformation: text("protected_information").notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  () => [
    check(
      "organization_information_protection_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "organization_information_protection_content_non_empty_check",
      sql`length(trim("protected_information")) > 0`
    ),
    check(
      "organization_information_protection_content_length_check",
      sql`length("protected_information") <= 2000`
    ),
  ]
);
