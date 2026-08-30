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
  spaceFileMimeTypeSchema,
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

export type SpaceFileContent = {
  bytes: ArrayBuffer;
  mimeType: string;
  revision: number;
};

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
  }
): Promise<SpaceFileDescriptor> {
  const body = toRequestBody(input.bytes);
  validateSize(body);
  const mimeType = parseMimeType(input.mimeType);
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
  }
): Promise<SpaceComposerUploadDescriptor> {
  const body = toRequestBody(input.bytes);
  validateSize(body);
  const mimeType = parseMimeType(input.mimeType);
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
  return {
    bytes: await response.arrayBuffer(),
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
    throw new Error("Space files must be 10 MiB or smaller");
  }
}
