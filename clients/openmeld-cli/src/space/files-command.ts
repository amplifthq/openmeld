import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  isSpaceFileTextEditable,
  resolveSpaceFileMimeType,
  SPACE_FILE_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type {
  ListSpaceFilesResponse,
  SpaceFileEntry,
} from "@openmeld/schemas/types";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import type { Presenter } from "../runtime/presenter";
import { outJsonLine } from "../ui/io";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  runSpaceReadWithPasswordRetry,
  runSpaceWriteWithPasswordRetry,
} from "./password-flow";

type SpaceFilesCommandInput = {
  baseUrl?: string;
  entryChecksHandled?: boolean;
  json: boolean;
  password?: string;
  profile?: string;
  space: string;
  view?: string;
};

type PreparedSpaceFilesContext = Exclude<
  Awaited<ReturnType<typeof prepareAuthenticatedSpaceCommandContext>>,
  { status: "cancelled" }
> & {
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
  spaceApi: ReturnType<typeof createCliSpaceApi>;
};

export async function runSpaceFilesList(
  input: SpaceFilesCommandInput & { folder?: string; trash?: boolean }
): Promise<void> {
  const context = await prepareSpaceFilesContext(input, "listing Space files");
  if (!context) {
    return;
  }
  const read = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.listFiles({
        spaceId: input.space,
        requestContext: context.requestContext,
        query: {
          ...(input.trash ? {} : { parentId: normalizeFolderId(input.folder) }),
          view: input.trash ? "trash" : "active",
        },
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (read.status === "cancelled") {
    return;
  }
  emitListOutput({
    presenter: context.presenter,
    result: read.result,
    json: input.json,
  });
}

export async function runSpaceFilesRead(
  input: SpaceFilesCommandInput & { fileId: string; revision?: number }
): Promise<void> {
  const context = await prepareSpaceFilesContext(input, "reading a Space file");
  if (!context) {
    return;
  }
  const read = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) => {
      const [metadata, content] = await Promise.all([
        context.spaceApi.getFile({
          spaceId: input.space,
          requestContext: context.requestContext,
          fileId: input.fileId,
          ...(spacePassword === undefined ? {} : { spacePassword }),
        }),
        context.spaceApi.downloadFileContent({
          spaceId: input.space,
          requestContext: context.requestContext,
          fileId: input.fileId,
          ...(input.revision === undefined ? {} : { revision: input.revision }),
          ...(spacePassword === undefined ? {} : { spacePassword }),
        }),
      ]);
      if (
        !isSpaceFileTextEditable({
          mimeType: content.mimeType,
          sizeBytes: content.bytes.byteLength,
        })
      ) {
        throw new Error(
          "This file is binary or too large to print. Use `openmeld space files download` instead."
        );
      }
      return {
        file: metadata.file,
        revision: content.revision,
        content: new TextDecoder("utf-8", { fatal: true }).decode(
          content.bytes
        ),
      };
    },
  });
  if (read.status === "cancelled") {
    return;
  }
  if (input.json) {
    outJsonLine(read.result);
    return;
  }
  if (context.runtime.resolvedView === "agent") {
    context.presenter.data({ code: "space.files.read", payload: read.result });
    return;
  }
  context.presenter.line({
    code: "space.files.read",
    text: read.result.content,
  });
}

export async function runSpaceFilesHistory(
  input: SpaceFilesCommandInput & { fileId: string }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "reading Space file history"
  );
  if (!context) {
    return;
  }
  const read = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.listFileRevisions({
        spaceId: input.space,
        requestContext: context.requestContext,
        fileId: input.fileId,
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (read.status === "cancelled") {
    return;
  }
  if (input.json) {
    outJsonLine(read.result);
    return;
  }
  if (context.presenter.view === "agent") {
    context.presenter.data({
      code: "space.files.history",
      payload: read.result,
    });
    return;
  }
  context.presenter.line({
    code: "space.files.history",
    text: `Version history for ${read.result.file.path}:`,
  });
  for (const revision of read.result.revisions) {
    context.presenter.line({
      code: "space.files.history.version",
      text: `Version ${revision.revision}  ${revision.createdAt}  ${revision.createdBy.displayName}  ${revision.sizeBytes} bytes`,
      data: { revision },
    });
  }
}

export async function runSpaceFilesUpload(
  input: SpaceFilesCommandInput & {
    file: string;
    folder?: string;
    mimeType?: string;
    name?: string;
  }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "uploading a Space file"
  );
  if (!context) {
    return;
  }
  const bytes = await readLocalFile(input.file);
  const write = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.uploadFile({
        spaceId: input.space,
        requestContext: context.requestContext,
        name: input.name?.trim() || basename(input.file),
        parentId: normalizeFolderId(input.folder),
        mimeType: resolveMimeType(input.mimeType, input.file),
        bytes,
        clientMutationId: randomUUID(),
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (write.status === "cancelled") {
    return;
  }
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.uploaded",
    text: `Uploaded ${write.result.path} (revision ${write.result.latestRevision.revision}).`,
    payload: { file: write.result },
    json: input.json,
  });
}

