import { randomUUID } from "node:crypto";
import { link, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Publish a complete download atomically without replacing an existing file by default. */
export async function saveFileDownload(input: {
  bytes: ReadableStream<Uint8Array>;
  destination: string;
  force: boolean;
  sizeBytes: number;
}): Promise<number> {
  const temporary = join(
    dirname(input.destination),
    `.${basename(input.destination)}.openmeld-${randomUUID()}.tmp`
  );
  let received = 0;
  const chunks = async function* () {
    const reader = input.bytes.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        received += chunk.value.byteLength;
        if (received > input.sizeBytes) {
          throw new Error("The downloaded file exceeded its declared size.");
        }
        yield chunk.value;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  };
  try {
    await writeFile(temporary, chunks(), { flag: "wx" });
    if (received !== input.sizeBytes) {
      throw new Error("The downloaded file was incomplete.");
    }
    if (input.force) {
      await rename(temporary, input.destination);
    } else {
      await link(temporary, input.destination);
    }
    return received;
  } finally {
    await rm(temporary, { force: true });
  }
}
