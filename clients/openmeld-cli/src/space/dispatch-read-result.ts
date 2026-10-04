import { randomUUID } from "node:crypto";
import type { AdapterDispatchSpaceToolResult } from "@openmeld/adapter-core";
import { dispatchSpaceReadResultSchema } from "@openmeld/schemas";

// Bound the serialized tool response, not the source content. The source stays
// intact and readable without a shell or a model-provider spill-file reader.
const PAGE_BYTES = 8 * 1024;
const SNAPSHOT_BYTES = 32 * 1024 * 1024;
const SNAPSHOT_COUNT = 4;

export class DispatchReadResults {
  readonly #snapshots = new Map<
    string,
    {
      bytes: Buffer;
      offsets: Set<number>;
      revalidate: () => Promise<AdapterDispatchSpaceToolResult>;
    }
  >();
  #bytes = 0;

  wrap(
    result: AdapterDispatchSpaceToolResult,
    revalidate: () => Promise<AdapterDispatchSpaceToolResult>
  ): AdapterDispatchSpaceToolResult {
    if (result.isError) {
      return result;
    }
    const value = readValue(result);
    const complete = dispatchSpaceReadResultSchema.parse({ result: value });
    if (Buffer.byteLength(JSON.stringify(complete)) <= PAGE_BYTES) {
      return this.#result(complete);
    }
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > SNAPSHOT_BYTES) {
      throw new Error(
        "The read exceeds this Wake's in-memory result budget. Request a smaller source; no local file was created."
      );
    }
    while (
      this.#snapshots.size >= SNAPSHOT_COUNT ||
      this.#bytes + bytes.length > SNAPSHOT_BYTES
    ) {
      const oldest = this.#snapshots.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#bytes -= this.#snapshots.get(oldest)?.bytes.length ?? 0;
      this.#snapshots.delete(oldest);
    }
    const resultId = randomUUID();
    this.#snapshots.set(resultId, { bytes, offsets: new Set([0]), revalidate });
    this.#bytes += bytes.length;
    return this.#page(resultId, 0);
  }

  async read(
    resultId: string,
    offset: number
  ): Promise<AdapterDispatchSpaceToolResult> {
    const snapshot = this.#requireSnapshot(resultId, offset);
    // The cached bytes are a delivery optimization, never source authority.
    // Reread through the original source owner before disclosing every page.
    const current = await snapshot.revalidate();
    if (
      current.isError ||
      !Buffer.from(JSON.stringify(readValue(current))).equals(snapshot.bytes)
    ) {
      this.#bytes -= snapshot.bytes.length;
      this.#snapshots.delete(resultId);
      throw new Error(
        "The source is no longer accessible or its selected version changed. No cached page was disclosed. Read the source again."
      );
    }
    return this.#page(resultId, offset);
  }

  #requireSnapshot(resultId: string, offset: number) {
    const snapshot = this.#snapshots.get(resultId);
    if (!snapshot?.offsets.has(offset)) {
      throw new Error(
        "This result or offset is unavailable in the current tool invocation. Use a returned nextOffset, or read the source again; do not open a local file."
      );
    }
    return snapshot;
  }

  #page(resultId: string, offset: number): AdapterDispatchSpaceToolResult {
    const snapshot = this.#requireSnapshot(resultId, offset);
    const { bytes } = snapshot;
    let end = Math.min(offset + PAGE_BYTES, bytes.length);
    while (true) {
      // Never split a UTF-8 code point. Returned offsets are the only accepted
      // page boundaries, including when a caller repeats an earlier page.
      while (end < bytes.length && isUtf8Continuation(bytes[end])) {
        end -= 1;
      }
      const nextOffset = end === bytes.length ? null : end;
      const value = dispatchSpaceReadResultSchema.parse({
        page: {
          resultId,
          offset,
          nextOffset,
          totalBytes: bytes.length,
          text: bytes.subarray(offset, end).toString("utf8"),
        },
      });
      if (Buffer.byteLength(JSON.stringify(value)) <= PAGE_BYTES) {
        if (nextOffset !== null) {
          snapshot.offsets.add(nextOffset);
        }
        return this.#result(value);
      }
      end = offset + Math.floor((end - offset) * 0.8);
    }
  }

  clear(): void {
    this.#snapshots.clear();
    this.#bytes = 0;
  }

  #result(value: Record<string, unknown>): AdapterDispatchSpaceToolResult {
    return {
      structuredContent: value,
      content: [{ type: "text", text: JSON.stringify(value) }],
    };
  }
}

function readValue(result: AdapterDispatchSpaceToolResult) {
  return (
    result.structuredContent ??
    JSON.parse(result.content.map((item) => item.text).join("\n"))
  );
}

function isUtf8Continuation(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte < 0xc0;
}
