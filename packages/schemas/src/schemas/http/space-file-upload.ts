import * as z from "../../lazy-zod";
import {
  SPACE_FILE_MAX_SIZE_BYTES,
  spaceComposerUploadDescriptorSchema,
  spaceComposerUploadIdSchema,
  spaceFileClientMutationIdSchema,
  spaceFileDescriptorSchema,
  spaceFileEntryIdSchema,
  spaceFileMimeTypeSchema,
  spaceFileNameSchema,
  spaceFileOriginSchema,
} from "./space-files";

export const SPACE_FILE_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const SPACE_FILE_UPLOAD_MAX_PARTS = Math.ceil(
  SPACE_FILE_MAX_SIZE_BYTES / SPACE_FILE_UPLOAD_PART_BYTES
);
export const SPACE_FILE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Stable client-side upload identity for exact retries of one mutation. */
export async function spaceFileUploadIdForMutation(
  mutationId: string
): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(mutationId)
  );
  const hex = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const spaceFileUploadMetadataSchema = z.object({
  mimeType: spaceFileMimeTypeSchema,
  sizeBytes: z.number().int().min(1).max(SPACE_FILE_MAX_SIZE_BYTES),
  partDigests: z
    .array(z.string().regex(/^[a-f0-9]{64}$/u))
    .min(1)
    .max(SPACE_FILE_UPLOAD_MAX_PARTS),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("composer"), name: spaceFileNameSchema }),
    z.object({
      kind: z.literal("file"),
      clientMutationId: spaceFileClientMutationIdSchema,
      name: spaceFileNameSchema,
      parentId: spaceFileEntryIdSchema.nullable(),
      origin: spaceFileOriginSchema.optional(),
    }),
    z.object({
      kind: z.literal("revision"),
      clientMutationId: spaceFileClientMutationIdSchema,
      fileId: spaceFileEntryIdSchema,
      baseRevision: z.number().int().min(1),
    }),
  ]),
});
export const spaceFileUploadCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    metadata: spaceFileUploadMetadataSchema,
  }),
  z.object({ action: z.literal("status") }),
  z.object({
    action: z.literal("part"),
    partNumber: z.number().int().min(1).max(SPACE_FILE_UPLOAD_MAX_PARTS),
  }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("cancel") }),
]);
export const spaceFileUploadPartSchema = z.object({
  partNumber: z.number().int().min(1).max(SPACE_FILE_UPLOAD_MAX_PARTS),
  etag: z.string().min(1),
  sizeBytes: z.number().int().min(1).max(SPACE_FILE_UPLOAD_PART_BYTES),
});
export const spaceFileUploadResponseSchema = z.object({
  uploadId: spaceComposerUploadIdSchema,
  expiresAt: z.string().datetime(),
  partSizeBytes: z.literal(SPACE_FILE_UPLOAD_PART_BYTES),
  parts: z.array(spaceFileUploadPartSchema),
  file: spaceFileDescriptorSchema.optional(),
  upload: spaceComposerUploadDescriptorSchema.optional(),
  cancelled: z.boolean().optional(),
});
