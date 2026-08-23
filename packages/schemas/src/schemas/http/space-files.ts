import { z } from "zod/v4";

export const SPACE_FILE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES = 1024 * 1024;
export const SPACE_FILE_MAX_NAME_LENGTH = 255;
export const SPACE_FILE_MAX_FOLDER_DEPTH = 20;
export const SPACE_MESSAGE_FILE_MAX_COUNT = 10;

const PATH_SEPARATOR_PATTERN = /[\\/]/u;
const MEDIA_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};
const scopeIdSchema = z.string().trim().min(1).max(512);

export const spaceFileEntryIdSchema = z.string().trim().min(1).max(128);
export const spaceFileRevisionIdSchema = z.string().trim().min(1).max(128);
export const spaceFileClientMutationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128);
export const spaceFileRevisionNumberSchema = z.number().int().min(1);
export const spaceFileBaseRevisionSchema = z.number().int().min(1).nullable();
export const spaceFileSizeBytesSchema = z
  .number()
  .int()
  .min(0)
  .max(SPACE_FILE_MAX_SIZE_BYTES);

/**
 * Derives the opaque file identity for a retriable create mutation.
 * Reusing the mutation identity produces the same file identity.
 */
export async function buildSpaceFileEntryIdForMutation(
  clientMutationId: string
): Promise<string> {
  return await buildSpaceFileMutationStorageId({
    clientMutationId,
    kind: "file",
  });
}

/**
 * Derives an immutable revision identity from both the mutation and its bytes.
 * Exact retries reuse the same object key, while changed bytes conflict instead
 * of overwriting an already committed revision.
 */
export async function buildSpaceFileRevisionIdForMutation(input: {
  baseRevision: number | null;
  bytes: ArrayBuffer;
  clientMutationId: string;
  mimeType: string;
  name?: string;
  parentId?: string | null;
}): Promise<string> {
  const contentDigest = await sha256Hex(input.bytes);
  const revisionIdentity = JSON.stringify({
    baseRevision: spaceFileBaseRevisionSchema.parse(input.baseRevision),
    contentDigest,
    mimeType: spaceFileMimeTypeSchema.parse(input.mimeType),
    name:
      input.name === undefined ? null : spaceFileNameSchema.parse(input.name),
    parentId:
      input.parentId === undefined || input.parentId === null
        ? null
        : spaceFileEntryIdSchema.parse(input.parentId),
  });
  return await buildSpaceFileMutationStorageId({
    clientMutationId: input.clientMutationId,
    revisionIdentity,
    kind: "revision",
  });
}

async function buildSpaceFileMutationStorageId(input: {
  clientMutationId: string;
  kind: "file" | "revision";
  revisionIdentity?: string;
}): Promise<string> {
  const clientMutationId = spaceFileClientMutationIdSchema.parse(
    input.clientMutationId
  );
  const encoded = new TextEncoder().encode(
    [
      "space-file",
      input.kind,
      clientMutationId,
      input.revisionIdentity ?? "",
    ].join(":")
  );
  const bytes = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(bytes).set(encoded);
  return `${input.kind}-${await sha256Hex(bytes)}`;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
export const spaceFileMimeTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .regex(MEDIA_TYPE_PATTERN, "File type must be a valid media type.");
export const spaceFileNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(SPACE_FILE_MAX_NAME_LENGTH)
      .refine((value) => !PATH_SEPARATOR_PATTERN.test(value), {
        message: "File names cannot contain path separators.",
      })
      .refine((value) => !hasControlCharacter(value), {
        message: "File names cannot contain control characters.",
      })
      .refine((value) => value !== "." && value !== "..", {
        message: "File names cannot be dot path segments.",
      })
  );

export const spaceFileActorSchema = z.strictObject({
  profileId: scopeIdSchema,
  profileKind: z.enum(["human", "agent"]),
  displayName: z.string().trim().min(1).max(200),
  ownerUserId: scopeIdSchema.optional(),
});

export const spaceFileRevisionSchema = z.strictObject({
  id: spaceFileRevisionIdSchema,
  fileId: spaceFileEntryIdSchema,
  revision: spaceFileRevisionNumberSchema,
  mimeType: spaceFileMimeTypeSchema,
  sizeBytes: spaceFileSizeBytesSchema,
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: spaceFileActorSchema,
});

