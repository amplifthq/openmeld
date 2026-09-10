import {
  createSpaceFolderResponseSchema,
  discardSpaceComposerUploadResponseSchema,
  getSpaceFileResponseSchema,
  listSpaceFileRevisionsResponseSchema,
  listSpaceFilesResponseSchema,
  publishSpaceComposerUploadResponseSchema,
  restoreSpaceFileEntryResponseSchema,
  restoreSpaceFileRevisionResponseSchema,
  SPACE_FILE_MAX_SIZE_BYTES,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  SPACE_FILE_UPLOAD_PART_BYTES,
  spaceFileMimeTypeSchema,
  spaceFileUploadResponseSchema,
  stageSpaceComposerUploadResponseSchema,
  trashSpaceFileEntryResponseSchema,
  updateSpaceFileEntryResponseSchema,
  uploadSpaceFileResponseSchema,
} from "@openmeld/schemas";
import type {
  CreateSpaceFolderBody,
  CreateSpaceFolderResponse,
  GetSpaceFileResponse,
  ListSpaceFileRevisionsResponse,
  ListSpaceFilesQuery,
  ListSpaceFilesResponse,
  SpaceComposerUploadDescriptor,
  SpaceFileDescriptor,
  SpaceFileEntry,
  TrashSpaceFileEntryResponse,
  UpdateSpaceFileEntryBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  OpenMeldApiClientInvalidResponseError,
  readApiClientTextResponse,
} from "../errors";
import {
  buildSpaceComposerUploadPath,
  buildSpaceComposerUploadPublishPath,
  buildSpaceFileContentPath,
  buildSpaceFileEntryPath,
  buildSpaceFileFoldersPath,
  buildSpaceFileRestorePath,
  buildSpaceFileRevisionRestorePath,
  buildSpaceFileRevisionsPath,
  buildSpaceFilesPath,
  buildSpaceFileUploadPath,
} from "./routes";
import type { SpaceRequestInput } from "./types";

export type SpaceFileContentBytes = ArrayBuffer | Blob | Uint8Array;
type UploadProgress = {
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
};

export type SpaceFileContent = {
  bytes: ArrayBuffer;
  mimeType: string;
  revision: number;
};

function bodySize(body: ArrayBuffer | Blob): number {
  return body instanceof Blob ? body.size : body.byteLength;
}

async function mutationUploadId(mutation: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(mutation)
  );
  const hex = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function uploadMultipart(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput &
    UploadProgress & { bytes: SpaceFileContentBytes; mimeType: string },
  target: import("@openmeld/schemas/types").SpaceFileUploadMetadata["target"],
  uploadId: string
) {
  const body = toRequestBody(input.bytes);
  const blob = body instanceof Blob ? body : new Blob([body]);
  const url = `/v1/spaces/${encodeURIComponent(input.spaceId)}/file-uploads/${uploadId}`;
  const request = async (
    command: import("@openmeld/schemas/types").SpaceFileUploadCommand,
    part?: Blob
  ) => {
    return await retryUploadRequest(input.signal, () =>
      client.requestJson({
        ...requestFields(input),
        url:
          command.action === "part" ? `${url}?part=${command.partNumber}` : url,
        method: "POST",
        operation: "space.files.upload",
        headers: {
          "content-type": part
            ? "application/octet-stream"
            : "application/json",
        },
        body: part ?? JSON.stringify(command),
        schema: spaceFileUploadResponseSchema,
        invalidMessage: "Invalid file upload response.",
      })
    );
  };
  const partDigests: string[] = [];
  for (
    let offset = 0;
    offset < blob.size;
    offset += SPACE_FILE_UPLOAD_PART_BYTES
  ) {
    input.signal?.throwIfAborted();
    const hash = await crypto.subtle.digest(
      "SHA-256",
      await blob
        .slice(offset, offset + SPACE_FILE_UPLOAD_PART_BYTES)
        .arrayBuffer()
    );
    partDigests.push(
      Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("")
    );
  }
  let session = await request({
    action: "start",
    metadata: {
      target,
      mimeType: input.mimeType,
      sizeBytes: blob.size,
      partDigests,
    },
  });
  if (session.file || session.upload) {
    return session;
  }
  input.onProgress?.(
    session.parts.reduce((n, p) => n + p.sizeBytes, 0),
    blob.size
  );
  for (
    let start = 0, number = 1;
    start < blob.size;
    start += session.partSizeBytes, number++
  ) {
    if (session.parts.some((p) => p.partNumber === number)) {
      continue;
    }
    session = await request(
      { action: "part", partNumber: number },
      blob.slice(start, start + session.partSizeBytes)
    );
    input.onProgress?.(
      session.parts.reduce((n, p) => n + p.sizeBytes, 0),
      blob.size
    );
  }
  return await request({ action: "complete" });
}

