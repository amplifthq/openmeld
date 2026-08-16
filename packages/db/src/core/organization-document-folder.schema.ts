import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const organizationDocumentFolders = sqliteTable(
  "organization_document_folders",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentFolderId: text("parent_folder_id").references(
      (): AnySQLiteColumn => organizationDocumentFolders.id,
      { onDelete: "set null" }
    ),
    systemKind: text("system_kind"),
    subjectUserId: text("subject_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    nameKey: text("name_key").generatedAlwaysAs(sql`lower("name")`, {
      mode: "stored",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_document_folders_root_name_unique")
      .on(table.organizationId, table.nameKey)
      .where(sql`${table.parentFolderId} is null`),
    uniqueIndex("organization_document_folders_sibling_name_unique")
      .on(table.organizationId, table.parentFolderId, table.nameKey)
      .where(sql`${table.parentFolderId} is not null`),
    uniqueIndex("organization_document_folders_profile_reports_root_unique")
      .on(table.organizationId, table.systemKind)
      .where(sql`${table.systemKind} = 'profile_reports_root'`),
    uniqueIndex("organization_document_folders_profile_reports_person_unique")
      .on(table.organizationId, table.subjectUserId)
      .where(sql`${table.systemKind} = 'profile_reports_person'`),
    index("organization_document_folders_parent_name_idx").on(
      table.organizationId,
      table.parentFolderId,
      table.name
    ),
    check(
      "organization_document_folders_name_check",
      sql`length(trim("name")) between 1 and 200`
    ),
    check(
      "organization_document_folders_updated_at_check",
      sql`"updated_at" >= "created_at"`
    ),
    check(
      "organization_document_folders_parent_check",
      sql`"parent_folder_id" is null or "parent_folder_id" != "id"`
    ),
    check(
      "organization_document_folders_system_kind_check",
      sql`"system_kind" is null or "system_kind" in ('profile_reports_root', 'profile_reports_person')`
    ),
    check(
      "organization_document_folders_system_metadata_check",
      sql`("system_kind" is null and "subject_user_id" is null) or ("system_kind" = 'profile_reports_root' and "parent_folder_id" is null and "subject_user_id" is null) or ("system_kind" = 'profile_reports_person' and "parent_folder_id" is not null and "subject_user_id" is not null)`
    ),
  ]
);
