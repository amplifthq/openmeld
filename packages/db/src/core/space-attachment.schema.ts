import {
  SPACE_ATTACHMENT_ALLOWED_MIME_TYPES,
  SPACE_ATTACHMENT_MAX_DIMENSION,
  SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH,
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";

const SPACE_ATTACHMENT_ALLOWED_MIME_TYPES_SQL =
  SPACE_ATTACHMENT_ALLOWED_MIME_TYPES.map(
    (mimeType) => `'${mimeType.replaceAll("'", "''")}'`
  ).join(", ");

export const spaceAttachments = sqliteTable(
  "space_attachments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    uploaderUserId: text("uploader_user_id").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    fileName: text("file_name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("space_attachments_space_created_idx").on(
      table.spaceId,
      table.createdAt
    ),
    index("space_attachments_organization_idx").on(table.organizationId),
    check("space_attachments_id_non_empty_check", sql`length(trim("id")) > 0`),
    check(
      "space_attachments_organization_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "space_attachments_space_non_empty_check",
      sql`length(trim("space_id")) > 0`
    ),
    check(
      "space_attachments_uploader_non_empty_check",
      sql`length(trim("uploader_user_id")) > 0`
    ),
    check(
      "space_attachments_mime_type_check",
      sql.raw(`"mime_type" in (${SPACE_ATTACHMENT_ALLOWED_MIME_TYPES_SQL})`)
    ),
    check(
      "space_attachments_size_range_check",
      sql.raw(`"size_bytes" between 1 and ${SPACE_ATTACHMENT_MAX_SIZE_BYTES}`)
    ),
    check(
      "space_attachments_width_range_check",
      sql.raw(
        `"width" is null or "width" between 1 and ${SPACE_ATTACHMENT_MAX_DIMENSION}`
      )
    ),
    check(
      "space_attachments_height_range_check",
      sql.raw(
        `"height" is null or "height" between 1 and ${SPACE_ATTACHMENT_MAX_DIMENSION}`
      )
    ),
    check(
      "space_attachments_file_name_length_check",
      sql.raw(
        `"file_name" is null or (length(trim("file_name")) > 0 and length("file_name") <= ${SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH})`
      )
    ),
  ]
);
