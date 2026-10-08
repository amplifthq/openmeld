import {
  copyFileRootRevisionBodySchema,
  copyFileRootRevisionResponseSchema,
  copyFileRootToSpaceBodySchema,
  copyOwnMessageExcerptBodySchema,
  fileRootEntryResponseSchema,
  fileRootFileResponseSchema,
  fileRootFolderResponseSchema,
  fileRootUploadResponseSchema,
  getSpaceFileResponseSchema,
  listFileRootResponseSchema,
  listFileRootRevisionsResponseSchema,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceFileMimeTypeSchema,
  spaceFileUploadIdForMutation,
  trashSpaceFileEntryResponseSchema,
} from "@openmeld/schemas";
import type {
  CopyFileRootRevisionBody,
  CopyFileRootRevisionResponse,
  CopyFileRootToSpaceBody,
  CopyOwnMessageExcerptBody,
  FileRootEntry,
  FileRootFileDescriptor,
  FileRootFolderDescriptor,
  ListFileRootResponse,
  SpaceFileDescriptor,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { readApiClientTextResponse } from "../errors";
import { uploadMultipart } from "./multipart-upload";

export type FileRootLocation = "team" | "my";

function rootPath(location: FileRootLocation): string {
  return `/v1/organizations/current/files/${location}`;
}

function contentPath(location: FileRootLocation, fileId: string): string {
  return `${rootPath(location)}/${encodeURIComponent(fileId)}/content`;
}

export function createFileRootApi(client: OpenMeldApiClientFoundation) {
  return {
    async copyOwnMessageExcerpt(input: {
      spaceId: string;
      body: CopyOwnMessageExcerptBody;
    }): Promise<SpaceFileDescriptor> {
      const response = await client.requestJson({
        url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/files/excerpts`,
        operation: "files.copy_own_message_excerpt",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(copyOwnMessageExcerptBodySchema.parse(input.body)),
        schema: getSpaceFileResponseSchema,
        invalidMessage: "Invalid excerpt copy response.",
      });
      return response.file;
    },
    async copyToSpace(input: {
      spaceId: string;
      body: CopyFileRootToSpaceBody;
    }): Promise<SpaceFileDescriptor> {
      const response = await client.requestJson({
        url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/files/copies`,
        operation: "files.copy_to_space",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(copyFileRootToSpaceBodySchema.parse(input.body)),
        schema: getSpaceFileResponseSchema,
        invalidMessage: "Invalid Space file copy response.",
      });
      return response.file;
    },
    async copyRevision(input: {
      location: FileRootLocation;
      body: CopyFileRootRevisionBody;
    }): Promise<CopyFileRootRevisionResponse> {
      const response = await client.requestJson({
        url: `${rootPath(input.location)}/copies`,
        operation: "files.copy",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(copyFileRootRevisionBodySchema.parse(input.body)),
        schema: copyFileRootRevisionResponseSchema,
        invalidMessage: "Invalid file copy response.",
      });
      if (
        response.file.root.kind !==
        (input.location === "my" ? "member" : "team")
      ) {
        throw new Error("Files returned a copy in a different location.");
      }
      return response;
    },
    async list(input: {
      location: FileRootLocation;
      parentId?: string | null;
      view?: "active" | "trash";
      signal?: AbortSignal;
    }): Promise<ListFileRootResponse> {
      const params = new URLSearchParams();
      if (input.parentId) {
        params.set("parentId", input.parentId);
      }
      if (input.view) {
        params.set("view", input.view);
      }
      const query = params.size > 0 ? `?${params}` : "";
      const response = await client.requestJson({
        url: `${rootPath(input.location)}${query}`,
        operation: "files.list",
        signal: input.signal,
        schema: listFileRootResponseSchema,
        invalidMessage: "Invalid Files list response.",
      });
      if (
        response.root.kind !== (input.location === "my" ? "member" : "team") ||
        response.view !== (input.view ?? "active")
      ) {
        throw new Error("Files returned a different location or view.");
      }
      return response;
    },
    async createFolder(input: {
      location: FileRootLocation;
      name: string;
      parentId?: string | null;
      clientMutationId: string;
    }): Promise<FileRootFolderDescriptor> {
      const response = await client.requestJson({
        url: `${rootPath(input.location)}/folders`,
        operation: "files.folder.create",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          parentId: input.parentId ?? null,
          clientMutationId: input.clientMutationId,
        }),
        schema: fileRootFolderResponseSchema,
        invalidMessage: "Invalid folder response.",
      });
      return response.folder;
    },
    async updateEntry(input: {
      location: FileRootLocation;
      entryId: string;
      name?: string;
      parentId?: string | null;
      clientMutationId: string;
    }): Promise<FileRootEntry> {
      const response = await client.requestJson({
        url: `${rootPath(input.location)}/${encodeURIComponent(input.entryId)}`,
        operation: "files.entry.update",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          clientMutationId: input.clientMutationId,
        }),
        schema: fileRootEntryResponseSchema,
        invalidMessage: "Invalid file update response.",
      });
      return response.entry;
    },
    async getFile(input: {
      location: FileRootLocation;
      fileId: string;
    }): Promise<FileRootFileDescriptor> {
      const response = await client.requestJson({
        url: `${rootPath(input.location)}/${encodeURIComponent(input.fileId)}`,
        operation: "files.get",
        schema: fileRootFileResponseSchema,
        invalidMessage: "Invalid file response.",
      });
      return response.file;
    },
    async listRevisions(input: { location: FileRootLocation; fileId: string }) {
      return await client.requestJson({
        url: `${rootPath(input.location)}/${encodeURIComponent(input.fileId)}/revisions`,
        operation: "files.revisions.list",
        schema: listFileRootRevisionsResponseSchema,
        invalidMessage: "Invalid file revision history response.",
      });
    },
    async trash(input: {
      location: FileRootLocation;
      entryId: string;
      clientMutationId: string;
    }): Promise<void> {
      await client.requestJson({
        url: `${rootPath(input.location)}/${encodeURIComponent(input.entryId)}`,
        operation: "files.entry.trash",
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientMutationId: input.clientMutationId }),
        schema: trashSpaceFileEntryResponseSchema,
        invalidMessage: "Invalid Trash response.",
      });
    },
    async restore(input: {
      location: FileRootLocation;
      entryId: string;
      clientMutationId: string;
    }): Promise<FileRootEntry> {
      const response = await client.requestJson({
        url: `${rootPath(input.location)}/${encodeURIComponent(input.entryId)}/restore`,
        operation: "files.entry.restore",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientMutationId: input.clientMutationId }),
        schema: fileRootEntryResponseSchema,
        invalidMessage: "Invalid file restore response.",
      });
      return response.entry;
    },
    async upload(input: {
      location: FileRootLocation;
      bytes: Blob | ArrayBuffer;
      mimeType: string;
      name: string;
      parentId?: string | null;
      clientMutationId: string;
      onProgress?: (uploadedBytes: number, totalBytes: number) => void;
      signal?: AbortSignal;
    }): Promise<FileRootFileDescriptor> {
      const size =
        input.bytes instanceof Blob ? input.bytes.size : input.bytes.byteLength;
      if (size > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
        const response = await uploadMultipart({
          bytes: input.bytes,
          mimeType: spaceFileMimeTypeSchema.parse(input.mimeType),
          target: {
            kind: "file",
            clientMutationId: input.clientMutationId,
            name: input.name,
            parentId: input.parentId ?? null,
          },
          signal: input.signal,
          onProgress: input.onProgress,
          request: (command, part) =>
            multipartRequest(
              client,
              input.location,
              input.clientMutationId,
              command,
              part,
              input.signal
            ),
        });
        if (!response.file) {
          throw new Error("The upload did not return a file.");
        }
        return response.file;
      }
      const mimeType = spaceFileMimeTypeSchema.parse(input.mimeType);
      const params = new URLSearchParams({
        name: input.name,
        clientMutationId: input.clientMutationId,
      });
      if (input.parentId) {
        params.set("parentId", input.parentId);
      }
      const response = await client.requestJson({
        url: `${rootPath(input.location)}?${params}`,
        operation: "files.upload",
        method: "POST",
        headers: { "content-type": mimeType },
        body: input.bytes,
        schema: fileRootFileResponseSchema,
        invalidMessage: "Invalid file upload response.",
      });
      return response.file;
    },
    async updateContent(input: {
      location: FileRootLocation;
      fileId: string;
      bytes: Blob | ArrayBuffer;
      mimeType: string;
      baseRevision: number;
      clientMutationId: string;
      onProgress?: (uploadedBytes: number, totalBytes: number) => void;
      signal?: AbortSignal;
    }): Promise<FileRootFileDescriptor> {
      const size =
        input.bytes instanceof Blob ? input.bytes.size : input.bytes.byteLength;
      if (size > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
        const response = await uploadMultipart({
          bytes: input.bytes,
          mimeType: spaceFileMimeTypeSchema.parse(input.mimeType),
          target: {
            kind: "revision",
            clientMutationId: input.clientMutationId,
            fileId: input.fileId,
            baseRevision: input.baseRevision,
          },
          signal: input.signal,
          onProgress: input.onProgress,
          request: (command, part) =>
            multipartRequest(
              client,
              input.location,
              input.clientMutationId,
              command,
              part,
              input.signal
            ),
        });
        if (!response.file) {
          throw new Error("The upload did not return a file.");
        }
        return response.file;
      }
      const query = new URLSearchParams({
        baseRevision: String(input.baseRevision),
        clientMutationId: input.clientMutationId,
      });
      const response = await client.requestJson({
        url: `${contentPath(input.location, input.fileId)}?${query}`,
        operation: "files.content.update",
        method: "PUT",
        headers: {
          "content-type": spaceFileMimeTypeSchema.parse(input.mimeType),
        },
        body: input.bytes,
        schema: fileRootFileResponseSchema,
        invalidMessage: "Invalid file revision response.",
      });
      return response.file;
    },
    streamContent: async (input: {
      location: FileRootLocation;
      fileId: string;
      revision?: number;
    }): Promise<{
      bytes: ReadableStream<Uint8Array>;
      mimeType: string;
      revision: number;
      sizeBytes: number;
    }> => await streamRootContent(client, input),
    async download(input: {
      location: FileRootLocation;
      fileId: string;
      revision?: number;
    }): Promise<{ bytes: ArrayBuffer; mimeType: string; revision: number }> {
      const content = await streamRootContent(client, input);
      return {
        bytes: await new Response(content.bytes).arrayBuffer(),
        mimeType: content.mimeType,
        revision: content.revision,
      };
    },
  };
}

