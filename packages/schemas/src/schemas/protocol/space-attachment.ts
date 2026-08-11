import { z } from "zod/v4";

export const SPACE_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
] as const;

const JPEG_MAGIC_BYTES = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;

export const SPACE_ATTACHMENT_MAX_SIZE_BYTES = 5_242_880;

/**
 * W-ATT2 owns enforcement when a message starts referencing attachments.
 */
export const SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE = 4;

export const SPACE_ATTACHMENT_MAX_DIMENSION = 20_000;
export const SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH = 255;

const FILE_NAME_PATH_SEPARATOR_PATTERN = /[\\/]/;
const spaceAttachmentScopeIdSchema = z.string().trim().min(1).max(512);

export const spaceAttachmentIdSchema = z.string().trim().min(1).max(128);

export const spaceAttachmentMimeTypeSchema = z.enum(
  SPACE_ATTACHMENT_ALLOWED_MIME_TYPES
);

export const spaceAttachmentSizeBytesSchema = z
  .number()
  .int()
  .finite()
  .min(1)
  .max(SPACE_ATTACHMENT_MAX_SIZE_BYTES);

/**
 * Width and height are client-declared layout hints. The server stores them
 * without decoding the image and does not verify them against the image bytes.
 */
export const spaceAttachmentDimensionSchema = z
  .number()
  .int()
  .finite()
  .min(1)
  .max(SPACE_ATTACHMENT_MAX_DIMENSION);

export const spaceAttachmentFileNameSchema = z
  .string()
  .transform(
    (value) =>
      value.trim().split(FILE_NAME_PATH_SEPARATOR_PATTERN).at(-1)?.trim() ?? ""
  )
  .pipe(z.string().min(1).max(SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH));

export const spaceAttachmentDescriptorSchema = z.strictObject({
  id: spaceAttachmentIdSchema,
  spaceId: spaceAttachmentScopeIdSchema,
  organizationId: spaceAttachmentScopeIdSchema,
  mimeType: spaceAttachmentMimeTypeSchema,
  sizeBytes: spaceAttachmentSizeBytesSchema,
  /** Client-declared layout hint; not verified against the image bytes. */
  width: spaceAttachmentDimensionSchema.optional(),
  /** Client-declared layout hint; not verified against the image bytes. */
  height: spaceAttachmentDimensionSchema.optional(),
  fileName: spaceAttachmentFileNameSchema.optional(),
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * Attachment metadata embedded in a Space message. Scope and creation facts
 * stay in Core-owned attachment metadata and are not repeated in the signal.
 */
export const spaceMessageAttachmentSchema = z.strictObject({
  id: spaceAttachmentIdSchema,
  mimeType: spaceAttachmentMimeTypeSchema,
  sizeBytes: spaceAttachmentSizeBytesSchema,
  width: spaceAttachmentDimensionSchema.optional(),
  height: spaceAttachmentDimensionSchema.optional(),
  fileName: spaceAttachmentFileNameSchema.optional(),
});

export const spaceMessageAttachmentsSchema = z
  .array(spaceMessageAttachmentSchema)
  .max(SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE);

export function detectSpaceAttachmentMimeType(
  bytes: ArrayBuffer | Uint8Array
): (typeof SPACE_ATTACHMENT_ALLOWED_MIME_TYPES)[number] | null {
  const actual = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (matchesMagicBytes(actual, PNG_MAGIC_BYTES)) {
    return "image/png";
  }
  if (matchesMagicBytes(actual, JPEG_MAGIC_BYTES)) {
    return "image/jpeg";
  }
  return null;
}

export function projectSpaceMessageAttachment(
  descriptor: z.infer<typeof spaceAttachmentDescriptorSchema>
): z.infer<typeof spaceMessageAttachmentSchema> {
  return spaceMessageAttachmentSchema.parse({
    id: descriptor.id,
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
    ...(descriptor.width === undefined ? {} : { width: descriptor.width }),
    ...(descriptor.height === undefined ? {} : { height: descriptor.height }),
    ...(descriptor.fileName === undefined
      ? {}
      : { fileName: descriptor.fileName }),
  });
}

export function buildSpaceAttachmentObjectKey(input: {
  id: string;
  organizationId: string;
  spaceId: string;
}): string {
  return `org/${input.organizationId}/space/${input.spaceId}/${input.id}`;
}

function matchesMagicBytes(
  bytes: Uint8Array,
  expected: readonly number[]
): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

/** Core-owned metadata payload carried inside the authenticated RPC wrapper. */
export const recordSpaceAttachmentPayloadSchema = z.strictObject({
  spaceId: spaceAttachmentScopeIdSchema,
  mimeType: spaceAttachmentMimeTypeSchema,
  sizeBytes: spaceAttachmentSizeBytesSchema,
  width: spaceAttachmentDimensionSchema.optional(),
  height: spaceAttachmentDimensionSchema.optional(),
  fileName: spaceAttachmentFileNameSchema.optional(),
});

export const deleteSpaceAttachmentRecordInputSchema = z.strictObject({
  attachmentId: spaceAttachmentIdSchema,
});

export const deleteSpaceAttachmentRecordResultSchema = z.strictObject({
  deleted: z.boolean(),
});

export const resolveSpaceAttachmentForDownloadPayloadSchema = z.strictObject({
  spaceId: spaceAttachmentScopeIdSchema,
  attachmentId: spaceAttachmentIdSchema,
});