export async function runSpaceFilesWrite(
  input: SpaceFilesCommandInput & {
    baseRevision: number;
    file?: string;
    fileId: string;
    mimeType?: string;
    stdin: boolean;
  }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "updating a Space file"
  );
  if (!context) {
    return;
  }
  const bytes = await resolveContentBytes({
    file: input.file,
    stdin: input.stdin,
  });
  const write = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.updateFileContent({
        spaceId: input.space,
        requestContext: context.requestContext,
        fileId: input.fileId,
        baseRevision: input.baseRevision,
        mimeType: resolveMimeType(input.mimeType, input.file),
        bytes,
        clientMutationId: randomUUID(),
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (write.status === "cancelled") {
    return;
  }
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.updated",
    text: `Saved ${write.result.path} as revision ${write.result.latestRevision.revision}.`,
    payload: { file: write.result },
    json: input.json,
  });
}

export async function runSpaceFilesDownload(
  input: SpaceFilesCommandInput & {
    fileId: string;
    force: boolean;
    output: string;
    revision?: number;
  }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "downloading a Space file"
  );
  if (!context) {
    return;
  }
  const read = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.streamFileContent({
        spaceId: input.space,
        requestContext: context.requestContext,
        fileId: input.fileId,
        ...(input.revision === undefined ? {} : { revision: input.revision }),
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (read.status === "cancelled") {
    return;
  }
  let sizeBytes = 0;
  const chunks = async function* () {
    const reader = read.result.bytes.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        sizeBytes += chunk.value.byteLength;
        yield chunk.value;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  };
  await writeFile(input.output, chunks(), {
    flag: input.force ? "w" : "wx",
  });
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.downloaded",
    text: `Downloaded revision ${read.result.revision} to ${input.output}.`,
    payload: {
      output: input.output,
      revision: read.result.revision,
      mimeType: read.result.mimeType,
      sizeBytes,
    },
    json: input.json,
  });
}

export async function runSpaceFilesMkdir(
  input: SpaceFilesCommandInput & { folder?: string; name: string }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "creating a Space folder"
  );
  if (!context) {
    return;
  }
  const write = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.createFolder({
        spaceId: input.space,
        requestContext: context.requestContext,
        body: {
          name: input.name,
          parentId: normalizeFolderId(input.folder),
          clientMutationId: randomUUID(),
        },
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (write.status === "cancelled") {
    return;
  }
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.folder_created",
    text: `Created folder ${write.result.folder.path}.`,
    payload: write.result,
    json: input.json,
  });
}

export async function runSpaceFilesRename(
  input: SpaceFilesCommandInput & { entryId: string; name: string }
): Promise<void> {
  await runSpaceFilesEntryUpdate({ ...input, name: input.name });
}

export async function runSpaceFilesMove(
  input: SpaceFilesCommandInput & { entryId: string; folder?: string }
): Promise<void> {
  await runSpaceFilesEntryUpdate({
    ...input,
    parentId: normalizeFolderId(input.folder),
  });
}

export async function runSpaceFilesTrash(
  input: SpaceFilesCommandInput & { entryId: string }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "moving a Space file to trash"
  );
  if (!context) {
    return;
  }
  const write = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.trashFileEntry({
        spaceId: input.space,
        requestContext: context.requestContext,
        entryId: input.entryId,
        clientMutationId: randomUUID(),
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (write.status === "cancelled") {
    return;
  }
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.trashed",
    text: "Moved the item to trash.",
    payload: write.result,
    json: input.json,
  });
}

export async function runSpaceFilesRestore(
  input: SpaceFilesCommandInput & { entryId: string }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "restoring a Space file from Trash"
  );
  if (!context) {
    return;
  }
  const write = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.restoreFileEntry({
        spaceId: input.space,
        requestContext: context.requestContext,
        entryId: input.entryId,
        clientMutationId: randomUUID(),
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (write.status === "cancelled") {
    return;
  }
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.restored",
    text: `Restored ${write.result.path}.`,
    payload: { entry: write.result },
    json: input.json,
  });
}

export async function runSpaceFilesRestoreVersion(
  input: SpaceFilesCommandInput & {
    baseRevision: number;
    fileId: string;
    revision: number;
  }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "restoring a Space file version"
  );
  if (!context) {
    return;
  }
  const write = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.restoreFileRevision({
        spaceId: input.space,
        requestContext: context.requestContext,
        fileId: input.fileId,
        revision: input.revision,
        baseRevision: input.baseRevision,
        clientMutationId: randomUUID(),
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (write.status === "cancelled") {
    return;
  }
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.version_restored",
    text: `Restored version ${input.revision} as version ${write.result.latestRevision.revision}.`,
    payload: { file: write.result, restoredRevision: input.revision },
    json: input.json,
  });
}

