import { toLegacySpaceFilesOriginWireValue } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("legacy Space Files origin wire compatibility", () => {
  it("strips origin from a file descriptor and every nested location", () => {
    const actor = {
      displayName: "Maya",
      profileId: "profile-1",
      profileKind: "human" as const,
    };
    const file = {
      createdAt: "2026-08-23T00:00:00.000Z",
      createdBy: actor,
      id: "file-1",
      kind: "file" as const,
      latestRevision: {
        createdAt: "2026-08-23T00:00:00.000Z",
        createdBy: actor,
        fileId: "file-1",
        id: "revision-1",
        mimeType: "text/markdown",
        revision: 1,
        sizeBytes: 12,
      },
      name: "brief.md",
      origin: "artifact" as const,
      parentId: null,
      path: "/brief.md",
      spaceId: "space-1",
      trashedAt: null,
      trashedBy: null,
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: actor,
    };

    const downgraded = toLegacySpaceFilesOriginWireValue(file) as Record<
      string,
      unknown
    >;

    expect(downgraded).not.toHaveProperty("origin");
    expect(JSON.stringify(downgraded)).not.toContain("origin");
    // Everything else on the descriptor is preserved exactly.
    expect(downgraded).toMatchObject({
      id: "file-1",
      kind: "file",
      name: "brief.md",
    });
  });

  it("strips both the list-level filter echo and every entry's origin", () => {
    const actor = {
      displayName: "Maya",
      profileId: "profile-1",
      profileKind: "human" as const,
    };
    const listResponse = {
      breadcrumbs: [{ id: null, name: "Files" }],
      capabilities: { canRead: true, canWrite: true },
      entries: [
        {
          createdAt: "2026-08-23T00:00:00.000Z",
          createdBy: actor,
          id: "folder-1",
          kind: "folder" as const,
          name: "Launch",
          parentId: null,
          path: "/Launch",
          trashedAt: null,
          trashedBy: null,
          updatedAt: "2026-08-23T00:00:00.000Z",
          updatedBy: actor,
        },
        {
          createdAt: "2026-08-23T00:00:00.000Z",
          createdBy: actor,
          id: "file-1",
          kind: "file" as const,
          latestRevision: {
            createdAt: "2026-08-23T00:00:00.000Z",
            createdBy: actor,
            fileId: "file-1",
            id: "revision-1",
            mimeType: "text/markdown",
            revision: 1,
            sizeBytes: 12,
          },
          name: "brief.md",
          origin: "chat_upload" as const,
          parentId: "folder-1",
          path: "/Launch/brief.md",
          spaceId: "space-1",
          trashedAt: null,
          trashedBy: null,
          updatedAt: "2026-08-23T00:00:00.000Z",
          updatedBy: actor,
        },
      ],
      origin: "artifact" as const,
      parentId: null,
      spaceId: "space-1",
      view: "active" as const,
    };

    const downgraded = toLegacySpaceFilesOriginWireValue(
      listResponse
    ) as typeof listResponse;

    expect(downgraded).not.toHaveProperty("origin");
    expect(downgraded.entries[0]).not.toHaveProperty("origin");
    expect(downgraded.entries[1]).not.toHaveProperty("origin");
    expect(JSON.stringify(downgraded)).not.toContain("origin");
    expect(downgraded).toMatchObject({
      entries: [{ id: "folder-1" }, { id: "file-1" }],
      view: "active",
    });
  });

  it("passes through primitives and null unchanged", () => {
    expect(toLegacySpaceFilesOriginWireValue(null)).toBeNull();
    expect(toLegacySpaceFilesOriginWireValue("artifact")).toBe("artifact");
    expect(toLegacySpaceFilesOriginWireValue(42)).toBe(42);
  });
});
