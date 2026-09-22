import { imageDimensionsFromData } from "image-dimensions";

export type DisplayImageDimensions = { width: number; height: number };
export type ImageByteSource = {
  size: number;
  read: (offset: number, length: number) => Promise<Uint8Array>;
};

export const IMAGE_METADATA_MAX_BYTES = 128 * 1024;
export const IMAGE_METADATA_MAX_READS = 16;
const MAX_DIMENSION = 32_768;
const MAX_PIXELS = 128 * 1024 * 1024;
const decoder = new TextDecoder("ascii");

class UnsupportedImageMetadata extends Error {}

/**
 * Header-only display geometry. Never decodes, resizes, or buffers the original.
 * Blob.slice and private R2 ranges share this bounded reader. Unsupported or
 * ambiguous orientation has no geometry rather than an incorrect aspect ratio.
 */
export async function readDisplayImageDimensions(
  source: ImageByteSource
): Promise<DisplayImageDimensions | undefined> {
  if (!Number.isSafeInteger(source.size) || source.size < 10) {
    return undefined;
  }
  let bytesRead = 0;
  let reads = 0;
  let prefix: Uint8Array = new Uint8Array(0);
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    if (
      !(Number.isSafeInteger(offset) && Number.isSafeInteger(length)) ||
      offset < 0 ||
      length < 1 ||
      offset + length > source.size
    ) {
      throw new UnsupportedImageMetadata();
    }
    if (offset + length <= prefix.length) {
      return prefix.subarray(offset, offset + length);
    }
    bytesRead += length;
    reads += 1;
    if (
      bytesRead > IMAGE_METADATA_MAX_BYTES ||
      reads > IMAGE_METADATA_MAX_READS
    ) {
      throw new UnsupportedImageMetadata();
    }
    const result = await source.read(offset, length);
    if (result.length !== length) {
      throw new UnsupportedImageMetadata();
    }
    return result;
  };
  try {
    // The decoder expects an ArrayBuffer whose first byte is the image header.
    // Normalize a provider's offset view; the copy remains bounded to 64 KiB.
    prefix = (await read(0, Math.min(source.size, 64 * 1024))).slice();
    const raw = imageDimensionsFromData(prefix);
    if (
      !(raw && Number.isInteger(raw.width) && Number.isInteger(raw.height)) ||
      raw.width < 1 ||
      raw.height < 1 ||
      raw.width > MAX_DIMENSION ||
      raw.height > MAX_DIMENSION ||
      raw.width * raw.height > MAX_PIXELS
    ) {
      return undefined;
    }
    let orientation: number;
    switch (raw.type) {
      case "gif":
        orientation = 1;
        break;
      case "jpeg":
        orientation = await readJpegOrientation(read);
        break;
      case "png":
        orientation = await readChunkOrientation(read, source.size, false);
        break;
      case "webp":
        // Only extended WebP can carry EXIF; VP8X advertises its presence.
        orientation =
          decoder.decode(prefix.subarray(12, 16)) === "VP8X" &&
          // biome-ignore lint/suspicious/noBitwiseOperators: VP8X feature bits are a binary format mask.
          ((prefix[20] ?? 0) & 8) !== 0
            ? await readChunkOrientation(read, source.size, true)
            : 1;
        break;
      default:
        // HEIF/AVIF rotations and SVG viewport layout are not raw dimensions.
        return undefined;
    }
    return orientation >= 5
      ? { width: raw.height, height: raw.width }
      : { width: raw.width, height: raw.height };
  } catch (error) {
    if (
      error instanceof UnsupportedImageMetadata ||
      error instanceof RangeError
    ) {
      return undefined;
    }
    // Preserve transport failures rather than claiming that bytes are corrupt.
    throw error;
  }
}

type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>;
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function readJpegOrientation(read: ReadBytes): Promise<number> {
  let offset = 2;
  let orientation = 1;
  let seenExif = false;
  for (let count = 0; count < 256; count += 1) {
    const header = await read(offset, 4);
    if (header[0] !== 0xff) {
      throw new UnsupportedImageMetadata();
    }
    if (header[1] === 0xff) {
      offset += 1;
      continue;
    }
    // Include APP1 after the size header, before the first compressed scan.
    if (header[1] === 0xda || header[1] === 0xd9) {
      return orientation;
    }
    const size = view(header).getUint16(2);
    if (size < 2) {
      throw new UnsupportedImageMetadata();
    }
    if (header[1] === 0xe1) {
      const bytes = await read(offset + 4, size - 2);
      if (decoder.decode(bytes.subarray(0, 6)) === "Exif\0\0") {
        if (seenExif) {
          throw new UnsupportedImageMetadata();
        }
        seenExif = true;
        orientation = readTiffOrientation(bytes.subarray(6));
      }
    }
    offset += size + 2;
  }
  throw new UnsupportedImageMetadata();
}

async function readChunkOrientation(
  read: ReadBytes,
  size: number,
  webp: boolean
): Promise<number> {
  const typeOffset = webp ? 0 : 4;
  const lengthOffset = webp ? 4 : 0;
  let offset = webp ? 12 : 8;
  let orientation = 1;
  let seenExif = false;
  for (let count = 0; count < 256 && offset + 8 <= size; count += 1) {
    const header = await read(offset, 8);
    const length = view(header).getUint32(lengthOffset, webp);
    const kind = decoder.decode(header.subarray(typeOffset, typeOffset + 4));
    const next = offset + 8 + length + (webp ? length % 2 : 4);
    if (next > size) {
      throw new UnsupportedImageMetadata();
    }
    if (kind === "eXIf" || kind === "EXIF") {
      if (seenExif) {
        throw new UnsupportedImageMetadata();
      }
      seenExif = true;
      orientation = readExifOrientation(await read(offset + 8, length));
    }
    if (!webp && kind === "IEND") {
      return orientation;
    }
    offset = next;
  }
  if (webp && seenExif && offset === size) {
    return orientation;
  }
  throw new UnsupportedImageMetadata();
}

function readExifOrientation(bytes: Uint8Array): number {
  const tiff =
    decoder.decode(bytes.subarray(0, 6)) === "Exif\0\0"
      ? bytes.subarray(6)
      : bytes;
  return readTiffOrientation(tiff);
}

/** TIFF IFD0 only. Never follows embedded thumbnails, GPS, or other IFD links. */
function readTiffOrientation(bytes: Uint8Array): number {
  const header = decoder.decode(bytes.subarray(0, 2));
  if (header !== "II" && header !== "MM") {
    throw new UnsupportedImageMetadata();
  }
  const littleEndian = header === "II";
  const data = view(bytes);
  if (data.getUint16(2, littleEndian) !== 42) {
    throw new UnsupportedImageMetadata();
  }
  const offset = data.getUint32(4, littleEndian);
  const count = data.getUint16(offset, littleEndian);
  if (count > 512 || offset + 2 + count * 12 > bytes.length) {
    throw new UnsupportedImageMetadata();
  }
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12;
    if (data.getUint16(entry, littleEndian) !== 0x01_12) {
      continue;
    }
    if (
      data.getUint16(entry + 2, littleEndian) !== 3 ||
      data.getUint32(entry + 4, littleEndian) !== 1
    ) {
      throw new UnsupportedImageMetadata();
    }
    const orientation = data.getUint16(entry + 8, littleEndian);
    if (orientation < 1 || orientation > 8) {
      throw new UnsupportedImageMetadata();
    }
    return orientation;
  }
  return 1;
}
