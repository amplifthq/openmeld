import { describe, expect, it, vi } from "vitest";
import {
  IMAGE_METADATA_MAX_BYTES,
  IMAGE_METADATA_MAX_READS,
  readDisplayImageDimensions,
} from "../src/image-dimensions";

function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function source(bytes: Uint8Array) {
  return {
    size: bytes.length,
    read: vi.fn((offset: number, length: number) =>
      Promise.resolve(bytes.subarray(offset, offset + length))
    ),
  };
}
function exif(orientation: number, littleEndian = true): Uint8Array {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(littleEndian ? "II" : "MM"));
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, 8, littleEndian);
  view.setUint16(8, 1, littleEndian);
  view.setUint16(10, 0x01_12, littleEndian);
  view.setUint16(12, 3, littleEndian);
  view.setUint32(14, 1, littleEndian);
  view.setUint16(18, orientation, littleEndian);
  return bytes;
}
function jpeg(orientation: number, afterSize = false, littleEndian = true) {
  const app = join(
    new TextEncoder().encode("Exif\0\0"),
    exif(orientation, littleEndian)
  );
  const appHeader = Uint8Array.from([255, 225, 0, app.length + 2]);
  const size = Uint8Array.from([
    255, 192, 0, 17, 8, 0, 200, 0, 100, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
  ]);
  return join(
    Uint8Array.from([255, 216]),
    ...(afterSize ? [size, appHeader, app] : [appHeader, app, size]),
    Uint8Array.from([255, 218, 0, 2])
  );
}
function chunk(kind: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  new DataView(bytes.buffer).setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(kind), 4);
  bytes.set(data, 8);
  return bytes; // CRC is irrelevant to a header-only metadata probe.
}
function png(
  width = 320,
  height = 240,
  orientation?: number,
  largePayload = 0
) {
  const dimensions = new Uint8Array(13);
  new DataView(dimensions.buffer).setUint32(0, width);
  new DataView(dimensions.buffer).setUint32(4, height);
  return join(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", dimensions),
    chunk("IDAT", new Uint8Array(largePayload)),
    ...(orientation ? [chunk("eXIf", exif(orientation))] : []),
    chunk("IEND", new Uint8Array())
  );
}

describe("bounded display-oriented image metadata", () => {
  it("accepts an offset byte view without interpreting its unrelated prefix as an image header", async () => {
    const bytes = png(1200, 2400);
    const envelope = join(new Uint8Array(37), bytes, new Uint8Array(9));
    expect(
      await readDisplayImageDimensions(
        source(envelope.subarray(37, 37 + bytes.length))
      )
    ).toEqual({ width: 1200, height: 2400 });
  });

  it("normalizes extended WebP EXIF orientation using bounded RIFF chunks", async () => {
    const extended = new Uint8Array(18);
    extended.set(new TextEncoder().encode("VP8X"));
    new DataView(extended.buffer).setUint32(4, 10, true);
    extended[8] = 8;
    extended[12] = 99;
    extended[15] = 199;
    const tiff = exif(6);
    const metadata = new Uint8Array(8 + tiff.length);
    metadata.set(new TextEncoder().encode("EXIF"));
    new DataView(metadata.buffer).setUint32(4, tiff.length, true);
    metadata.set(tiff, 8);
    const bytes = join(
      new TextEncoder().encode("RIFF"),
      new Uint8Array(4),
      new TextEncoder().encode("WEBP"),
      extended,
      metadata
    );
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    expect(await readDisplayImageDimensions(source(bytes))).toEqual({
      width: 200,
      height: 100,
    });
  });

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8,
  ])("normalizes JPEG EXIF orientation %s without changing bytes", async (orientation) => {
    const bytes = jpeg(orientation);
    const before = bytes.slice();
    expect(await readDisplayImageDimensions(source(bytes))).toEqual(
      orientation >= 5
        ? { width: 200, height: 100 }
        : { width: 100, height: 200 }
    );
    expect(bytes).toEqual(before);
  });
  it("reads big-endian orientation even after the JPEG size marker", async () => {
    expect(
      await readDisplayImageDimensions(source(jpeg(6, true, false)))
    ).toEqual({ width: 200, height: 100 });
  });
  it("reads PNG orientation after a large compressed payload without buffering it", async () => {
    const input = source(png(120, 500, 8, 2 * 1024 * 1024));
    expect(await readDisplayImageDimensions(input)).toEqual({
      width: 500,
      height: 120,
    });
    expect(
      input.read.mock.calls.reduce((sum, call) => sum + call[1], 0)
    ).toBeLessThanOrEqual(IMAGE_METADATA_MAX_BYTES);
    expect(input.read).toHaveBeenCalledTimes(4);
  });
  it.each([
    [0, 50],
    [50, 0],
    [50_000, 10],
    [32_768, 32_768],
  ])("does not admit invalid or excessive geometry %s x %s", async (width, height) => {
    expect(
      await readDisplayImageDimensions(source(png(width, height)))
    ).toBeUndefined();
  });
  it("supports ordinary PNG and GIF geometry", async () => {
    expect(await readDisplayImageDimensions(source(png()))).toEqual({
      width: 320,
      height: 240,
    });
    const gif = join(
      new TextEncoder().encode("GIF89a"),
      Uint8Array.from([100, 0, 200, 0, 0, 0, 0])
    );
    expect(await readDisplayImageDimensions(source(gif))).toEqual({
      width: 100,
      height: 200,
    });
  });
  it("uses unknown geometry for corrupt, unsupported, truncated, or invalid EXIF input", async () => {
    for (const bytes of [
      new TextEncoder().encode("<svg viewBox='0 0 10 10'/>"),
      jpeg(9),
      png().subarray(0, 30),
      new Uint8Array(100),
    ]) {
      expect(await readDisplayImageDimensions(source(bytes))).toBeUndefined();
    }
  });
  it("bounds range request count even for pathological PNG chunk layouts", async () => {
    const chunks = Array.from({ length: 30 }, () =>
      chunk("IDAT", new Uint8Array(70_000))
    );
    const header = png().subarray(0, 33);
    const input = source(
      join(header, ...chunks, chunk("IEND", new Uint8Array()))
    );
    expect(await readDisplayImageDimensions(input)).toBeUndefined();
    expect(input.read.mock.calls.length).toBeLessThanOrEqual(
      IMAGE_METADATA_MAX_READS
    );
    expect(
      input.read.mock.calls.reduce((sum, call) => sum + call[1], 0)
    ).toBeLessThanOrEqual(IMAGE_METADATA_MAX_BYTES);
  });
  it("preserves transport failures rather than treating them as unsupported metadata", async () => {
    const failure = new Error("R2 unavailable");
    await expect(
      readDisplayImageDimensions({
        size: 100,
        read: () => Promise.reject(failure),
      })
    ).rejects.toBe(failure);
  });
});
