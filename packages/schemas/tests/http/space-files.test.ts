import { describe, expect, it } from "vitest";
import {
  buildSpaceFileObjectKey,
  createSpaceFolderBodySchema,
  isSpaceFileTextEditable,
  spaceFileNameSchema,
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
});
