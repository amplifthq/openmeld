import { createHash } from "node:crypto";

export async function hashSpaceFileStream(
  body: ReadableStream<Uint8Array>
): Promise<string> {
  const hash = createHash("sha256");
  const reader = body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      hash.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.digest("hex");
}
