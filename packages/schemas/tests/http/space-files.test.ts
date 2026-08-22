import { describe, expect, it } from "vitest";
import {
  buildSpaceFileObjectKey,
  createSpaceFolderBodySchema,
  isSpaceFileTextEditable,
  resolveSpaceFileMimeType,
  SPACE_MESSAGE_FILE_MAX_COUNT,
  spaceFileNameSchema,
  spaceMessageFileReferenceSchema,
  spaceMessageFileReferencesSchema,
  updateSpaceFileEntryBodySchema,
} from "../../src";

describe("Space Files contracts", () => {
  it("keeps one shared immutable revision object-key format", () => {
    expect(
      buildSpaceFileObjectKey({
        organizationId: "org-1",
        spaceId: "space-1",
        fileId: "file-1",
        revisionId: "revision-2",
      })
    ).toBe("org/org-1/space/space-1/files/file-1/revisions/revision-2");
  });

  it("rejects names that could escape a Space folder", () => {
    expect(spaceFileNameSchema.safeParse("../brief.md").success).toBe(false);
    expect(spaceFileNameSchema.safeParse("notes/brief.md").success).toBe(false);
    expect(spaceFileNameSchema.safeParse("  brief.md  ")).toMatchObject({
      success: true,
      data: "brief.md",
    });
  });

  it("requires a real move or rename field", () => {
    expect(
      updateSpaceFileEntryBodySchema.safeParse({ clientMutationId: "move-1" })
        .success
    ).toBe(false);
    expect(
      updateSpaceFileEntryBodySchema.safeParse({
        clientMutationId: "move-1",
        parentId: null,
      }).success
    ).toBe(true);
  });

  it("requires a mutation identity for folder creation", () => {
    expect(
      createSpaceFolderBodySchema.safeParse({ name: "Research" }).success
    ).toBe(false);
  });

  it("limits browser editing to bounded text-compatible content", () => {
    expect(
      isSpaceFileTextEditable({ mimeType: "text/markdown", sizeBytes: 1024 })
    ).toBe(true);
    expect(
      isSpaceFileTextEditable({ mimeType: "image/png", sizeBytes: 1024 })
    ).toBe(false);
    expect(
      isSpaceFileTextEditable({
        mimeType: "text/plain",
        sizeBytes: 1024 * 1024 + 1,
      })
    ).toBe(false);
  });

  it("resolves the same upload type for Web and CLI clients", () => {
    expect(
      resolveSpaceFileMimeType({ declaredMimeType: "", fileName: "notes.md" })
    ).toBe("text/markdown");
    expect(
      resolveSpaceFileMimeType({
        declaredMimeType: " TEXT/PLAIN ",
        fileName: "notes.md",
      })
    ).toBe("text/plain");
    expect(resolveSpaceFileMimeType({ fileName: "archive.unknown" })).toBe(
      "application/octet-stream"
    );
  });

  it("identifies one immutable Space File revision in a message", () => {
    expect(
      spaceMessageFileReferenceSchema.parse({
        fileId: "file-1",
        revision: 2,
        name: "  launch-brief.md  ",
        mimeType: "TEXT/MARKDOWN",
        sizeBytes: 4096,
      })
    ).toEqual({
      fileId: "file-1",
      revision: 2,
      name: "launch-brief.md",
      mimeType: "text/markdown",
      sizeBytes: 4096,
    });
  });

  it("limits one message to ten canonical Space Files", () => {
    const file = {
      fileId: "file-1",
      revision: 1,
      name: "brief.md",
      mimeType: "text/markdown",
      sizeBytes: 128,
    };
    expect(
      spaceMessageFileReferencesSchema.safeParse(
        Array.from({ length: SPACE_MESSAGE_FILE_MAX_COUNT }, () => file)
      ).success
    ).toBe(true);
    expect(
      spaceMessageFileReferencesSchema.safeParse(
        Array.from({ length: SPACE_MESSAGE_FILE_MAX_COUNT + 1 }, () => file)
      ).success
    ).toBe(false);
  });
});
