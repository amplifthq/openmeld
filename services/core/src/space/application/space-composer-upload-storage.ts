import {
  buildSpaceComposerUploadObjectKey,
  SPACE_COMPOSER_UPLOAD_OBJECT_PREFIX,
  spaceComposerUploadDescriptorSchema,
} from "@openmeld/schemas";
import type { SpaceComposerUploadDescriptor } from "@openmeld/schemas/types";

type SpaceComposerUploadMetadata = {
  actorProfileId: string;
  expiresAtMs: number;
  mimeType: string;
  name: string;
  organizationId: string;
  sizeBytes: number;
  spaceId: string;
  uploadId: string;
};

export type SpaceComposerUploadScope = {
  actorProfileId: string;
  organizationId: string;
  spaceId: string;
};

export class SpaceComposerUploadStorageError extends Error {
  readonly kind:
    | "conflict"
    | "expired"
    | "invalid"
    | "not_found"
    | "storage_failed";

  constructor(input: {
    cause?: unknown;
    kind: SpaceComposerUploadStorageError["kind"];
    message: string;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "SpaceComposerUploadStorageError";
    this.kind = input.kind;
  }
}

export async function stageSpaceComposerUpload(input: {
  bucket: R2Bucket;
  bytes: ArrayBuffer;
  expiresAtMs: number;
  mimeType: string;
  name: string;
  scope: SpaceComposerUploadScope;
  uploadId: string;
}): Promise<SpaceComposerUploadDescriptor> {
  const descriptor = spaceComposerUploadDescriptorSchema.parse({
    expiresAt: new Date(input.expiresAtMs).toISOString(),
    id: input.uploadId,
    mimeType: input.mimeType,
    name: input.name,
    sizeBytes: input.bytes.byteLength,
  });
  const objectKey = buildScopedObjectKey(input.scope, descriptor.id);
  let stored: R2Object | null;
  try {
    stored = await input.bucket.put(objectKey, input.bytes, {
      httpMetadata: { contentType: descriptor.mimeType },
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: {
        actorProfileId: input.scope.actorProfileId,
        expiresAtMs: String(input.expiresAtMs),
        mimeType: descriptor.mimeType,
        name: descriptor.name,
        organizationId: input.scope.organizationId,
        sizeBytes: String(descriptor.sizeBytes),
        spaceId: input.scope.spaceId,
        uploadId: descriptor.id,
      },
    });
  } catch (error) {
    throw new SpaceComposerUploadStorageError({
      cause: error,
      kind: "storage_failed",
      message: "This file could not be staged right now.",
    });
  }
  if (stored) {
    return descriptor;
  }

  const existing = await readSpaceComposerUpload({
    bucket: input.bucket,
    nowMs: 0,
    scope: input.scope,
    uploadId: input.uploadId,
  });
  if (
    existing.descriptor.mimeType !== descriptor.mimeType ||
    existing.descriptor.name !== descriptor.name ||
    existing.descriptor.sizeBytes !== descriptor.sizeBytes ||
    !arrayBuffersEqual(existing.bytes, input.bytes)
  ) {
    throw new SpaceComposerUploadStorageError({
      kind: "conflict",
      message: "This upload ID was already used for a different file.",
    });
  }
  return existing.descriptor;
}

export async function readSpaceComposerUpload(
  input: Parameters<typeof readSpaceComposerUploadStream>[0]
) {
  const result = await readSpaceComposerUploadStream(input);
  return {
    descriptor: result.descriptor,
    bytes: await new Response(result.body).arrayBuffer(),
  };
}

export async function readSpaceComposerUploadStream(input: {
  bucket: R2Bucket;
  nowMs: number;
  scope: SpaceComposerUploadScope;
  uploadId: string;
}): Promise<{
  body: ReadableStream<Uint8Array>;
  descriptor: SpaceComposerUploadDescriptor;
}> {
  const objectKey = buildScopedObjectKey(input.scope, input.uploadId);
  let object: R2ObjectBody | null;
  try {
    object = await input.bucket.get(objectKey);
  } catch (error) {
    throw new SpaceComposerUploadStorageError({
      cause: error,
      kind: "storage_failed",
      message: "This upload could not be read right now.",
    });
  }
  if (!object) {
    throw new SpaceComposerUploadStorageError({
      kind: "not_found",
      message: "This upload is no longer available. Add the file again.",
    });
  }
  const metadata = parseScopedMetadata({
    customMetadata: object.customMetadata,
    scope: input.scope,
    uploadId: input.uploadId,
  });
  if (metadata.expiresAtMs <= input.nowMs) {
    await discardSpaceComposerUpload({
      bucket: input.bucket,
      scope: input.scope,
      uploadId: input.uploadId,
    });
    throw new SpaceComposerUploadStorageError({
      kind: "expired",
      message: "This upload expired. Add the file again.",
    });
  }
  if (object.size !== metadata.sizeBytes) {
    throw new SpaceComposerUploadStorageError({
      kind: "invalid",
      message: "This upload is incomplete. Add the file again.",
    });
  }
  return {
    body: object.body,
    descriptor: spaceComposerUploadDescriptorSchema.parse({
      expiresAt: new Date(metadata.expiresAtMs).toISOString(),
      id: metadata.uploadId,
      mimeType: metadata.mimeType,
      name: metadata.name,
      sizeBytes: metadata.sizeBytes,
    }),
  };
}

export async function discardSpaceComposerUpload(input: {
  bucket: R2Bucket;
  scope: SpaceComposerUploadScope;
  uploadId: string;
}): Promise<void> {
  try {
    await input.bucket.delete(
      buildScopedObjectKey(input.scope, input.uploadId)
    );
  } catch (error) {
    throw new SpaceComposerUploadStorageError({
      cause: error,
      kind: "storage_failed",
      message: "This upload could not be discarded right now.",
    });
  }
}

export async function deleteExpiredSpaceComposerUploads(input: {
  bucket: R2Bucket;
  nowMs: number;
}): Promise<{ deleted: number; scanned: number }> {
  let cursor: string | undefined;
  let deleted = 0;
  let scanned = 0;
  do {
    const page = await input.bucket.list({
      cursor,
      include: ["customMetadata"],
      limit: 1000,
      prefix: SPACE_COMPOSER_UPLOAD_OBJECT_PREFIX,
    });
    scanned += page.objects.length;
    const expiredKeys = page.objects.flatMap((object) => {
      const metadata = parseMetadata(object.customMetadata);
      return !metadata || metadata.expiresAtMs <= input.nowMs
        ? [object.key]
        : [];
    });
    if (expiredKeys.length > 0) {
      await input.bucket.delete(expiredKeys);
      deleted += expiredKeys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { deleted, scanned };
}

function buildScopedObjectKey(
  scope: SpaceComposerUploadScope,
  uploadId: string
): string {
  return buildSpaceComposerUploadObjectKey({
    actorProfileId: scope.actorProfileId,
    organizationId: scope.organizationId,
    spaceId: scope.spaceId,
    uploadId,
  });
}

function parseScopedMetadata(input: {
  customMetadata?: Record<string, string>;
  scope: SpaceComposerUploadScope;
  uploadId: string;
}) {
  const metadata = parseMetadata(input.customMetadata);
  if (
    !metadata ||
    metadata.actorProfileId !== input.scope.actorProfileId ||
    metadata.organizationId !== input.scope.organizationId ||
    metadata.spaceId !== input.scope.spaceId ||
    metadata.uploadId !== input.uploadId
  ) {
    throw new SpaceComposerUploadStorageError({
      kind: "invalid",
      message: "This upload does not match its Space scope.",
    });
  }
  return metadata;
}

function parseMetadata(
  value: Record<string, string> | undefined
): SpaceComposerUploadMetadata | null {
  if (!value) {
    return null;
  }
  const expiresAtMs = Number(value.expiresAtMs);
  const sizeBytes = Number(value.sizeBytes);
  const expiresAt =
    Number.isSafeInteger(expiresAtMs) && Math.abs(expiresAtMs) <= 8.64e15
      ? new Date(expiresAtMs).toISOString()
      : "";
  const descriptor = spaceComposerUploadDescriptorSchema.safeParse({
    expiresAt,
    id: value.uploadId,
    mimeType: value.mimeType,
    name: value.name,
    sizeBytes,
  });
  const actorProfileId = value.actorProfileId?.trim();
  const organizationId = value.organizationId?.trim();
  const spaceId = value.spaceId?.trim();
  if (
    !(
      descriptor.success &&
      actorProfileId &&
      organizationId &&
      spaceId &&
      Number.isSafeInteger(expiresAtMs)
    )
  ) {
    return null;
  }
  return {
    actorProfileId,
    expiresAtMs,
    mimeType: descriptor.data.mimeType,
    name: descriptor.data.name,
    organizationId,
    sizeBytes: descriptor.data.sizeBytes,
    spaceId,
    uploadId: descriptor.data.id,
  };
}

function arrayBuffersEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  return leftBytes.every((byte, index) => byte === rightBytes[index]);
}