/**
 * Canonical Space File revision embedded in a message. `fileId` and
 * `revision` identify the immutable bytes; the remaining fields are the
 * server-resolved send-time presentation snapshot.
 */
export const spaceMessageFileReferenceSchema = z.strictObject({
  fileId: spaceFileEntryIdSchema,
  revision: spaceFileRevisionNumberSchema,
  name: spaceFileNameSchema,
  mimeType: spaceFileMimeTypeSchema,
  sizeBytes: spaceFileSizeBytesSchema,
});

export const spaceMessageFileReferencesSchema = z
  .array(spaceMessageFileReferenceSchema)
  .max(SPACE_MESSAGE_FILE_MAX_COUNT);

const baseEntryShape = {
  id: spaceFileEntryIdSchema,
  spaceId: scopeIdSchema,
  parentId: spaceFileEntryIdSchema.nullable(),
  name: spaceFileNameSchema,
  path: z.string().startsWith("/").max(4096),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  createdBy: spaceFileActorSchema,
  updatedBy: spaceFileActorSchema,
  trashedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  trashedBy: spaceFileActorSchema.nullable().default(null),
};

export const spaceFolderDescriptorSchema = z.strictObject({
  ...baseEntryShape,
  kind: z.literal("folder"),
});

export const spaceFileDescriptorSchema = z.strictObject({
  ...baseEntryShape,
  kind: z.literal("file"),
  latestRevision: spaceFileRevisionSchema,
});

export const spaceFileEntrySchema = z.discriminatedUnion("kind", [
  spaceFolderDescriptorSchema,
  spaceFileDescriptorSchema,
]);

export const spaceFileBreadcrumbSchema = z.strictObject({
  id: spaceFileEntryIdSchema.nullable(),
  name: z.string().trim().min(1).max(SPACE_FILE_MAX_NAME_LENGTH),
});

export const spaceFileCapabilitiesSchema = z.strictObject({
  canRead: z.literal(true),
  canWrite: z.boolean(),
});

export const listSpaceFilesQuerySchema = z.strictObject({
  parentId: spaceFileEntryIdSchema.nullable().optional(),
  view: z.enum(["active", "trash"]).default("active"),
});

export const listSpaceFilesResponseSchema = z.strictObject({
  spaceId: scopeIdSchema,
  parentId: spaceFileEntryIdSchema.nullable(),
  view: z.enum(["active", "trash"]).default("active"),
  breadcrumbs: z.array(spaceFileBreadcrumbSchema),
  entries: z.array(spaceFileEntrySchema),
  capabilities: spaceFileCapabilitiesSchema,
});

export const getSpaceFileResponseSchema = z.strictObject({
  file: spaceFileDescriptorSchema,
});

export const listSpaceFileRevisionsResponseSchema = z.strictObject({
  file: spaceFileDescriptorSchema,
  revisions: z.array(spaceFileRevisionSchema),
});

export const createSpaceFolderBodySchema = z.strictObject({
  name: spaceFileNameSchema,
  parentId: spaceFileEntryIdSchema.nullable().optional(),
  clientMutationId: spaceFileClientMutationIdSchema,
});

export const createSpaceFolderResponseSchema = z.strictObject({
  folder: spaceFolderDescriptorSchema,
});

export const updateSpaceFileEntryBodySchema = z
  .strictObject({
    name: spaceFileNameSchema.optional(),
    parentId: spaceFileEntryIdSchema.nullable().optional(),
    clientMutationId: spaceFileClientMutationIdSchema,
  })
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: "A new name or folder is required.",
  });

export const updateSpaceFileEntryResponseSchema = z.strictObject({
  entry: spaceFileEntrySchema,
});

export const trashSpaceFileEntryBodySchema = z.strictObject({
  clientMutationId: spaceFileClientMutationIdSchema,
});

export const trashSpaceFileEntryResponseSchema = z.strictObject({
  entryId: spaceFileEntryIdSchema,
  trashedAt: z.iso.datetime({ offset: true }),
});

export const restoreSpaceFileEntryBodySchema = z.strictObject({
  clientMutationId: spaceFileClientMutationIdSchema,
});

export const restoreSpaceFileEntryResponseSchema = z.strictObject({
  entry: spaceFileEntrySchema,
});

export const restoreSpaceFileRevisionBodySchema = z.strictObject({
  baseRevision: spaceFileRevisionNumberSchema,
  clientMutationId: spaceFileClientMutationIdSchema,
});

