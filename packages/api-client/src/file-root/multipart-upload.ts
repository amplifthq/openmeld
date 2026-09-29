import {
  SPACE_FILE_MAX_SIZE_BYTES,
  SPACE_FILE_UPLOAD_PART_BYTES,
} from "@openmeld/schemas";
import type {
  SpaceFileUploadCommand,
  SpaceFileUploadMetadata,
} from "@openmeld/schemas/types";

type UploadResponse = {
  partSizeBytes: number;
  parts: readonly { partNumber: number; sizeBytes: number }[];
  file?: unknown;
  upload?: unknown;
};

/** Shared browser transport; the owning Files root still authorizes every command. */
export async function uploadMultipart<Response extends UploadResponse>(input: {
  bytes: ArrayBuffer | Blob;
  mimeType: string;
  target: SpaceFileUploadMetadata["target"];
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  request: (command: SpaceFileUploadCommand, part?: Blob) => Promise<Response>;
}): Promise<Response> {
  const blob =
    input.bytes instanceof Blob ? input.bytes : new Blob([input.bytes]);
  if (blob.size < 1 || blob.size > SPACE_FILE_MAX_SIZE_BYTES) {
    throw new Error("This file exceeds the supported size.");
  }
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
      Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    );
  }
  const request = (command: SpaceFileUploadCommand, part?: Blob) =>
    retryUploadRequest(input.signal, () => input.request(command, part));
  let session = await request({
    action: "start",
    metadata: {
      target: input.target,
      mimeType: input.mimeType,
      sizeBytes: blob.size,
      partDigests,
    },
  });
  if (session.file || session.upload) {
    return session;
  }
  input.onProgress?.(
    session.parts.reduce((total, part) => total + part.sizeBytes, 0),
    blob.size
  );
  for (
    let start = 0, number = 1;
    start < blob.size;
    start += session.partSizeBytes, number++
  ) {
    if (session.parts.some((part) => part.partNumber === number)) {
      continue;
    }
    session = await request(
      { action: "part", partNumber: number },
      blob.slice(start, start + session.partSizeBytes)
    );
    input.onProgress?.(
      session.parts.reduce((total, part) => total + part.sizeBytes, 0),
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
