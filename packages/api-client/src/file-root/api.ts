import {
  fileRootEntryResponseSchema,
  fileRootFileResponseSchema,
  fileRootFolderResponseSchema,
  listFileRootResponseSchema,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceFileMimeTypeSchema,
  trashSpaceFileEntryResponseSchema,
} from "@openmeld/schemas";
import type {
  FileRootEntry,
  FileRootFileDescriptor,
  FileRootFolderDescriptor,
  ListFileRootResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { readApiClientTextResponse } from "../errors";

export type FileRootLocation = "team" | "my";

function rootPath(location: FileRootLocation): string {
  return `/v1/organizations/current/files/${location}`;
}

function contentPath(location: FileRootLocation, fileId: string): string {
  return `${rootPath(location)}/${encodeURIComponent(fileId)}/content`;
}

export function createFileRootApi(client: OpenMeldApiClientFoundation) {
  return {
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
    }): Promise<FileRootFileDescriptor> {
      const size =
        input.bytes instanceof Blob ? input.bytes.size : input.bytes.byteLength;
      if (size > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
        throw new Error("This location supports files up to 10 MiB for now.");
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
    async download(input: {
      location: FileRootLocation;
      fileId: string;
      revision?: number;
    }): Promise<{ bytes: ArrayBuffer; mimeType: string; revision: number }> {
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
      return {
        bytes: await response.arrayBuffer(),
        mimeType: spaceFileMimeTypeSchema.parse(
          response.headers.get("content-type") ?? "application/octet-stream"
        ),
        revision,
      };
    },
  };
}