async function streamRootContent(
  client: OpenMeldApiClientFoundation,
  input: { location: FileRootLocation; fileId: string; revision?: number }
): Promise<{
  bytes: ReadableStream<Uint8Array>;
  mimeType: string;
  revision: number;
  sizeBytes: number;
}> {
  const query = input.revision ? `?revision=${input.revision}` : "";
  const response = await client.requestResponse({
    url: `${contentPath(input.location, input.fileId)}${query}`,
    operation: "files.content.download",
  });
  if (!response.ok) {
    await readApiClientTextResponse({ response });
    throw new Error("File download failed.");
  }
  const revision = Number(response.headers.get("x-openmeld-file-revision"));
  if (!(Number.isInteger(revision) && revision > 0)) {
    throw new Error("Invalid file revision response.");
  }
  const declaredSize = response.headers.get("content-length");
  const sizeBytes = Number(declaredSize);
  if (
    declaredSize === null ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    !response.body
  ) {
    throw new Error("Invalid file content response.");
  }
  return {
    bytes: response.body,
    mimeType: spaceFileMimeTypeSchema.parse(
      response.headers.get("content-type") ?? "application/octet-stream"
    ),
    revision,
    sizeBytes,
  };
}

async function multipartRequest(
  client: OpenMeldApiClientFoundation,
  location: FileRootLocation,
  clientMutationId: string,
  command: import("@openmeld/schemas/types").SpaceFileUploadCommand,
  part?: Blob,
  signal?: AbortSignal
) {
  const uploadId = await spaceFileUploadIdForMutation(clientMutationId);
  const url = `${rootPath(location)}/file-uploads/${encodeURIComponent(uploadId)}`;
  return await client.requestJson({
    url: command.action === "part" ? `${url}?part=${command.partNumber}` : url,
    operation: "files.upload.multipart",
    signal,
    method: "POST",
    headers: {
      "content-type": part ? "application/octet-stream" : "application/json",
    },
    body: part ?? JSON.stringify(command),
    schema: fileRootUploadResponseSchema,
    invalidMessage: "Invalid file upload response.",
  });
}
