import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import {
  buildSpaceComposerPublishedFileId,
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileObjectKey,
  buildSpaceFileRevisionIdForMutation,
  centerAgentListSpaceFilesRpcInputSchema,
  centerAgentManageSpaceFilesRpcInputSchema,
  createSpaceFolderBodySchema,
  getSpaceFileResponseSchema,
  isSpaceFileTextEditable,
  listSpaceFileRevisionsResponseSchema,
  listSpaceFilesQuerySchema,
  listSpaceFilesResponseSchema,
  postNormalMessageBodySchema,
  postSpaceThreadSignalBodySchema,
  resolveSpaceFileMimeType,
  restoreSpaceFileEntryBodySchema,
  restoreSpaceFileEntryResponseSchema,
  restoreSpaceFileRevisionBodySchema,
  restoreSpaceFileRevisionResponseSchema,
  SPACE_MESSAGE_FILE_MAX_COUNT,
  spaceFileAuditEventSchema,
  spaceFileDescriptorSchema,
  spaceFileEntrySchema,
  spaceFileNameSchema,
  spaceMessageFileReferenceSchema,
  spaceMessageFileReferencesSchema,
  toLegacySpaceFilesOriginWireValue,
  updateSpaceFileEntryBodySchema,
  updateSpaceFileEntryResponseSchema,
  uploadSpaceFileResponseSchema,
} from "../../src";

/**
 * Reconstructs the exact frozen response contract shipped before `origin`
 * existed (PR base `6d0736ee1197bee8778760f4b7ecc13d2bd77b2c`:
 * `spaceFileDescriptorSchema`/`listSpaceFilesResponseSchema` were already
 * `z.strictObject()` and had no `origin` key). An already-published CLI or
 * Web bundle built against that contract parses server responses with
 * exactly this shape; it has no knowledge of `origin` at all. Derived from
 * the current schema minus `origin`, so it tracks any other field the
 * current shape gains and only isolates the one field this PR adds.
 */
const preOriginSpaceFileDescriptorSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(spaceFileDescriptorSchema.shape).filter(
      ([key]) => key !== "origin"
    )
  )
);
const preOriginListSpaceFilesResponseSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(listSpaceFilesResponseSchema.shape).filter(
      ([key]) => key !== "origin"
    )
  )
);
const preOriginSpaceFileEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject(spaceFileEntrySchema.options[0].shape),
  preOriginSpaceFileDescriptorSchema,
]);
const preOriginGetSpaceFileResponseSchema = z.strictObject({
  ...getSpaceFileResponseSchema.shape,
  file: preOriginSpaceFileDescriptorSchema,
});
const preOriginUploadSpaceFileResponseSchema = z.strictObject({
  ...uploadSpaceFileResponseSchema.shape,
  file: preOriginSpaceFileDescriptorSchema,
});
const preOriginRestoreSpaceFileRevisionResponseSchema = z.strictObject({
  ...restoreSpaceFileRevisionResponseSchema.shape,
  file: preOriginSpaceFileDescriptorSchema,
});
const preOriginListSpaceFileRevisionsResponseSchema = z.strictObject({
  ...listSpaceFileRevisionsResponseSchema.shape,
  file: preOriginSpaceFileDescriptorSchema,
});
const preOriginUpdateSpaceFileEntryResponseSchema = z.strictObject({
  ...updateSpaceFileEntryResponseSchema.shape,
  entry: preOriginSpaceFileEntrySchema,
});
const preOriginRestoreSpaceFileEntryResponseSchema = z.strictObject({
  ...restoreSpaceFileEntryResponseSchema.shape,
  entry: preOriginSpaceFileEntrySchema,
});

