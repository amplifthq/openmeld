import { readFile } from "node:fs/promises";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
  detectSpaceAttachmentMimeType,
  projectSpaceMessageAttachment,
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
  spaceAttachmentFileNameSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceAttachmentMimeType,
  SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import type { SpaceApi } from "./cli-space-api";

type PreparedSpaceAttachment = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: SpaceAttachmentMimeType;
};

export class SpaceAttachmentCommandError extends Error {
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
    this.name = "SpaceAttachmentCommandError";
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

export async function prepareRequestedSpaceSendAttachments(input: {
  attachmentPaths: readonly string[];
  replyToSignalId?: string;
}): Promise<readonly PreparedSpaceAttachment[]> {
  if (
    input.attachmentPaths.length > 0 &&
    String(input.replyToSignalId ?? "").trim()
  ) {
    throw new SpaceAttachmentCommandError({
      code: "space.attachment.thread_reply_not_supported",
      message:
        "Attachments are not supported in Space thread replies yet. The message was not sent.",
    });
  }
  if (input.attachmentPaths.length > SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE) {
    throw new SpaceAttachmentCommandError({
      code: "space.attachment.too_many",
      message: `A Space message can include at most ${SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE} attachments. The message was not sent.`,
    });
  }

  const prepared: PreparedSpaceAttachment[] = [];
  for (const rawPath of input.attachmentPaths) {
    if (!rawPath.trim()) {
      throw new SpaceAttachmentCommandError({
        code: "space.attachment.invalid_path",
        message: "Attachment paths cannot be empty. The message was not sent.",
      });
    }
    prepared.push(await prepareSpaceSendAttachment(rawPath));
  }
  return prepared;
}

export async function uploadPreparedSpaceAttachments(input: {
  attachments: readonly PreparedSpaceAttachment[];
  password?: string;
  requestContext: OpenMeldRequestContext;
  spaceApi: SpaceApi;
  spaceId: string;
}): Promise<readonly SpaceMessageAttachment[]> {
  const uploaded: SpaceMessageAttachment[] = [];
  for (const attachment of input.attachments) {
    try {
      const descriptor = await input.spaceApi.uploadAttachment({
        bytes: attachment.bytes,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        requestContext: input.requestContext,
        spaceId: input.spaceId,
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
      });
      uploaded.push(projectSpaceMessageAttachment(descriptor));
    } catch (error) {
      const failure = toStructuredApiClientFailure(error);
      throw new SpaceAttachmentCommandError({
        code: failure.code ?? "space.attachment.upload_failed",
        message: `Could not upload attachment "${attachment.fileName}". The Space message was not sent. ${failure.message}`,
        cause: error,
        requestId: failure.requestId,
        status: failure.status,
        upstreamCode: failure.upstreamCode,
      });
    }
  }
  return uploaded;
}

async function prepareSpaceSendAttachment(
  sourcePath: string
): Promise<PreparedSpaceAttachment> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(sourcePath);
  } catch (error) {
    const code = readNodeErrorCode(error);
    if (code === "ENOENT") {
      throw new SpaceAttachmentCommandError({
        code: "space.attachment.file_not_found",
        message: `Attachment file not found: ${sourcePath}. The message was not sent.`,
        cause: error,
      });
    }
    throw new SpaceAttachmentCommandError({
      code: "space.attachment.file_unreadable",
      message: `Could not read attachment file: ${sourcePath}. The message was not sent.`,
      cause: error,
    });
  }

  if (bytes.byteLength === 0) {
    throw new SpaceAttachmentCommandError({
      code: "space.attachment.empty_file",
      message: `Attachment file is empty: ${sourcePath}. The message was not sent.`,
    });
  }
  if (bytes.byteLength > SPACE_ATTACHMENT_MAX_SIZE_BYTES) {
    throw new SpaceAttachmentCommandError({
      code: "space.attachment.too_large",
      message: `Attachment exceeds the ${formatAttachmentSizeLimit()} limit: ${sourcePath}. The message was not sent.`,
    });
  }

  const mimeType = detectSpaceAttachmentMimeType(bytes);
  if (!mimeType) {
    throw new SpaceAttachmentCommandError({
      code: "space.attachment.unsupported_type",
      message: `Only JPEG and PNG attachments are supported: ${sourcePath}. The message was not sent.`,
    });
  }

  const fileNameResult = spaceAttachmentFileNameSchema.safeParse(sourcePath);
  if (!fileNameResult.success) {
    throw new SpaceAttachmentCommandError({
      code: "space.attachment.invalid_file_name",
      message: `Attachment file name is invalid: ${sourcePath}. The message was not sent.`,
    });
  }

  return {
    bytes,
    fileName: fileNameResult.data,
    mimeType,
  };
}

function readNodeErrorCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

function formatAttachmentSizeLimit(): string {
  return `${SPACE_ATTACHMENT_MAX_SIZE_BYTES / (1024 * 1024)} MiB`;
}