async function runSpaceFilesEntryUpdate(
  input: SpaceFilesCommandInput & {
    entryId: string;
    name?: string;
    parentId?: string | null;
  }
): Promise<void> {
  const context = await prepareSpaceFilesContext(
    input,
    "organizing Space files"
  );
  if (!context) {
    return;
  }
  const write = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: isInteractiveHumanOutput(context, input.json),
    presenter: context.presenter,
    execute: async (spacePassword) =>
      await context.spaceApi.updateFileEntry({
        spaceId: input.space,
        requestContext: context.requestContext,
        entryId: input.entryId,
        body: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          clientMutationId: randomUUID(),
        },
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
  if (write.status === "cancelled") {
    return;
  }
  emitMutationOutput({
    presenter: context.presenter,
    code: "space.files.organized",
    text: `Updated ${write.result.path}.`,
    payload: { entry: write.result },
    json: input.json,
  });
}

async function prepareSpaceFilesContext(
  input: SpaceFilesCommandInput,
  action: string
): Promise<PreparedSpaceFilesContext | null> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(action),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return null;
  }
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: context.runtime.resolvedView,
  });
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: context.runtime.resolvedView,
    interactive: context.interactive,
  });
  return {
    ...context,
    requestContext: buildOpenMeldRequestContextFromProfile({ openMeldProfile }),
    spaceApi: createCliSpaceApi(context.baseUrl),
  };
}

function emitListOutput(input: {
  json: boolean;
  presenter: Presenter;
  result: ListSpaceFilesResponse;
}): void {
  if (input.json) {
    outJsonLine(input.result);
    return;
  }
  if (input.presenter.view === "agent") {
    input.presenter.data({ code: "space.files.list", payload: input.result });
    return;
  }
  const location = input.result.breadcrumbs
    .map((item) => item.name)
    .join(" / ");
  input.presenter.line({
    code: "space.files.location",
    text: `Files in ${location} (${input.result.capabilities.canWrite ? "can edit" : "view only"}):`,
  });
  if (input.result.entries.length === 0) {
    input.presenter.line({
      code: "space.files.empty",
      text:
        input.result.view === "trash"
          ? "Trash is empty."
          : "This folder is empty.",
    });
    return;
  }
  for (const entry of input.result.entries) {
    input.presenter.line({
      code: "space.files.entry",
      text: formatEntry(entry),
      data: { entry },
    });
  }
}

function emitMutationOutput(input: {
  code: string;
  json: boolean;
  payload: unknown;
  presenter: Presenter;
  text: string;
}): void {
  if (input.json) {
    outJsonLine(input.payload);
    return;
  }
  if (input.presenter.view === "agent") {
    input.presenter.data({ code: input.code, payload: input.payload });
    return;
  }
  input.presenter.line({ code: input.code, text: input.text });
}

function formatEntry(entry: SpaceFileEntry): string {
  if (entry.kind === "folder") {
    return `[folder] ${entry.name}  id=${entry.id}`;
  }
  return `[file] ${entry.name}  revision=${entry.latestRevision.revision}  size=${entry.latestRevision.sizeBytes}  id=${entry.id}`;
}

function normalizeFolderId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return !normalized || normalized === "root" ? null : normalized;
}

async function readLocalFile(path: string): Promise<Blob> {
  const bytes = await openAsBlob(path);
  if (bytes.size > SPACE_FILE_MAX_SIZE_BYTES) {
    throw new Error("Space files must be 250 MiB or smaller.");
  }
  return bytes;
}

async function resolveContentBytes(input: {
  file?: string;
  stdin: boolean;
}): Promise<Uint8Array | Blob> {
  const file = input.file?.trim();
  if (Boolean(file) === input.stdin) {
    throw new Error(
      "Choose exactly one content source: --file <path> or --stdin."
    );
  }
  if (file) {
    return await readLocalFile(file);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += bytes.byteLength;
    if (total > SPACE_FILE_MAX_SIZE_BYTES) {
      throw new Error("Space files must be 250 MiB or smaller.");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

export function resolveMimeType(
  explicitMimeType: string | undefined,
  path: string | undefined
): string {
  return resolveSpaceFileMimeType({
    declaredMimeType: explicitMimeType,
    fileName: path ?? "",
  });
}

function isInteractiveHumanOutput(
  context: PreparedSpaceFilesContext,
  json: boolean
): boolean {
  return (
    context.interactive && context.runtime.resolvedView === "human" && !json
  );
}