describe("Space Files contracts", () => {
  it("keeps Composer publication identities exact at the request limits", async () => {
    const clientMutationId = "m".repeat(128);
    const uploadId = "22222222-2222-4222-8222-222222222222";
    const repeatedFileId = await buildSpaceComposerPublishedFileId({
      clientMutationId,
      uploadId,
    });

    expect(repeatedFileId).toBe(
      await buildSpaceComposerPublishedFileId({
        clientMutationId,
        uploadId,
      })
    );
    expect(repeatedFileId).not.toBe(
      await buildSpaceComposerPublishedFileId({
        clientMutationId,
        uploadId: "33333333-3333-4333-8333-333333333333",
      })
    );
  });

  it("keeps exact write retries stable and changed bytes distinct", async () => {
    const firstBytes = new TextEncoder().encode("first");
    const repeatedBytes = new TextEncoder().encode("first");
    const changedBytes = new TextEncoder().encode("other");
    const toArrayBuffer = (value: Uint8Array) => {
      const bytes = new ArrayBuffer(value.byteLength);
      new Uint8Array(bytes).set(value);
      return bytes;
    };

    expect(await buildSpaceFileEntryIdForMutation("create-retry")).toBe(
      await buildSpaceFileEntryIdForMutation("create-retry")
    );
    expect(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: 1,
        bytes: toArrayBuffer(firstBytes),
        clientMutationId: "save-retry",
        mimeType: "text/plain",
      })
    ).toBe(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: 1,
        bytes: toArrayBuffer(repeatedBytes),
        clientMutationId: "save-retry",
        mimeType: "text/plain",
      })
    );
    expect(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: 1,
        bytes: toArrayBuffer(firstBytes),
        clientMutationId: "save-retry",
        mimeType: "text/plain",
      })
    ).not.toBe(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: 1,
        bytes: toArrayBuffer(changedBytes),
        clientMutationId: "save-retry",
        mimeType: "text/plain",
      })
    );
    expect(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: null,
        bytes: toArrayBuffer(firstBytes),
        clientMutationId: "create-retry",
        mimeType: "text/plain",
        name: "first.txt",
        parentId: null,
      })
    ).not.toBe(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: null,
        bytes: toArrayBuffer(firstBytes),
        clientMutationId: "create-retry",
        mimeType: "text/markdown",
        name: "second.md",
        parentId: null,
      })
    );
  });

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

  it("keeps Space File audit events minimal and semantically consistent", () => {
    const event = {
      actorKind: "authenticated" as const,
      actorProfileId: "profile-1",
      entryId: "file-1",
      errorCode: null,
      eventId: "content_read:request-1",
      occurredAtMs: 1_774_332_000_000,
      operation: "content_read" as const,
      operationId: "request-1",
      organizationId: "org-1",
      representedHumanProfileId: null,
      requestId: "request-1",
      result: "succeeded" as const,
      revisionId: "revision-1",
      spaceId: "space-1",
    };

    expect(spaceFileAuditEventSchema.parse(event)).toEqual(event);
    expect(
      spaceFileAuditEventSchema.safeParse({
        ...event,
        eventId: "x".repeat(2048),
      }).success
    ).toBe(true);
    expect(
      spaceFileAuditEventSchema.safeParse({ ...event, fileName: "secret.md" })
        .success
    ).toBe(false);
    expect(
      spaceFileAuditEventSchema.safeParse({
        ...event,
        actorKind: "anonymous_viewer",
      }).success
    ).toBe(false);
    expect(
      spaceFileAuditEventSchema.safeParse({
        ...event,
        errorCode: "space_file.storage_failed",
      }).success
    ).toBe(false);
    expect(
      spaceFileAuditEventSchema.safeParse({
        ...event,
        result: "failed",
      }).success
    ).toBe(false);
    expect(
      spaceFileAuditEventSchema.safeParse({
        ...event,
        actorKind: "anonymous_viewer",
        actorProfileId: null,
      }).success
    ).toBe(true);
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

  it("keeps active Files and Trash as separate list views", () => {
    expect(listSpaceFilesQuerySchema.parse({})).toEqual({
      view: "active",
      origin: "artifact",
    });
    expect(listSpaceFilesQuerySchema.parse({ view: "trash" })).toEqual({
      view: "trash",
      origin: "artifact",
    });
    expect(
      restoreSpaceFileEntryBodySchema.safeParse({
        clientMutationId: "restore-1",
      }).success
    ).toBe(true);
  });

  it("defaults the Files list to artifacts only, with an explicit escape to see chat uploads", () => {
    expect(listSpaceFilesQuerySchema.parse({}).origin).toBe("artifact");
    expect(listSpaceFilesQuerySchema.parse({ origin: "all" }).origin).toBe(
      "all"
    );
    expect(
      listSpaceFilesQuerySchema.safeParse({ origin: "chat_upload" }).success
    ).toBe(false);
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
      parentId: null,
      path: "/brief.md",
      spaceId: "space-1",
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: actor,
    };
    expect(spaceFileDescriptorSchema.parse(file).origin).toBeNull();
    expect(
      spaceFileDescriptorSchema.parse({ ...file, origin: "artifact" }).origin
    ).toBe("artifact");
    expect(
      spaceFileDescriptorSchema.parse({ ...file, origin: "chat_upload" }).origin
    ).toBe("chat_upload");
  });

  it("lets a current reader parse a response from a producer that predates origin", () => {
    // This is the one direction that is actually safe without any deploy
    // ordering: a NEW reader (current schema) accepting an OLD-shaped
    // response (no `origin` key at all, e.g. from Core before this change,
    // or during a rollout window where Core has not redeployed yet).
    const actor = {
      displayName: "Maya",
      profileId: "profile-1",
      profileKind: "human" as const,
    };
    const preOriginFile = {
      createdAt: "2026-08-23T00:00:00.000Z",
      createdBy: actor,
      id: "file-1",
      kind: "file",
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
      parentId: null,
      path: "/brief.md",
      spaceId: "space-1",
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: actor,
    };
    // Prove the fixture is genuinely old-shaped first: a pre-origin strict
    // reader (see the reconstructed schema above) must accept it.
    expect(
      preOriginSpaceFileDescriptorSchema.parse(preOriginFile)
    ).toMatchObject(preOriginFile);

    expect(
      listSpaceFilesResponseSchema.parse({
        breadcrumbs: [{ id: null, name: "Files" }],
        capabilities: { canRead: true, canWrite: true },
        entries: [preOriginFile],
        parentId: null,
        spaceId: "space-1",
      })
    ).toMatchObject({
      entries: [{ trashedAt: null, trashedBy: null, origin: null }],
      origin: "artifact",
      view: "active",
    });
  });

  it("documents that an already-published pre-origin strict reader rejects the new response shape", () => {
    // The reverse direction is not safe, and this PR does not claim it is:
    // an already-published CLI or Web bundle parses responses with its own
    // frozen schema, which has no knowledge of `origin` at all. Zod's
    // strict object mode rejects any unrecognized key, so a real historical
    // client throws on any response Core now returns for a file. This is a
    // known, accepted limitation of already-published clients reading a
    // `z.strictObject()` response that gains a field (see
    // `developing/architecture/shared-contracts.md`'s schema-evolution
    // rule and the Space Files Origin Classification Contract Impact Audit
    // in `developing/engineering/development-workflow.md`) — not something
    // any request-side or response-side default in this schema can fix,
    // because the break lives entirely in the old client's own frozen code.
    const actor = {
      displayName: "Maya",
      profileId: "profile-1",
      profileKind: "human" as const,
    };
    const newShapedFile = {
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
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: actor,
    };
    // The current schema accepts it (this is the supported new-reads-new
    // case), but the frozen old strict reader rejects the same object,
    // because it carries a key ("origin") the old reader never learned.
    expect(spaceFileDescriptorSchema.safeParse(newShapedFile).success).toBe(
      true
    );
    expect(
      preOriginSpaceFileDescriptorSchema.safeParse(newShapedFile).success
    ).toBe(false);

    const newShapedListResponse = {
      breadcrumbs: [{ id: null, name: "Files" }],
      capabilities: { canRead: true, canWrite: true },
      entries: [newShapedFile],
      origin: "artifact" as const,
      parentId: null,
      spaceId: "space-1",
    };
    expect(
      listSpaceFilesResponseSchema.safeParse(newShapedListResponse).success
    ).toBe(true);
    expect(
      preOriginListSpaceFilesResponseSchema.safeParse(newShapedListResponse)
        .success
    ).toBe(false);
  });

  it("lets a frozen pre-origin Gateway parse a current Core response once the Gateway-to-Core RPC boundary downgrades it", () => {
    // The Gateway-to-Core RPC boundary is a second, independent negotiation
    // from the HTTP client-to-Gateway boundary covered above: Core's ordinary
    // Gateway-facing Space Files methods (listSpaceFiles, getSpaceFile,
    // listSpaceFileRevisions, updateSpaceFileEntry, restoreSpaceFileEntry,
    // restoreSpaceFileRevision, writeSpaceFileContent, spaceFileUpload,
    // publishSpaceComposerUpload, streamSpaceFileContent) accept an optional
    // spaceFilesOriginVersion argument and downgrade their response with
    // toLegacySpaceFilesOriginWireValue when it is absent — exactly what an
    // already-published (frozen) Gateway build does, since its own compiled
    // code has no such argument and never passes it. This proves that once
    // Core applies that downgrade, a Gateway build frozen at PR base
    // (`6d0736ee1197bee8778760f4b7ecc13d2bd77b2c`, before origin existed)
    // successfully parses the result with its own frozen strict schemas —
    // for every response family a Gateway-facing method returns, not only
    // the list response covered above.
    const actor = {
      displayName: "Maya",
      profileId: "profile-1",
      profileKind: "human" as const,
    };
    const newShapedFile = {
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
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: actor,
    };
    const newShapedFolder = {
      createdAt: "2026-08-23T00:00:00.000Z",
      createdBy: actor,
      id: "folder-1",
      kind: "folder" as const,
      name: "Launch",
      parentId: null,
      path: "/Launch",
      spaceId: "space-1",
      updatedAt: "2026-08-23T00:00:00.000Z",
      updatedBy: actor,
    };

    const representativeCoreResponses: Array<{
      current: z.ZodType;
      legacy: z.ZodType;
      operation: string;
      // A folder entry never carries `origin` in either shape (folders are
      // structural, not classified), so the frozen schema already accepts
      // its raw new-shaped value; only the file-descriptor-bearing cases
      // prove the actual compatibility gap this negotiation closes.
      expectRawValueAccepted?: boolean;
      value: unknown;
    }> = [
      {
        current: getSpaceFileResponseSchema,
        legacy: preOriginGetSpaceFileResponseSchema,
        operation: "getSpaceFile",
        value: { file: newShapedFile },
      },
      {
        current: uploadSpaceFileResponseSchema,
        legacy: preOriginUploadSpaceFileResponseSchema,
        operation: "spaceFileUpload / writeSpaceFileContent",
        value: { file: newShapedFile },
      },
      {
        current: restoreSpaceFileRevisionResponseSchema,
        legacy: preOriginRestoreSpaceFileRevisionResponseSchema,
        operation: "restoreSpaceFileRevision",
        value: { file: newShapedFile },
      },
      {
        current: listSpaceFileRevisionsResponseSchema,
        legacy: preOriginListSpaceFileRevisionsResponseSchema,
        operation: "listSpaceFileRevisions",
        value: {
          file: newShapedFile,
          revisions: [newShapedFile.latestRevision],
        },
      },
      {
        current: updateSpaceFileEntryResponseSchema,
        legacy: preOriginUpdateSpaceFileEntryResponseSchema,
        operation: "updateSpaceFileEntry (file entry)",
        value: { entry: newShapedFile },
      },
      {
        current: updateSpaceFileEntryResponseSchema,
        legacy: preOriginUpdateSpaceFileEntryResponseSchema,
        operation: "updateSpaceFileEntry (folder entry)",
        expectRawValueAccepted: true,
        value: { entry: newShapedFolder },
      },
      {
        current: restoreSpaceFileEntryResponseSchema,
        legacy: preOriginRestoreSpaceFileEntryResponseSchema,
        operation: "restoreSpaceFileEntry",
        value: { entry: newShapedFile },
      },
    ];

    for (const representative of representativeCoreResponses) {
      expect(
        representative.current.safeParse(representative.value).success,
        `${representative.operation}: current schema should accept the new-shaped value`
      ).toBe(true);
      expect(
        representative.legacy.safeParse(representative.value).success,
        `${representative.operation}: frozen pre-origin schema should reject the raw new-shaped value`
      ).toBe(representative.expectRawValueAccepted ?? false);
      const downgraded = toLegacySpaceFilesOriginWireValue(
        representative.value
      );
      expect(
        representative.legacy.safeParse(downgraded).success,
        `${representative.operation}: frozen pre-origin schema should accept the downgraded value`
      ).toBe(true);
    }
  });

  it("gives the Center Agent the same Trash and restore language", () => {
    const context = {
      activeOrganizationId: "organization-1",
      actorContext: {
        callerPrincipalId: "user-1",
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent" as const,
        requestId: "request-1",
      },
    };
    expect(
      centerAgentListSpaceFilesRpcInputSchema.parse({
        context,
        spaceId: "space-1",
        view: "trash",
      })
    ).toMatchObject({ view: "trash" });
    expect(
      centerAgentManageSpaceFilesRpcInputSchema.safeParse({
        action: "restore",
        clientMutationId: "restore-1",
        context,
        entryId: "file-1",
        spaceId: "space-1",
      }).success
    ).toBe(true);
    expect(
      centerAgentManageSpaceFilesRpcInputSchema.safeParse({
        action: "restore_version",
        baseRevision: 3,
        clientMutationId: "restore-version-1",
        context,
        fileId: "file-1",
        revision: 1,
        spaceId: "space-1",
      }).success
    ).toBe(true);
  });

  it("requires the current revision when restoring an older version", () => {
    expect(
      restoreSpaceFileRevisionBodySchema.parse({
        baseRevision: 4,
        clientMutationId: "restore-version-1",
      })
    ).toEqual({
      baseRevision: 4,
      clientMutationId: "restore-version-1",
    });
    expect(
      restoreSpaceFileRevisionBodySchema.safeParse({
        baseRevision: 0,
        clientMutationId: "restore-version-1",
      }).success
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

  it("allows file-only Space and thread messages but rejects empty messages", () => {
    const file = {
      fileId: "file-1",
      revision: 1,
      name: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
    };
    expect(
      postNormalMessageBodySchema.safeParse({ text: "", files: [file] }).success
    ).toBe(true);
    expect(
      postSpaceThreadSignalBodySchema.safeParse({
        clientMessageId: "message-1",
        text: "",
        files: [file],
      }).success
    ).toBe(true);
    expect(postNormalMessageBodySchema.safeParse({ text: "" }).success).toBe(
      false
    );
  });
});
