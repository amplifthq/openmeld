import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { organizationDocumentFolders } from "./organization-document-folder.schema.ts";

export const organizationDocuments = sqliteTable(
  "organization_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subjectUserId: text("subject_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    profileReportDate: text("profile_report_date"),
    profileReportType: text("profile_report_type"),
    // Deleting a folder preserves its documents. The service first moves
    // them to the deleted folder's parent; the FK is a final safety net.
    folderId: text("folder_id").references(
      () => organizationDocumentFolders.id,
      { onDelete: "set null" }
    ),
    title: text("title").notNull(),
    content: text("content").default("").notNull(),
    draftContent: text("draft_content"),
    draftCreatedBy: text("draft_created_by"),
    draftCreatedAt: integer("draft_created_at", { mode: "timestamp_ms" }),
    lastMemberResearchTaskId: text("last_member_research_task_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_documents_org_brief_unique")
      .on(table.organizationId)
      .where(sql`"kind" = 'brief'`),
    index("organization_documents_org_member_profile_date_idx").on(
      table.organizationId,
      table.subjectUserId,
      desc(table.profileReportDate)
    ),
    uniqueIndex("organization_documents_profile_report_title_unique")
      .on(
        table.organizationId,
        table.subjectUserId,
        table.profileReportDate,
        table.profileReportType,
        table.title
      )
      .where(
        sql`"kind" = 'member_profile' and "profile_report_date" is not null`
      ),
    uniqueIndex("organization_documents_member_research_task_unique")
      .on(table.lastMemberResearchTaskId)
      .where(sql`"last_member_research_task_id" is not null`),
    index("organization_documents_org_kind_updated_idx").on(
      table.organizationId,
      table.kind,
      desc(table.updatedAt)
    ),
    check(
      "organization_documents_kind_check",
      sql`"kind" in ('brief', 'member_profile', 'knowledge')`
    ),
    check(
      "organization_documents_subject_check",
      sql`("kind" = 'member_profile' and "subject_user_id" is not null) or ("kind" != 'member_profile' and "subject_user_id" is null)`
    ),
    check(
      "organization_documents_brief_title_check",
      sql`"kind" != 'brief' or "title" = 'Organization Brief'`
    ),
    check(
      "organization_documents_title_check",
      sql`length(trim("title")) between 1 and 200`
    ),
    check(
      "organization_documents_content_length_check",
      sql`length("content") <= 20000`
    ),
    check(
      "organization_documents_draft_content_length_check",
      sql`"draft_content" is null or length("draft_content") <= 20000`
    ),
    check(
      "organization_documents_draft_metadata_check",
      sql`("draft_content" is null and "draft_created_by" is null and "draft_created_at" is null) or ("draft_content" is not null and "draft_created_by" = 'center_agent' and "draft_created_at" is not null)`
    ),
    check(
      "organization_documents_member_research_check",
      sql`"last_member_research_task_id" is null or "kind" = 'member_profile'`
    ),
    check(
      "organization_documents_profile_report_metadata_check",
      sql`("kind" != 'member_profile' and "profile_report_date" is null and "profile_report_type" is null) or ("kind" = 'member_profile' and (("profile_report_date" is null and "profile_report_type" is null) or (length("profile_report_date") = 10 and "profile_report_type" = 'work_profile')))`
    ),
    check(
      "organization_documents_updated_at_check",
      sql`"updated_at" >= "created_at"`
    ),
  ]
);
