import { sql } from "drizzle-orm";
import { bigint, check, text } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

export const organizationInformationProtectionPolicies = applicationTable(
  "organization_information_protection_policies",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    protectedInformation: text("protected_information").notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
