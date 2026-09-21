import {
  spaceMessageFileReferenceSchema,
  toLegacySpaceImageGeometryWireValue,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

// Frozen pre-#1200 message-file wire contract, not the new schema's shape.
const legacyFileReference = spaceMessageFileReferenceSchema
  .pick({
    fileId: true,
    revision: true,
    name: true,
    mimeType: true,
    sizeBytes: true,
  })
  .strict();

describe("Remote Agent Space file projection", () => {
  it("keeps strict legacy nested file references readable without changing canonical geometry or RPC resources", () => {
    const file = {
      fileId: "file-image",
      revision: 1,
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 42,
      imageDimensions: { width: 300, height: 900 },
    };
    const bytes = new Uint8Array([1, 2, 3]);
    const stream = new ReadableStream();
    const canonical = {
      signals: [{ data: { files: [file] } }],
      file: { latestRevision: file },
      revisions: [file],
      bytes,
      stream,
      unrelated: { imageDimensions: "user-authored value" },
    };
    expect(legacyFileReference.safeParse(file).success).toBe(false);
    const wire = toLegacySpaceImageGeometryWireValue(canonical);
    for (const reference of [
      wire.signals[0]?.data.files[0],
      wire.file.latestRevision,
      ...wire.revisions,
    ]) {
      expect(legacyFileReference.safeParse(reference).success).toBe(true);
    }
    expect(canonical.file.latestRevision.imageDimensions).toEqual({
      width: 300,
      height: 900,
    });
    expect(wire.bytes).toBe(bytes);
    expect(wire.stream).toBe(stream);
    expect(wire.unrelated).toEqual(canonical.unrelated);
  });
});
