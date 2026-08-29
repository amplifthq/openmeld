import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  type StructuredApiClientFailure,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
  resolveSpaceFileMimeType,
  SPACE_FILE_MAX_SIZE_BYTES,
  SPACE_MESSAGE_FILE_MAX_COUNT,
  spaceFileNameSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceMessageFileReference,
} from "@openmeld/schemas/types";
import type { SpaceApi } from "./cli-space-api";

type PreparedSpaceFile = {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
};

type SpaceFileCleanupFailure = {
  failure: StructuredApiClientFailure;
  fileId: string;
};

export class SpaceSendFileError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status?: number;
  readonly upstreamCode?: string;

  constructor(input: {
    code: string;
    message: string;
    cause?: unknown;
    requestId?: string | null;
    status?: number | null;
    upstreamCode?: string | null;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "SpaceSendFileError";
    this.code = input.code;
    if (input.requestId) {
      this.requestId = input.requestId;
    }
    if (input.status !== null && input.status !== undefined) {
      this.status = input.status;
    }
    if (input.upstreamCode) {
      this.upstreamCode = input.upstreamCode;
    }
  }
}

export async function prepareRequestedSpaceSendFiles(input: {
  filePaths: readonly string[];
}): Promise<readonly PreparedSpaceFile[]> {
  if (input.filePaths.length > SPACE_MESSAGE_FILE_MAX_COUNT) {
    throw new SpaceSendFileError({
      code: "space.file.too_many",
      message: `A Space message can include at most ${SPACE_MESSAGE_FILE_MAX_COUNT} files. The message was not sent.`,
    });
  }

  const prepared: PreparedSpaceFile[] = [];
  for (const rawPath of input.filePaths) {
    if (!rawPath.trim()) {
      throw new SpaceSendFileError({
        code: "space.file.invalid_path",
        message: "File paths cannot be empty. The message was not sent.",
      });
    }
    prepared.push(await prepareSpaceSendFile(rawPath));
  }
  return prepared;
}

export async function uploadPreparedSpaceFiles(input: {
  files: readonly PreparedSpaceFile[];
  password?: string;
  requestContext: OpenMeldRequestContext;
  spaceApi: SpaceApi;
  spaceId: string;
}): Promise<readonly SpaceMessageFileReference[]> {
  const uploaded: SpaceMessageFileReference[] = [];
  for (const file of input.files) {
    try {
      const descriptor = await input.spaceApi.uploadFile({
        bytes: file.bytes,
        clientMutationId: crypto.randomUUID(),
        mimeType: file.mimeType,
        name: file.name,
        parentId: null,
        requestContext: input.requestContext,
        spaceId: input.spaceId,
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
      });
      uploaded.push({
        fileId: descriptor.id,
        revision: descriptor.latestRevision.revision,
        name: descriptor.name,
        mimeType: descriptor.latestRevision.mimeType,
        sizeBytes: descriptor.latestRevision.sizeBytes,
      });
    } catch (error) {
      const failure = toStructuredApiClientFailure(error);
      const cleanupFailures = await moveUploadedFilesToTrash({
        files: uploaded,
        password: input.password,
        requestContext: input.requestContext,
        spaceApi: input.spaceApi,
        spaceId: input.spaceId,
      });
      let cleanupMessage = "";
      if (uploaded.length > 0) {
        cleanupMessage =
          cleanupFailures.length === 0
            ? " Files added earlier in this send were moved to Trash."
            : ` ${formatCleanupFailures({
                failures: cleanupFailures,
                passwordProtected: input.password !== undefined,
                profileId: input.requestContext.actorContext.openMeldProfileId,
                spaceId: input.spaceId,
              })}`;
      }
      throw new SpaceSendFileError({
        code: failure.code ?? "space.file.upload_failed",
        message: `Could not add file "${file.name}" to this Space. The message was not sent. ${failure.message}${cleanupMessage}`,
        cause: error,
        requestId: failure.requestId,
        status: failure.status,
        upstreamCode: failure.upstreamCode,
      });
    }
  }
  return uploaded;
}

async function moveUploadedFilesToTrash(input: {
  files: readonly SpaceMessageFileReference[];
  password?: string;
  requestContext: OpenMeldRequestContext;
  spaceApi: SpaceApi;
  spaceId: string;
}): Promise<readonly SpaceFileCleanupFailure[]> {
  const failures: SpaceFileCleanupFailure[] = [];
  for (const file of input.files) {
    try {
      await input.spaceApi.trashFileEntry({
        clientMutationId: crypto.randomUUID(),
        entryId: file.fileId,
        requestContext: input.requestContext,
        spaceId: input.spaceId,
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
      });
    } catch (error) {
      failures.push({
        failure: toStructuredApiClientFailure(error),
        fileId: file.fileId,
      });
    }
  }
  return failures;
}

function formatCleanupFailures(input: {
  failures: readonly SpaceFileCleanupFailure[];
  passwordProtected: boolean;
  profileId: string;
  spaceId: string;
}): string {
  const failureMessages = input.failures
    .map(({ failure, fileId }) => {
      const evidence = [
        failure.code ? `code ${failure.code}` : null,
        failure.requestId ? `request ${failure.requestId}` : null,
      ]
        .filter((value): value is string => value !== null)
        .join(", ");
      const evidenceText = evidence ? ` (${evidence})` : "";
      return `Could not move file ${fileId} to Trash${evidenceText}: ${failure.message} Run \`openmeld space files trash ${input.spaceId} ${fileId} --profile ${input.profileId}\` to finish cleanup.`;
    })
    .join(" ");
  const passwordGuidance = input.passwordProtected
    ? " This Space is password protected. Add `--password` with the same Space password you used for this send; OpenMeld does not include the password in this message."
    : "";
  return `${failureMessages}${passwordGuidance}`;
}

async function prepareSpaceSendFile(
  sourcePath: string
): Promise<PreparedSpaceFile> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(sourcePath);
  } catch (error) {
    const code = readNodeErrorCode(error);
    if (code === "ENOENT") {
      throw new SpaceSendFileError({
        code: "space.file.file_not_found",
        message: `File not found: ${sourcePath}. The message was not sent.`,
        cause: error,
      });
    }
    throw new SpaceSendFileError({
      code: "space.file.file_unreadable",
      message: `Could not read file: ${sourcePath}. The message was not sent.`,
      cause: error,
    });
  }

  if (bytes.byteLength > SPACE_FILE_MAX_SIZE_BYTES) {
    throw new SpaceSendFileError({
      code: "space.file.too_large",
      message: `File exceeds the ${formatFileSizeLimit()} limit: ${sourcePath}. The message was not sent.`,
    });
  }

  const parsedName = spaceFileNameSchema.safeParse(basename(sourcePath));
  if (!parsedName.success) {
    throw new SpaceSendFileError({
      code: "space.file.invalid_file_name",
      message: `File name is invalid: ${sourcePath}. The message was not sent.`,
    });
  }

  return {
    bytes,
    name: parsedName.data,
    mimeType: resolveSpaceFileMimeType({ fileName: parsedName.data }),
  };
}

function readNodeErrorCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

function formatFileSizeLimit(): string {
  return `${SPACE_FILE_MAX_SIZE_BYTES / (1024 * 1024)} MiB`;
}
