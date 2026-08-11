import type { spaceAttachments } from "@openmeld/db/core";
import { spaceAttachmentDescriptorSchema } from "@openmeld/schemas";
import type { SpaceAttachmentDescriptor } from "@openmeld/schemas/types";

type SpaceAttachmentTableRecord = typeof spaceAttachments.$inferSelect;

export type SpaceAttachmentRecord = Omit<
  SpaceAttachmentTableRecord,
  "createdAt" | "fileName" | "height" | "mimeType" | "width"
> & {
  createdAtMs: number;
  fileName: string | null;
  height: number | null;
  mimeType: SpaceAttachmentDescriptor["mimeType"];
  width: number | null;
};

type SpaceAttachmentRow = {
  created_at: number;
  file_name: string | null;
  height: number | null;
  id: string;
  mime_type: string;
  organization_id: string;
  size_bytes: number;
  space_id: string;
  width: number | null;
};

export async function insertSpaceAttachmentRecord(input: {
  db: D1Database;
  record: SpaceAttachmentRecord;
}): Promise<void> {
  await input.db
    .prepare(
      `
        INSERT INTO space_attachments (
          id,
          organization_id,
          space_id,
          uploader_user_id,
          mime_type,
          size_bytes,
          width,
          height,
          file_name,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.record.id,
      input.record.organizationId,
      input.record.spaceId,
      input.record.uploaderUserId,
      input.record.mimeType,
      input.record.sizeBytes,
      input.record.width,
      input.record.height,
      input.record.fileName,
      input.record.createdAtMs
    )
    .run();
}

export async function readSpaceAttachmentRecord(input: {
  attachmentId: string;
  db: D1Database;
  organizationId: string;
  spaceId: string;
}): Promise<SpaceAttachmentDescriptor | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          space_id,
          mime_type,
          size_bytes,
          width,
          height,
          file_name,
          created_at
        FROM space_attachments
        WHERE id = ?
          AND organization_id = ?
          AND space_id = ?
        LIMIT 1
      `
    )
    .bind(input.attachmentId, input.organizationId, input.spaceId)
    .first<SpaceAttachmentRow>();
  if (!row) {
    return null;
  }

  const descriptor = spaceAttachmentDescriptorSchema.safeParse({
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.file_name === null ? {} : { fileName: row.file_name }),
    createdAt: new Date(row.created_at).toISOString(),
  });
  if (!descriptor.success) {
    throw new Error(
      `Space attachment record ${input.attachmentId} is invalid: ${descriptor.error.message}`
    );
  }
  return descriptor.data;
}

export async function deleteSpaceAttachmentRecord(input: {
  attachmentId: string;
  db: D1Database;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        DELETE FROM space_attachments
        WHERE id = ?
      `
    )
    .bind(input.attachmentId)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}
