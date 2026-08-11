import {
  spaceAttachmentMimeTypeSchema,
  spaceAttachmentSizeBytesSchema,
  spaceAttachmentUploadQuerySchema,
  uploadSpaceAttachmentResponseSchema,
} from "@openmeld/schemas";
import type {
  SpaceAttachmentDescriptor,
  SpaceAttachmentMimeType,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildSpaceAttachmentsPath,
  buildSpaceAttachmentUploadPath,
} from "./routes";
import type { SpaceRequestInput } from "./types";

export type SpaceAttachmentUploadBytes = ArrayBuffer | Blob | Uint8Array;

export type UploadSpaceAttachmentInput = SpaceRequestInput & {
  bytes: SpaceAttachmentUploadBytes;
  mimeType: SpaceAttachmentMimeType;
  fileName?: string;
  width?: number;
  height?: number;
};

export async function uploadSpaceAttachment(
  client: OpenMeldApiClientFoundation,
  input: UploadSpaceAttachmentInput
): Promise<SpaceAttachmentDescriptor> {
  const mimeType = parseMimeType(input.mimeType);
  const body = toRequestBody(input.bytes);
  validateAttachmentSize(readRequestBodySize(body));
  const query = parseUploadQuery(input);
  const response = await client.requestJson({
    url: buildSpaceAttachmentUploadPath(input.spaceId, query),
    operation: "space.attachment.upload",
    method: "POST",
    headers: {
      "content-type": mimeType,
    },
    body,
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: uploadSpaceAttachmentResponseSchema,
    invalidMessage: "invalid Space attachment upload response",
  });
  return response.attachment;
}

export function buildSpaceAttachmentDownloadPath(
  spaceId: string,
  attachmentId: string
): string {
  return `${buildSpaceAttachmentsPath(spaceId)}/${encodeURIComponent(attachmentId)}`;
}

function parseMimeType(value: unknown): SpaceAttachmentMimeType {
  const parsed = spaceAttachmentMimeTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid Space attachment MIME type");
  }
  return parsed.data;
}

function validateAttachmentSize(sizeBytes: number): void {
  if (!spaceAttachmentSizeBytesSchema.safeParse(sizeBytes).success) {
    throw new Error("invalid Space attachment size");
  }
}

function parseUploadQuery(input: {
  fileName?: string;
  width?: number;
  height?: number;
}) {
  const parsed = spaceAttachmentUploadQuerySchema.safeParse({
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
    ...(input.width === undefined ? {} : { width: String(input.width) }),
    ...(input.height === undefined ? {} : { height: String(input.height) }),
  });
  if (!parsed.success) {
    throw new Error("invalid Space attachment upload metadata");
  }
  return parsed.data;
}

function toRequestBody(bytes: SpaceAttachmentUploadBytes): ArrayBuffer | Blob {
  if (bytes instanceof Blob || bytes instanceof ArrayBuffer) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function readRequestBodySize(body: ArrayBuffer | Blob): number {
  return body instanceof Blob ? body.size : body.byteLength;
}
