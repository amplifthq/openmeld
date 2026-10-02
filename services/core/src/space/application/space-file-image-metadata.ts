import type { SpaceFileImageDimensions } from "@openmeld/schemas/types";
import { readDisplayImageDimensions } from "@openmeld/utils";

/** All producers reach this after storing the immutable revision's original. */
export async function readStoredSpaceFileImageDimensions(input: {
  bucket: R2Bucket | undefined;
  objectKey: string;
  sizeBytes: number;
  mimeType: string;
}): Promise<SpaceFileImageDimensions | undefined> {
  if (!input.mimeType.startsWith("image/")) {
    return undefined;
  }
  const bucket = input.bucket;
  if (!bucket) {
    throw new Error("Space file storage is unavailable.");
  }
  return await readDisplayImageDimensions({
    size: input.sizeBytes,
    read: async (offset, length) => {
      const object = await bucket.get(input.objectKey, {
        range: { offset, length },
      });
      if (!object || object.size !== input.sizeBytes) {
        throw new Error("The image revision is unavailable or incomplete.");
      }
      return new Uint8Array(await object.arrayBuffer());
    },
  });
}
