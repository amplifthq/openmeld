import { describe, expect, it } from "vitest";
import { resolveSpaceFileStreamMetadata } from "../../src/schemas/http/space-file-stream";

describe("immutable Space file byte ranges", () => {
  it.each([
    ["bytes=0-1", 0, 2],
    ["bytes=4-", 4, 6],
    ["bytes=4-999", 4, 6],
    ["bytes=-3", 7, 3],
    ["bytes=-99", 0, 10],
    ["bytes=9-9", 9, 1],
  ])("serves only the requested original bytes for %s", (range, offset, length) => {
    expect(
      resolveSpaceFileStreamMetadata({
        options: { range },
        revisionId: "revision-1",
        sizeBytes: 10,
      })
    ).toEqual({ status: 206, etag: '"revision-1"', offset, length });
  });

  it.each([
    "bytes=10-",
    "bytes=7-2",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,4-5",
    "items=0-1",
    "bytes=9007199254740992-",
    "bytes=0-9007199254740992",
  ])("rejects unsupported or unsatisfiable ranges without widening: %s", (range) => {
    expect(
      resolveSpaceFileStreamMetadata({
        options: { range },
        revisionId: "revision-1",
        sizeBytes: 10,
      }).status
    ).toBe(416);
  });

  it("handles empty revisions, HEAD and If-Range without mixing versions", () => {
    const input = { revisionId: "revision-1", sizeBytes: 10 };
    expect(
      resolveSpaceFileStreamMetadata({
        ...input,
        sizeBytes: 0,
        options: { range: "bytes=0-" },
      }).status
    ).toBe(416);
    expect(
      resolveSpaceFileStreamMetadata({
        ...input,
        options: { range: "bytes=0-1", head: true },
      }).status
    ).toBe(200);
    expect(
      resolveSpaceFileStreamMetadata({
        ...input,
        options: { range: "bytes=0-1", ifRange: '"revision-1"' },
      }).status
    ).toBe(206);
    expect(
      resolveSpaceFileStreamMetadata({
        ...input,
        options: { range: "bytes=0-1", ifRange: '"revision-2"' },
      }).status
    ).toBe(200);
    expect(
      resolveSpaceFileStreamMetadata({
        ...input,
        options: { range: "bytes=0-1", ifRange: 'W/"revision-1"' },
      }).status
    ).toBe(200);
  });
});