async function retryUploadRequest<T>(
  signal: AbortSignal | undefined,
  request: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      signal?.throwIfAborted();
      return await request();
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? error.status
          : undefined;
      if (
        signal?.aborted ||
        attempt >= 2 ||
        (typeof status === "number" && status < 500 && status !== 429)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

export async function listSpaceFiles(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { query?: ListSpaceFilesQuery }
): Promise<ListSpaceFilesResponse> {
  const response = await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFilesPath(input.spaceId, input.query),
    operation: "space.files.list",
    schema: listSpaceFilesResponseSchema,
    invalidMessage: "invalid Space Files list response",
  });
  const requestedView = input.query?.view ?? "active";
  if (response.view !== requestedView) {
    throw new OpenMeldApiClientInvalidResponseError({
      message: `Space Files returned the ${response.view} view while the ${requestedView} view was requested.`,
      operation: "space.files.list",
      status: 200,
      rawBody: JSON.stringify(response),
      schemaIssue: {
        message: "The response view did not match the requested view.",
        path: ["view"],
      },
    });
  }
  return response;
}

export async function getSpaceFile(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { fileId: string }
): Promise<GetSpaceFileResponse> {
  return await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileEntryPath(input.spaceId, input.fileId),
    operation: "space.files.get",
    schema: getSpaceFileResponseSchema,
    invalidMessage: "invalid Space file response",
  });
}

export async function listSpaceFileRevisions(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { fileId: string }
): Promise<ListSpaceFileRevisionsResponse> {
  return await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileRevisionsPath(input.spaceId, input.fileId),
    operation: "space.files.revisions.list",
    schema: listSpaceFileRevisionsResponseSchema,
    invalidMessage: "invalid Space file revisions response",
  });
}

export async function createSpaceFolder(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { body: CreateSpaceFolderBody }
): Promise<CreateSpaceFolderResponse> {
  return await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileFoldersPath(input.spaceId),
    operation: "space.files.folder.create",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
    schema: createSpaceFolderResponseSchema,
    invalidMessage: "invalid Space folder create response",
  });
}

export async function updateSpaceFileEntry(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    body: UpdateSpaceFileEntryBody;
    entryId: string;
  }
): Promise<SpaceFileEntry> {
  const response = await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileEntryPath(input.spaceId, input.entryId),
    operation: "space.files.entry.update",
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
    schema: updateSpaceFileEntryResponseSchema,
    invalidMessage: "invalid Space file update response",
  });
  return response.entry;
}

export async function trashSpaceFileEntry(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    clientMutationId: string;
    entryId: string;
  }
): Promise<TrashSpaceFileEntryResponse> {
  return await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileEntryPath(input.spaceId, input.entryId),
    operation: "space.files.entry.trash",
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientMutationId: input.clientMutationId }),
    schema: trashSpaceFileEntryResponseSchema,
    invalidMessage: "invalid Space file trash response",
  });
}

export async function restoreSpaceFileEntry(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    clientMutationId: string;
    entryId: string;
  }
): Promise<SpaceFileEntry> {
  const response = await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileRestorePath(input.spaceId, input.entryId),
    operation: "space.files.entry.restore",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientMutationId: input.clientMutationId }),
    schema: restoreSpaceFileEntryResponseSchema,
    invalidMessage: "invalid Space file restore response",
  });
  return response.entry;
}

export async function restoreSpaceFileRevision(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    baseRevision: number;
    clientMutationId: string;
    fileId: string;
    revision: number;
  }
): Promise<SpaceFileDescriptor> {
  const response = await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileRevisionRestorePath(
      input.spaceId,
      input.fileId,
      input.revision
    ),
    operation: "space.files.revision.restore",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseRevision: input.baseRevision,
      clientMutationId: input.clientMutationId,
    }),
    schema: restoreSpaceFileRevisionResponseSchema,
    invalidMessage: "invalid Space file revision restore response",
  });
  return response.file;
}

export async function uploadSpaceFile(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    bytes: SpaceFileContentBytes;
    clientMutationId: string;
    mimeType: string;
    name: string;
    parentId?: string | null;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }
): Promise<SpaceFileDescriptor> {
  const body = toRequestBody(input.bytes);
  validateSize(body);
  const mimeType = parseMimeType(input.mimeType);
  if (bodySize(body) > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
    const response = await uploadMultipart(
      client,
      input,
      {
        kind: "file",
        clientMutationId: input.clientMutationId,
        name: input.name,
        parentId: input.parentId ?? null,
      },
      await mutationUploadId(input.clientMutationId)
    );
    if (!response.file) {
      throw new Error("The upload did not return a file.");
    }
    return response.file;
  }
  const response = await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileUploadPath(input),
    operation: "space.files.upload",
    method: "POST",
    headers: { "content-type": mimeType },
    body,
    schema: uploadSpaceFileResponseSchema,
    invalidMessage: "invalid Space file upload response",
  });
  return response.file;
}