export const restoreSpaceFileRevisionResponseSchema = z.strictObject({
  file: spaceFileDescriptorSchema,
});

const queryIntegerSchema = z.string().trim().regex(/^\d+$/u).transform(Number);

export const createSpaceFileUploadQuerySchema = z.strictObject({
  name: spaceFileNameSchema,
  parentId: spaceFileEntryIdSchema.optional(),
  clientMutationId: spaceFileClientMutationIdSchema,
});

export const updateSpaceFileContentQuerySchema = z.strictObject({
  baseRevision: queryIntegerSchema.pipe(spaceFileRevisionNumberSchema),
  clientMutationId: spaceFileClientMutationIdSchema,
});

export const uploadSpaceFileResponseSchema = z.strictObject({
  file: spaceFileDescriptorSchema,
});

export const spaceFileContentQuerySchema = z.strictObject({
  revision: queryIntegerSchema.pipe(spaceFileRevisionNumberSchema).optional(),
});

export const SPACE_FILE_ERROR_CODES = [
  "space_file.conflict",
  "space_file.folder_not_empty",
  "space_file.invalid_parent",
  "space_file.name_conflict",
  "space_file.not_found",
  "space_file.storage_failed",
  "space_file.too_large",
  "space_file.type_unsupported",
] as const;

export const spaceFileMutationErrorCodeSchema = z.enum(SPACE_FILE_ERROR_CODES);

export const spaceFileMutationErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: spaceFileMutationErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    currentFile: spaceFileDescriptorSchema.optional(),
  }),
});

export const prepareSpaceFileWriteInputSchema = z.strictObject({
  spaceId: scopeIdSchema,
  fileId: spaceFileEntryIdSchema,
  revisionId: spaceFileRevisionIdSchema,
  name: spaceFileNameSchema.optional(),
  parentId: spaceFileEntryIdSchema.nullable().optional(),
  baseRevision: spaceFileBaseRevisionSchema,
  clientMutationId: spaceFileClientMutationIdSchema,
  mimeType: spaceFileMimeTypeSchema,
  sizeBytes: spaceFileSizeBytesSchema,
});

export const prepareSpaceFileWriteResponseSchema = z.strictObject({
  organizationId: scopeIdSchema,
  spaceId: scopeIdSchema,
  fileId: spaceFileEntryIdSchema,
  revisionId: spaceFileRevisionIdSchema,
  objectKey: z.string().trim().min(1).max(4096),
  committedFile: spaceFileDescriptorSchema.optional(),
});

export const commitSpaceFileWriteInputSchema = prepareSpaceFileWriteInputSchema;

export const resolveSpaceFileContentInputSchema = z.strictObject({
  spaceId: scopeIdSchema,
  fileId: spaceFileEntryIdSchema,
  revision: spaceFileRevisionNumberSchema.optional(),
});

export const resolveSpaceFileContentResponseSchema = z.strictObject({
  file: spaceFileDescriptorSchema,
  revision: spaceFileRevisionSchema,
  organizationId: scopeIdSchema,
  objectKey: z.string().trim().min(1).max(4096),
});

export function buildSpaceFileObjectKey(input: {
  organizationId: string;
  spaceId: string;
  fileId: string;
  revisionId: string;
}): string {
  return `org/${input.organizationId}/space/${input.spaceId}/files/${input.fileId}/revisions/${input.revisionId}`;
}

export function isSpaceFileTextEditable(input: {
  mimeType: string;
  sizeBytes: number;
}): boolean {
  return (
    input.sizeBytes <= SPACE_FILE_MAX_TEXT_EDIT_SIZE_BYTES &&
    (input.mimeType.startsWith("text/") ||
      input.mimeType === "application/json" ||
      input.mimeType === "application/yaml" ||
      input.mimeType === "application/x-yaml" ||
      input.mimeType === "application/xml")
  );
}

export function resolveSpaceFileMimeType(input: {
  declaredMimeType?: string | null;
  fileName: string;
}): string {
  const declaredMimeType = input.declaredMimeType?.trim().toLowerCase();
  if (declaredMimeType) {
    return declaredMimeType;
  }
  const fileName = input.fileName.toLowerCase();
  const extensionStart = fileName.lastIndexOf(".");
  const extension = extensionStart >= 0 ? fileName.slice(extensionStart) : "";
  return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
