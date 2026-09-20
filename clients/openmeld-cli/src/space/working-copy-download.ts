import type { SpaceApi } from "@openmeld/api-client";
import { SPACE_FILE_RAW_UPLOAD_MAX_BYTES } from "@openmeld/schemas";

/** Bound bytes while reading, rather than allocating an oversized response first. */
export async function downloadWorkingCopyFile(
  api: SpaceApi,
  input: Parameters<SpaceApi["streamFileContent"]>[0]
) {
  const content = await api.streamFileContent({
    ...input,
    signal: AbortSignal.timeout(30_000),
  });
  const reader = content.bytes.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
        throw new Error("Handoff files must be 10 MiB or smaller.");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return {
    revision: content.revision,
    mimeType: content.mimeType,
    bytes: Buffer.concat(chunks),
  };
}