export async function stageSpaceComposerUpload(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    bytes: SpaceFileContentBytes;
    mimeType: string;
    name: string;
    uploadId: string;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }
): Promise<SpaceComposerUploadDescriptor> {
  const body = toRequestBody(input.bytes);
  validateSize(body);
  const mimeType = parseMimeType(input.mimeType);
  if (bodySize(body) > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
    const response = await uploadMultipart(
      client,
      input,
      { kind: "composer", name: input.name },
      input.uploadId
    );
    if (!response.upload) {
      throw new Error("The upload did not return a staged file.");
    }
    return response.upload;
  }
  const response = await client.requestJson({
    ...requestFields(input),
    body,
    headers: { "content-type": mimeType },
    invalidMessage: "invalid Space Composer upload response",
    method: "PUT",
    operation: "space.composer_uploads.stage",
    schema: stageSpaceComposerUploadResponseSchema,
    url: buildSpaceComposerUploadPath(input),
  });
  return response.upload;
}

export async function publishSpaceComposerUpload(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    clientMutationId: string;
    uploadId: string;
  }
): Promise<SpaceFileDescriptor> {
  const response = await client.requestJson({
    ...requestFields(input),
    body: JSON.stringify({ clientMutationId: input.clientMutationId }),
    headers: { "content-type": "application/json" },
    invalidMessage: "invalid Space Composer upload publication response",
    method: "POST",
    operation: "space.composer_uploads.publish",
    schema: publishSpaceComposerUploadResponseSchema,
    url: buildSpaceComposerUploadPublishPath(input),
  });
  return response.file;
}

export async function discardSpaceComposerUpload(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { uploadId: string }
): Promise<void> {
  await client.requestJson({
    ...requestFields(input),
    invalidMessage: "invalid Space Composer upload discard response",
    method: "DELETE",
    operation: "space.composer_uploads.discard",
    schema: discardSpaceComposerUploadResponseSchema,
    url: buildSpaceComposerUploadPath(input),
  });
}

export async function updateSpaceFileContent(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    baseRevision: number;
    bytes: SpaceFileContentBytes;
    clientMutationId: string;
    fileId: string;
    mimeType: string;
  }
): Promise<SpaceFileDescriptor> {
  const body = toRequestBody(input.bytes);
  validateSize(body);
  const mimeType = parseMimeType(input.mimeType);
  if (bodySize(body) > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
    const response = await uploadMultipart(
      client,
      input,
      {
        kind: "revision",
        clientMutationId: input.clientMutationId,
        fileId: input.fileId,
        baseRevision: input.baseRevision,
      },
      await mutationUploadId(input.clientMutationId)
    );
    if (!response.file) {
      throw new Error("The upload did not return a file.");
    }
    return response.file;
  }
  const response = await client.requestJson({
    ...requestFields(input),
    url: buildSpaceFileContentPath(input.spaceId, input.fileId, {
      baseRevision: input.baseRevision,
      clientMutationId: input.clientMutationId,
    }),
    operation: "space.files.content.update",
    method: "PUT",
    headers: { "content-type": mimeType },
    body,
    schema: uploadSpaceFileResponseSchema,
    invalidMessage: "invalid Space file content update response",
  });
  return response.file;
}

export async function downloadSpaceFileContent(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { fileId: string; revision?: number }
): Promise<SpaceFileContent> {
  const content = await streamSpaceFileContent(client, input);
  return { ...content, bytes: await new Response(content.bytes).arrayBuffer() };
}

export async function streamSpaceFileContent(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { fileId: string; revision?: number }
): Promise<
  Omit<SpaceFileContent, "bytes"> & { bytes: ReadableStream<Uint8Array> }
> {
  const response = await client.requestResponse({
    ...requestFields(input),
    url: buildSpaceFileContentPath(input.spaceId, input.fileId, {
      revision: input.revision,
    }),
    operation: "space.files.content.download",
  });
  if (!response.ok) {
    await readApiClientTextResponse({ response });
    throw new Error("Space file download failed.");
  }
  const mimeType = parseMimeType(
    response.headers.get("content-type") ?? "application/octet-stream"
  );
  const revision = Number(response.headers.get("x-openmeld-file-revision"));
  if (!(Number.isInteger(revision) && revision > 0)) {
    throw new Error("invalid Space file revision response header");
  }
  if (!response.body) {
    throw new Error("Space file download has no body.");
  }
  return {
    bytes: response.body,
    mimeType,
    revision,
  };
}

function requestFields(input: SpaceRequestInput) {
  return {
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
  };
}

function parseMimeType(value: unknown): string {
  const parsed = spaceFileMimeTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid Space file MIME type");
  }
  return parsed.data;
}

function toRequestBody(bytes: SpaceFileContentBytes): ArrayBuffer | Blob {
  if (bytes instanceof Blob || bytes instanceof ArrayBuffer) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function validateSize(body: ArrayBuffer | Blob): void {
  const size = body instanceof Blob ? body.size : body.byteLength;
  if (size > SPACE_FILE_MAX_SIZE_BYTES) {
    throw new Error("Space files must be 250 MiB or smaller");
  }
}
