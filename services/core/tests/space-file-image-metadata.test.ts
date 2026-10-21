import { describe, expect, it } from "vitest";
import { readStoredSpaceFileImageDimensions } from "../src/space/application/space-file-image-metadata";
import { env } from "../test-support/worker-env";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set(new TextEncoder().encode("IEND"), 37);
  return bytes;
}

describe("Space revision original-byte metadata", () => {
  it("reads private R2 ranges without changing the immutable image and preserves revision-specific geometry", async () => {
    const bucket = env.OPENMELD_SPACE_ATTACHMENTS;
    const prefix = `image-metadata-test/${crypto.randomUUID()}`;
    const first = png(120, 900);
    const second = png(1600, 800);
    const keys = [
      `${prefix}/revision-1`,
      `${prefix}/revision-2`,
      `${prefix}/restored-revision-1`,
    ] as const;
    try {
      await bucket.put(keys[0], first);
      await bucket.put(keys[1], second);
      const source = await bucket.get(keys[0]);
      if (!source) {
        throw new Error("Expected the original.");
      }
      await bucket.put(keys[2], source.body);
      const dimensions = await Promise.all(
        keys.map((objectKey) =>
          readStoredSpaceFileImageDimensions({
            bucket,
            objectKey,
            sizeBytes: first.length,
            mimeType: "image/png",
          })
        )
      );
      expect(dimensions).toEqual([
        { width: 120, height: 900 },
        { width: 1600, height: 800 },
        { width: 120, height: 900 },
      ]);
      const original = await bucket.get(keys[0]);
      if (!original) {
        throw new Error("Expected the unchanged original.");
      }
      expect(new Uint8Array(await original.arrayBuffer())).toEqual(first);
    } finally {
      await bucket.delete([...keys]);
    }
  });

  it("distinguishes unsupported metadata from missing or mismatched original bytes", async () => {
    const bucket = env.OPENMELD_SPACE_ATTACHMENTS;
    const objectKey = `image-metadata-test/${crypto.randomUUID()}`;
    const input = { bucket, objectKey, sizeBytes: 64, mimeType: "image/png" };
    await expect(readStoredSpaceFileImageDimensions(input)).rejects.toThrow(
      "unavailable or incomplete"
    );
    try {
      await bucket.put(objectKey, new Uint8Array(64));
      await expect(
        readStoredSpaceFileImageDimensions(input)
      ).resolves.toBeUndefined();
      await expect(
        readStoredSpaceFileImageDimensions({ ...input, sizeBytes: 65 })
      ).rejects.toThrow("unavailable or incomplete");
    } finally {
      await bucket.delete(objectKey);
    }
    await expect(
      readStoredSpaceFileImageDimensions({
        ...input,
        bucket: undefined,
        mimeType: "text/plain",
      })
    ).resolves.toBeUndefined();
  });
});
