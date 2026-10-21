import { runInDurableObject } from "cloudflare:test";
import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { SPACE_FILE_MAX_NAME_LENGTH } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceFileActor,
  SpaceFileAuditEvent,
  SpaceFileAuditOperation,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  SpaceFileRepository,
  type SpaceFileRepositoryError,
} from "../src/space/infrastructure/sql/space-file-repo";
import { SpaceFileUpdateRepository } from "../src/space/infrastructure/sql/space-file-update-repo";
import { upsertSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

const actor: SpaceFileActor = {
  profileId: "profile-human-files-test",
  profileKind: "human",
  displayName: "Avery Stone",
  ownerUserId: "user-files-test",
};
describe("SpaceFileRepository", () => {
  it("keeps optional geometry on its immutable revision through reads, updates, replay, and lazy migration", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository, sql) => {
      ensureSpaceSqlSchema(sql);
      const fileId = `${fixture.prefix}-image`;
      const save = (
        revision: number,
        imageDimensions?: {
          width: number;
          height: number;
        }
      ) => ({
        actor,
        imageDimensions,
        nowMs: fixture.nowMs + revision,
        auditEvent: createAuditEvent({
          entryId: fileId,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-geometry-${revision}`,
        }),
        write: {
          spaceId: fixture.spaceId,
          fileId,
          revisionId: `${fixture.prefix}-revision-${revision}`,
          clientMutationId: `${fixture.prefix}-geometry-${revision}`,
          name: "photo.png",
          parentId: null,
          baseRevision: revision === 1 ? null : revision - 1,
          mimeType: "image/png",
          sizeBytes: 50,
        },
      });
      const first = save(1, { width: 300, height: 900 });
      expect(
        repository.commitWrite(first).latestRevision.imageDimensions
      ).toEqual(first.imageDimensions);
      repository.commitWrite(save(2, { width: 1200, height: 600 }));
      expect(
        repository.resolveRevision({ fileId, revision: 1 }).revision
          .imageDimensions
      ).toEqual({ width: 300, height: 900 });
      expect(repository.getFile(fileId).latestRevision.imageDimensions).toEqual(
        { width: 1200, height: 600 }
      );
      expect(
        repository.commitWrite({
          ...first,
          imageDimensions: { width: 1, height: 1 },
        }).latestRevision.imageDimensions
      ).toEqual({ width: 300, height: 900 });
      repository.commitWrite(save(3));
      expect(repository.getFile(fileId).latestRevision).not.toHaveProperty(
        "imageDimensions"
      );
      expect(
        repository
          .listRevisions(fileId)
          .map((revision) => revision.imageDimensions)
      ).toEqual([
        undefined,
        { width: 1200, height: 600 },
        { width: 300, height: 900 },
      ]);
      expect(() =>
        repository.commitWrite(save(4, { width: 0, height: 500 }))
      ).toThrow();
      expect(repository.getFile(fileId).latestRevision.revision).toBe(3);
    });
  });
  it("commits notification intent once with a new revision, never for conflicts or replayed saves", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository, sql) => {
      const updates = new SpaceFileUpdateRepository(sql);
      const fileId = `${fixture.prefix}-file`;
      const save = (revision: number, baseRevision: number | null) => ({
        actor,
        auditEvent: createAuditEvent({
          entryId: fileId,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-${revision}`,
        }),
        nowMs: fixture.nowMs + revision,
        write: {
          spaceId: fixture.spaceId,
          fileId,
          revisionId: `${fixture.prefix}-revision-${revision}`,
          clientMutationId: `${fixture.prefix}-write-${revision}`,
          name: "brief.md",
          parentId: null,
          baseRevision,
          mimeType: "text/markdown",
          sizeBytes: 20,
        },
      });
      repository.commitWrite(save(1, null));
      expect(updates.pending(fixture.nowMs + 100)).toEqual([]);
      expect(
        updates.configure({
          fileId,
          actor,
          baseVersion: 0,
          recipientProfileIds: ["human-reader", "agent-reader"],
        })?.version
      ).toBe(1);
      const next = save(2, 1);
      repository.commitWrite(next);
      repository.commitWrite(next);
      expect(
        repository.resolveCommittedWrite(
          next.write.clientMutationId,
          fileId,
          next.write
        )?.latestRevision.revision
      ).toBe(2);
      expect(() =>
        repository.resolveCommittedWrite(next.write.clientMutationId, fileId, {
          ...next.write,
          revisionId: `${fixture.prefix}-different-content`,
        })
      ).toThrowError(expect.objectContaining({ code: "space_file.conflict" }));
      expect(updates.pending(fixture.nowMs + 100)).toHaveLength(1);
      expect(() => repository.commitWrite(save(3, 1))).toThrow();
      expect(updates.pending(fixture.nowMs + 100)).toHaveLength(1);
      const pending = updates.pending(fixture.nowMs + 100)[0];
      if (!pending) {
        throw new Error("A committed revision must have notification intent.");
      }
      updates.retry(pending.id, fixture.nowMs + 100, "temporary failure");
      expect(updates.pending(fixture.nowMs + 200)).toEqual([]);
      expect(updates.pending(fixture.nowMs + 60_100)[0]?.attempts).toBe(1);
      updates.complete(pending.id);
      repository.commitWrite(next);
      expect(updates.pending(fixture.nowMs + 100_000)).toEqual([]);
      expect(
        updates.configure({
          fileId,
          actor,
          baseVersion: 0,
          recipientProfileIds: [],
        })
      ).toBeNull();
      updates.configure({
        fileId,
        actor,
        baseVersion: 1,
        recipientProfileIds: [],
      });
      repository.commitWrite(save(3, 2));
      expect(updates.pending(fixture.nowMs + 100_000)).toEqual([]);
    });
  });
  it("stores folders, immutable file revisions, paths, and actor attribution in Space SQLite", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository) => {
      const folder = repository.createFolder({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-folder`,
          fixture,
          operation: "folder_create",
          operationId: `${fixture.prefix}-mkdir`,
        }),
        clientMutationId: `${fixture.prefix}-mkdir`,
        folderId: `${fixture.prefix}-folder`,
        name: "Launch",
        nowMs: fixture.nowMs,
        spaceId: fixture.spaceId,
      });
      expect(folder).toMatchObject({
        kind: "folder",
        name: "Launch",
        path: "/Launch",
        createdBy: actor,
      });
      const firstRevision = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-file`,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-1`,
          revisionId: `${fixture.prefix}-revision-1`,
        }),
        nowMs: fixture.nowMs + 1,
        write: {
          spaceId: fixture.spaceId,
          fileId: `${fixture.prefix}-file`,
          revisionId: `${fixture.prefix}-revision-1`,
          name: "brief.md",
          parentId: folder.id,
          baseRevision: null,
          clientMutationId: `${fixture.prefix}-write-1`,
          mimeType: "text/markdown",
          sizeBytes: 18,
        },
      });
      expect(firstRevision).toMatchObject({
        path: "/Launch/brief.md",
        latestRevision: { revision: 1, sizeBytes: 18 },
      });
      const secondRevision = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: firstRevision.id,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-2`,
          revisionId: `${fixture.prefix}-revision-2`,
        }),
        nowMs: fixture.nowMs + 2,
        write: {
          spaceId: fixture.spaceId,
          fileId: firstRevision.id,
          revisionId: `${fixture.prefix}-revision-2`,
          baseRevision: 1,
          clientMutationId: `${fixture.prefix}-write-2`,
          mimeType: "text/markdown",
          sizeBytes: 31,
        },
      });
      expect(secondRevision.latestRevision).toMatchObject({
        revision: 2,
        sizeBytes: 31,
      });
      expect(repository.listRevisions(firstRevision.id)).toMatchObject([
        { revision: 2 },
        { revision: 1 },
      ]);
      expect(
        repository.list({
          spaceId: fixture.spaceId,
          parentId: folder.id,
          origin: "all",
          canWrite: true,
        })
      ).toMatchObject({
        breadcrumbs: [
          { id: null, name: "Files" },
          { id: folder.id, name: "Launch" },
        ],
        entries: [{ id: firstRevision.id, kind: "file" }],
        capabilities: { canRead: true, canWrite: true },
      });
    });
  });
  it("defaults the Files list to artifacts, treats a legacy write as an artifact, and fails closed on chat-upload files", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository) => {
      const folder = repository.createFolder({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-folder`,
          fixture,
          operation: "folder_create",
          operationId: `${fixture.prefix}-mkdir`,
        }),
        clientMutationId: `${fixture.prefix}-mkdir`,
        folderId: `${fixture.prefix}-folder`,
        name: "Launch",
        nowMs: fixture.nowMs,
        spaceId: fixture.spaceId,
      });
      const commit = (input: {
        fileId: string;
        name: string;
        origin?: "artifact" | "chat_upload";
        revision: number;
      }) =>
        repository.commitWrite({
          actor,
          auditEvent: createAuditEvent({
            entryId: input.fileId,
            fixture,
            operation: "content_write",
            operationId: `${fixture.prefix}-write-${input.fileId}`,
            revisionId: `${fixture.prefix}-revision-${input.fileId}`,
          }),
          nowMs: fixture.nowMs + input.revision,
          write: {
            spaceId: fixture.spaceId,
            fileId: input.fileId,
            revisionId: `${fixture.prefix}-revision-${input.fileId}`,
            name: input.name,
            parentId: null,
            baseRevision: null,
            clientMutationId: `${fixture.prefix}-write-${input.fileId}`,
            mimeType: "text/plain",
            sizeBytes: 4,
            ...(input.origin ? { origin: input.origin } : {}),
          },
        });
      const artifactFile = commit({
        fileId: `${fixture.prefix}-artifact`,
        name: "brief.txt",
        origin: "artifact",
        revision: 1,
      });
      expect(artifactFile.origin).toBe("artifact");
      const chatUploadFile = commit({
        fileId: `${fixture.prefix}-chat-upload`,
        name: "screenshot.txt",
        origin: "chat_upload",
        revision: 2,
      });
      expect(chatUploadFile.origin).toBe("chat_upload");
      // A legacy client that never learned about `origin` (or an old
      // request that omits it) is not "unclassified": the repository
      // defaults a plain new-file write to 'artifact', matching pre-feature
      // create behavior, so the file stays visible in the default view
      // without the client sending anything new.
      const legacyFile = commit({
        fileId: `${fixture.prefix}-legacy`,
        name: "legacy.txt",
        revision: 3,
      });
      expect(legacyFile.origin).toBe("artifact");
      const defaultList = repository.list({
        spaceId: fixture.spaceId,
        parentId: null,
        canWrite: true,
      });
      expect(defaultList.origin).toBe("artifact");
      expect(defaultList.entries).toMatchObject([
        { id: folder.id, kind: "folder" },
        { id: artifactFile.id, kind: "file" },
        { id: legacyFile.id, kind: "file" },
      ]);
      expect(
        defaultList.entries.some((entry) => entry.id === chatUploadFile.id)
      ).toBe(false);
      const allList = repository.list({
        spaceId: fixture.spaceId,
        parentId: null,
        origin: "all",
        canWrite: true,
      });
      expect(allList.origin).toBe("all");
      expect(allList.entries.map((entry) => entry.id)).toEqual(
        expect.arrayContaining([
          folder.id,
          artifactFile.id,
          chatUploadFile.id,
          legacyFile.id,
        ])
      );
      // A later revision of a chat upload never becomes an artifact by
      // omission; origin is fixed at creation and stays hidden by default.
      const chatUploadRevision = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: chatUploadFile.id,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-chat-upload-2`,
          revisionId: `${fixture.prefix}-revision-chat-upload-2`,
        }),
        nowMs: fixture.nowMs + 10,
        write: {
          spaceId: fixture.spaceId,
          fileId: chatUploadFile.id,
          revisionId: `${fixture.prefix}-revision-chat-upload-2`,
          baseRevision: 1,
          clientMutationId: `${fixture.prefix}-write-chat-upload-2`,
          mimeType: "text/plain",
          sizeBytes: 8,
        },
      });
      expect(chatUploadRevision.origin).toBe("chat_upload");
      expect(
        repository
          .list({ spaceId: fixture.spaceId, parentId: null, canWrite: true })
          .entries.some((entry) => entry.id === chatUploadFile.id)
      ).toBe(false);
    });
  });
  it("fails closed on a NULL origin as exceptional/corrupt data, not normal history", async () => {
    // Every write path now assigns 'artifact' or 'chat_upload' explicitly, and
    // the schema migration backfills every pre-existing row, so the only way
    // a file row can carry a NULL origin today is exceptional/corrupt data
    // (for example a direct database edit). This writes that row directly,
    // bypassing commitWrite, to prove the read path still fails closed
    // instead of guessing a classification.
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository, sql) => {
      const folder = repository.createFolder({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-folder`,
          fixture,
          operation: "folder_create",
          operationId: `${fixture.prefix}-mkdir`,
        }),
        clientMutationId: `${fixture.prefix}-mkdir`,
        folderId: `${fixture.prefix}-folder`,
        name: "Launch",
        nowMs: fixture.nowMs,
        spaceId: fixture.spaceId,
      });
      const corruptFileId = `${fixture.prefix}-corrupt`;
      const actorJson = JSON.stringify(actor);
      sql.exec(
        `
          INSERT INTO space_file_entries (
            entry_id, space_id, kind, parent_id, parent_key, name, name_key,
            created_at_ms, updated_at_ms, created_by_json, updated_by_json,
            trashed_at_ms, trashed_by_json, origin
          ) VALUES (?, ?, 'file', NULL, '', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
        `,
        corruptFileId,
        fixture.spaceId,
        "corrupt.txt",
        "corrupt.txt",
        fixture.nowMs,
        fixture.nowMs,
        actorJson,
        actorJson
      );
      sql.exec(
        `
          INSERT INTO space_file_revisions (
            revision_id, file_id, revision, mime_type, size_bytes,
            created_at_ms, created_by_json, client_mutation_id
          ) VALUES (?, ?, 1, 'text/plain', 4, ?, ?, ?)
        `,
        `${corruptFileId}-revision`,
        corruptFileId,
        fixture.nowMs,
        actorJson,
        `${corruptFileId}-write`
      );
      const defaultList = repository.list({
        spaceId: fixture.spaceId,
        parentId: null,
        canWrite: true,
      });
      expect(
        defaultList.entries.some((entry) => entry.id === corruptFileId)
      ).toBe(false);
      expect(defaultList.entries).toMatchObject([
        { id: folder.id, kind: "folder" },
      ]);
      const allList = repository.list({
        spaceId: fixture.spaceId,
        parentId: null,
        origin: "all",
        canWrite: true,
      });
      const corruptEntry = allList.entries.find(
        (entry) => entry.id === corruptFileId
      );
      expect(corruptEntry).toMatchObject({ kind: "file" });
      expect(
        corruptEntry && "origin" in corruptEntry ? corruptEntry.origin : null
      ).toBeNull();
    });
  });
  it("rejects stale writes with the current file and safely replays identical mutations", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository) => {
      const input = {
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-folder`,
          fixture,
          operation: "folder_create" as const,
          operationId: `${fixture.prefix}-mkdir`,
        }),
        clientMutationId: `${fixture.prefix}-mkdir`,
        folderId: `${fixture.prefix}-folder`,
        name: "Research",
        nowMs: fixture.nowMs,
        spaceId: fixture.spaceId,
      };
      const folder = repository.createFolder(input);
      expect(repository.createFolder(input)).toEqual(folder);
      const file = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-file`,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-1`,
          revisionId: `${fixture.prefix}-revision-1`,
        }),
        nowMs: fixture.nowMs + 1,
        write: {
          spaceId: fixture.spaceId,
          fileId: `${fixture.prefix}-file`,
          revisionId: `${fixture.prefix}-revision-1`,
          name: "notes.txt",
          parentId: folder.id,
          baseRevision: null,
          clientMutationId: `${fixture.prefix}-write-1`,
          mimeType: "text/plain",
          sizeBytes: 5,
        },
      });
      const secondWrite = {
        spaceId: fixture.spaceId,
        fileId: file.id,
        revisionId: `${fixture.prefix}-revision-2`,
        baseRevision: 1,
        clientMutationId: `${fixture.prefix}-write-2`,
        mimeType: "text/plain",
        sizeBytes: 9,
      };
      const secondRevision = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: file.id,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-2`,
          revisionId: `${fixture.prefix}-revision-2`,
        }),
        nowMs: fixture.nowMs + 2,
        write: secondWrite,
      });
      expect(repository.prepareWrite(secondWrite)).toEqual(secondRevision);
      expect(
        repository.resolveCommittedWrite(
          secondWrite.clientMutationId,
          secondRevision.id
        )
      ).toEqual(secondRevision);
      expect(() =>
        repository.resolveCommittedWrite(
          secondWrite.clientMutationId,
          `${fixture.prefix}-other-file`
        )
      ).toThrowError(
        expect.objectContaining<Partial<SpaceFileRepositoryError>>({
          code: "space_file.conflict",
        })
      );
      expect(() =>
        repository.prepareWrite({
          spaceId: fixture.spaceId,
          fileId: file.id,
          revisionId: `${fixture.prefix}-revision-stale`,
          baseRevision: 1,
          clientMutationId: `${fixture.prefix}-write-stale`,
          mimeType: "text/plain",
          sizeBytes: 12,
        })
      ).toThrowError(
        expect.objectContaining<Partial<SpaceFileRepositoryError>>({
          code: "space_file.conflict",
          currentFile: expect.objectContaining({
            latestRevision: expect.objectContaining({ revision: 2 }),
          }),
        })
      );
    });
  });
  it("numbers duplicate folder names while preventing folder cycles and trashing non-empty folders", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository) => {
      const parent = repository.createFolder({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-parent-folder`,
          fixture,
          operation: "folder_create",
          operationId: `${fixture.prefix}-parent`,
        }),
        clientMutationId: `${fixture.prefix}-parent`,
        folderId: `${fixture.prefix}-parent-folder`,
        name: "Product",
        nowMs: fixture.nowMs,
        spaceId: fixture.spaceId,
      });
      const child = repository.createFolder({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-child-folder`,
          fixture,
          operation: "folder_create",
          operationId: `${fixture.prefix}-child`,
        }),
        clientMutationId: `${fixture.prefix}-child`,
        folderId: `${fixture.prefix}-child-folder`,
        name: "Specs",
        nowMs: fixture.nowMs + 1,
        parentId: parent.id,
        spaceId: fixture.spaceId,
      });
      const duplicate = repository.createFolder({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-duplicate-folder`,
          fixture,
          operation: "folder_create",
          operationId: `${fixture.prefix}-duplicate`,
        }),
        clientMutationId: `${fixture.prefix}-duplicate`,
        folderId: `${fixture.prefix}-duplicate-folder`,
        name: "product",
        nowMs: fixture.nowMs + 2,
        spaceId: fixture.spaceId,
      });
      expect(duplicate.name).toBe("product (2)");
      expect(
        repository.createFolder({
          actor,
          auditEvent: createAuditEvent({
            entryId: `${fixture.prefix}-third-folder`,
            fixture,
            operation: "folder_create",
            operationId: `${fixture.prefix}-third`,
          }),
          clientMutationId: `${fixture.prefix}-third`,
          folderId: `${fixture.prefix}-third-folder`,
          name: "Product",
          nowMs: fixture.nowMs + 3,
          spaceId: fixture.spaceId,
        }).name
      ).toBe("Product (3)");
      expect(() =>
        repository.updateEntry({
          actor,
          auditEvent: createAuditEvent({
            entryId: parent.id,
            fixture,
            operation: "entry_update",
            operationId: `${fixture.prefix}-cycle`,
          }),
          body: {
            parentId: child.id,
            clientMutationId: `${fixture.prefix}-cycle`,
          },
          entryId: parent.id,
          nowMs: fixture.nowMs + 3,
        })
      ).toThrowError(
        expect.objectContaining({ code: "space_file.invalid_parent" })
      );
      expect(() =>
        repository.trashEntry({
          actor,
          auditEvent: createAuditEvent({
            entryId: parent.id,
            fixture,
            operation: "entry_trash",
            operationId: `${fixture.prefix}-trash-parent`,
          }),
          clientMutationId: `${fixture.prefix}-trash-parent`,
          entryId: parent.id,
          nowMs: fixture.nowMs + 4,
        })
      ).toThrowError(
        expect.objectContaining({ code: "space_file.folder_not_empty" })
      );
      repository.trashEntry({
        actor,
        auditEvent: createAuditEvent({
          entryId: child.id,
          fixture,
          operation: "entry_trash",
          operationId: `${fixture.prefix}-trash-child`,
        }),
        clientMutationId: `${fixture.prefix}-trash-child`,
        entryId: child.id,
        nowMs: fixture.nowMs + 5,
      });
      repository.trashEntry({
        actor,
        auditEvent: createAuditEvent({
          entryId: parent.id,
          fixture,
          operation: "entry_trash",
          operationId: `${fixture.prefix}-trash-parent-after-child`,
        }),
        clientMutationId: `${fixture.prefix}-trash-parent-after-child`,
        entryId: parent.id,
        nowMs: fixture.nowMs + 6,
      });
      expect(
        repository.list({
          spaceId: fixture.spaceId,
          view: "trash",
          canWrite: true,
        }).entries
      ).toMatchObject([
        { id: parent.id, path: "/Product" },
        { id: child.id, path: "/Product/Specs" },
      ]);
    });
  });
  it("keeps every uploaded file by assigning a collision-safe name", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository) => {
      const firstFile = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-file-1`,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-1`,
          revisionId: `${fixture.prefix}-revision-1`,
        }),
        nowMs: fixture.nowMs,
        write: {
          spaceId: fixture.spaceId,
          fileId: `${fixture.prefix}-file-1`,
          revisionId: `${fixture.prefix}-revision-1`,
          name: "Terminal Screenshot.png",
          parentId: null,
          baseRevision: null,
          clientMutationId: `${fixture.prefix}-write-1`,
          mimeType: "image/png",
          sizeBytes: 1024,
        },
      });
      const secondWrite = {
        spaceId: fixture.spaceId,
        fileId: `${fixture.prefix}-file-2`,
        revisionId: `${fixture.prefix}-revision-2`,
        name: "terminal screenshot.png",
        parentId: null,
        baseRevision: null,
        clientMutationId: `${fixture.prefix}-write-2`,
        mimeType: "image/png",
        sizeBytes: 2048,
      } as const;
      const secondFile = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-file-2`,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-2`,
          revisionId: `${fixture.prefix}-revision-2`,
        }),
        nowMs: fixture.nowMs + 1,
        write: secondWrite,
      });
      const thirdFile = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-file-3`,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-3`,
          revisionId: `${fixture.prefix}-revision-3`,
        }),
        nowMs: fixture.nowMs + 2,
        write: {
          spaceId: fixture.spaceId,
          fileId: `${fixture.prefix}-file-3`,
          revisionId: `${fixture.prefix}-revision-3`,
          name: "TERMINAL SCREENSHOT.PNG",
          parentId: null,
          baseRevision: null,
          clientMutationId: `${fixture.prefix}-write-3`,
          mimeType: "image/png",
          sizeBytes: 4096,
        },
      });
      expect(firstFile.name).toBe("Terminal Screenshot.png");
      expect(secondFile.name).toBe("terminal screenshot (2).png");
      expect(thirdFile.name).toBe("TERMINAL SCREENSHOT (3).PNG");
      expect(
        repository
          .list({
            canWrite: true,
            origin: "all",
            parentId: null,
            spaceId: fixture.spaceId,
          })
          .entries.map((entry) => entry.name)
      ).toEqual(
        expect.arrayContaining([
          "Terminal Screenshot.png",
          "terminal screenshot (2).png",
          "TERMINAL SCREENSHOT (3).PNG",
        ])
      );
      expect(repository.prepareWrite(secondWrite)).toEqual(secondFile);
      const extensionHeavyName = `a.${"x".repeat(SPACE_FILE_MAX_NAME_LENGTH - 2)}`;
      const extensionHeavyFile = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-extension-heavy-file-1`,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-extension-heavy-write-1`,
          revisionId: `${fixture.prefix}-extension-heavy-revision-1`,
        }),
        nowMs: fixture.nowMs + 3,
        write: {
          spaceId: fixture.spaceId,
          fileId: `${fixture.prefix}-extension-heavy-file-1`,
          revisionId: `${fixture.prefix}-extension-heavy-revision-1`,
          name: extensionHeavyName,
          parentId: null,
          baseRevision: null,
          clientMutationId: `${fixture.prefix}-extension-heavy-write-1`,
          mimeType: "application/octet-stream",
          sizeBytes: 1,
        },
      });
      expect(extensionHeavyFile.name).toBe(extensionHeavyName);
      expect(() =>
        repository.commitWrite({
          actor,
          auditEvent: createAuditEvent({
            entryId: `${fixture.prefix}-extension-heavy-file-2`,
            fixture,
            operation: "content_write",
            operationId: `${fixture.prefix}-extension-heavy-write-2`,
            revisionId: `${fixture.prefix}-extension-heavy-revision-2`,
          }),
          nowMs: fixture.nowMs + 4,
          write: {
            spaceId: fixture.spaceId,
            fileId: `${fixture.prefix}-extension-heavy-file-2`,
            revisionId: `${fixture.prefix}-extension-heavy-revision-2`,
            name: extensionHeavyName,
            parentId: null,
            baseRevision: null,
            clientMutationId: `${fixture.prefix}-extension-heavy-write-2`,
            mimeType: "application/octet-stream",
            sizeBytes: 2,
          },
        })
      ).toThrow(
        "OpenMeld could not assign a unique file name without changing its extension."
      );
    });
  });
  it("lists Trash separately and restores the same file with every revision intact", async () => {
    const fixture = createFixture();
    await withRepository(fixture.spaceId, (repository) => {
      const file = repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: `${fixture.prefix}-file`,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-1`,
          revisionId: `${fixture.prefix}-revision-1`,
        }),
        nowMs: fixture.nowMs,
        write: {
          spaceId: fixture.spaceId,
          fileId: `${fixture.prefix}-file`,
          revisionId: `${fixture.prefix}-revision-1`,
          name: "launch-notes.md",
          parentId: null,
          baseRevision: null,
          clientMutationId: `${fixture.prefix}-write-1`,
          mimeType: "text/markdown",
          sizeBytes: 18,
        },
      });
      repository.commitWrite({
        actor,
        auditEvent: createAuditEvent({
          entryId: file.id,
          fixture,
          operation: "content_write",
          operationId: `${fixture.prefix}-write-2`,
          revisionId: `${fixture.prefix}-revision-2`,
        }),
        nowMs: fixture.nowMs + 1,
        write: {
          spaceId: fixture.spaceId,
          fileId: file.id,
          revisionId: `${fixture.prefix}-revision-2`,
          baseRevision: 1,
          clientMutationId: `${fixture.prefix}-write-2`,
          mimeType: "text/markdown",
          sizeBytes: 31,
        },
      });
      repository.trashEntry({
        actor,
        auditEvent: createAuditEvent({
          entryId: file.id,
          fixture,
          operation: "entry_trash",
          operationId: `${fixture.prefix}-trash`,
        }),
        clientMutationId: `${fixture.prefix}-trash`,
        entryId: file.id,
        nowMs: fixture.nowMs + 2,
      });
      expect(
        repository.list({
          spaceId: fixture.spaceId,
          view: "active",
          canWrite: true,
        }).entries
      ).toEqual([]);
      expect(
        repository.list({
          spaceId: fixture.spaceId,
          view: "trash",
          canWrite: true,
        })
      ).toMatchObject({
        view: "trash",
        breadcrumbs: [
          { id: null, name: "Files" },
          { id: null, name: "Trash" },
        ],
        entries: [
          {
            id: file.id,
            name: "launch-notes.md",
            path: "/launch-notes.md",
            trashedAt: new Date(fixture.nowMs + 2).toISOString(),
            trashedBy: actor,
            latestRevision: { revision: 2 },
          },
        ],
      });
      const restored = repository.restoreEntry({
        actor,
        auditEvent: createAuditEvent({
          entryId: file.id,
          fixture,
          operation: "entry_restore",
          operationId: `${fixture.prefix}-restore`,
        }),
        clientMutationId: `${fixture.prefix}-restore`,
        entryId: file.id,
        nowMs: fixture.nowMs + 3,
      });
      expect(restored).toMatchObject({
        id: file.id,
        name: "launch-notes.md",
        trashedAt: null,
        trashedBy: null,
        latestRevision: { revision: 2 },
      });
      expect(repository.listRevisions(file.id)).toMatchObject([
        { revision: 2 },
        { revision: 1 },
      ]);
      expect(
        repository.list({
          spaceId: fixture.spaceId,
          view: "trash",
          canWrite: true,
        }).entries
      ).toEqual([]);
      expect(
        repository.list({
          spaceId: fixture.spaceId,
          view: "active",
          origin: "all",
          canWrite: true,
        }).entries
      ).toMatchObject([{ id: file.id }]);
    });
  });
  it("allows active human members to write and rejects Organization-only users", async () => {
    const fixture = createFixture();
    // Space membership is valid only while its Human owner still belongs to
    // the Organization. Seed that independent Auth fact for the write actor.
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5) ON CONFLICT DO NOTHING',
              values: [],
            },
            values: [
              actor.ownerUserId,
              actor.displayName,
              "files-test@openmeld.test",
              fixture.nowMs,
              fixture.nowMs,
            ],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
              values: [],
            },
            values: ["org-files-test", "Files", "files-test", fixture.nowMs],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4) ON CONFLICT DO NOTHING',
              values: [],
            },
            values: [
              "member-files-test",
              "org-files-test",
              actor.ownerUserId,
              fixture.nowMs,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const durableObjectId = namespace.newUniqueId();
    const spaceId = durableObjectId.toString();
    const stub = namespace.get(durableObjectId);
    await runInDurableObject(stub, async (instance, state) => {
      ensureSpaceSqlSchema(state.storage.sql);
      upsertSpaceMetaRecord(state.storage.sql, {
        v: 1,
        spaceId,
        organizationId: "org-files-test",
        visibility: "private",
        accessMode: "public",
        name: "Space Files Policy",
        createdAt: new Date(fixture.nowMs).toISOString(),
        updatedAt: new Date(fixture.nowMs).toISOString(),
      });
      upsertSpaceMemberRecord(state.storage.sql, {
        spaceId,
        profileId: actor.profileId,
        profileKindSnapshot: actor.profileKind,
        profileNameSnapshot: actor.displayName,
        ownerUserIdSnapshot: actor.ownerUserId ?? null,
        ownerNameSnapshot: actor.displayName,
        controllerRefSnapshot: null,
        status: "active",
        memberSource: "joined_directly",
        addedAt: new Date(fixture.nowMs).toISOString(),
        removedAt: null,
        addedByProfileId: actor.profileId,
        addedByOwnerUserId: actor.ownerUserId ?? null,
        addedByDisplayNameSnapshot: actor.displayName,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: new Date(fixture.nowMs).toISOString(),
        lastEnteredAt: new Date(fixture.nowMs).toISOString(),
        createdAt: new Date(fixture.nowMs).toISOString(),
        updatedAt: new Date(fixture.nowMs).toISOString(),
      });
      await expect(
        instance.rpcCreateSpaceFolder({
          spaceId,
          body: {
            name: "Member work",
            clientMutationId: `${fixture.prefix}-member-write`,
          },
          spaceAccess: createAuthenticatedSpaceAccessContext({
            spaceId,
            requestContext: createRequestContext(actor.profileId),
          }),
        })
      ).resolves.toMatchObject({ folder: { name: "Member work" } });
      const context = createRequestContext(actor.profileId);
      context.actorContext.ownerUserId = actor.ownerUserId;
      const spaceAccess = createAuthenticatedSpaceAccessContext({
        spaceId,
        requestContext: context,
      });
      const file = await instance.rpcCommitSpaceFileWrite({
        spaceAccess,
        write: {
          spaceId,
          fileId: `${fixture.prefix}-settings-file`,
          revisionId: `${fixture.prefix}-settings-revision`,
          clientMutationId: `${fixture.prefix}-settings-write`,
          name: "settings.md",
          parentId: null,
          baseRevision: null,
          mimeType: "text/markdown",
          sizeBytes: 10,
        },
      });
      await expect(
        instance.rpcSpaceFileUpdateSettings({
          spaceId,
          fileId: file.id,
          spaceAccess,
          command: {
            action: "configure",
            baseVersion: 0,
            recipientProfileIds: [actor.profileId],
          },
        })
      ).resolves.toMatchObject({
        version: 1,
        recipientProfileIds: [actor.profileId],
      });
      await expect(
        instance.rpcSpaceFileUpdateSettings({
          spaceId,
          fileId: file.id,
          spaceAccess,
          command: {
            action: "configure",
            baseVersion: 1,
            recipientProfileIds: ["non-member"],
          },
        })
      ).rejects.toMatchObject({
        status: 400,
        code: "space_file.recipient_unavailable",
      });
      await expect(
        instance.rpcSpaceFileUpdateSettings({
          spaceId,
          fileId: file.id,
          spaceAccess: createAuthenticatedSpaceAccessContext({
            spaceId,
            requestContext: createRequestContext(actor.profileId),
          }),
          command: {
            action: "configure",
            baseVersion: 1,
            recipientProfileIds: [],
          },
        })
      ).rejects.toMatchObject({
        status: 403,
        code: "space_file.human_required",
      });
      await expect(
        instance.rpcCreateSpaceFolder({
          spaceId,
          body: {
            name: "Organization-only work",
            clientMutationId: `${fixture.prefix}-non-member-write`,
          },
          spaceAccess: createAuthenticatedSpaceAccessContext({
            spaceId,
            requestContext: createRequestContext("profile-non-member"),
          }),
        })
      ).rejects.toMatchObject({
        code: "space.membership_required",
        status: 403,
      });
      await expect(
        instance.rpcListSpaceFiles({
          spaceId,
          query: { view: "active", origin: "artifact" },
          spaceAccess: createAuthenticatedSpaceAccessContext({
            spaceId,
            requestContext: createRequestContext("profile-non-member"),
          }),
        })
      ).resolves.toMatchObject({
        capabilities: { canRead: true, canWrite: false },
        view: "active",
      });
      await expect(
        instance.rpcListSpaceFiles({
          spaceId,
          query: { view: "trash", origin: "artifact" },
          spaceAccess: createAuthenticatedSpaceAccessContext({
            spaceId,
            requestContext: createRequestContext("profile-non-member"),
          }),
        })
      ).rejects.toMatchObject({
        code: "space.membership_required",
        status: 403,
      });
    });
  });
});
async function withRepository(
  spaceId: string,
  operation: (repository: SpaceFileRepository, sql: SqlStorage) => void
): Promise<void> {
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const stub = namespace.getByName(spaceId);
  await runInDurableObject(stub, (_instance, state) => {
    ensureSpaceSqlSchema(state.storage.sql);
    operation(
      new SpaceFileRepository(
        state.storage as unknown as ConstructorParameters<
          typeof SpaceFileRepository
        >[0]
      ),
      state.storage.sql
    );
  });
}
function createFixture(): {
  nowMs: number;
  prefix: string;
  spaceId: string;
} {
  const prefix = `space-files-${crypto.randomUUID()}`;
  return {
    nowMs: Date.parse("2026-08-22T08:00:00.000Z"),
    prefix,
    spaceId: `${prefix}-space`,
  };
}
function createRequestContext(profileId: string): OpenMeldRequestContext {
  return {
    activeOrganizationId: "org-files-test",
    actorContext: {
      callerPrincipalId: `principal-${profileId}`,
      ownerUserId: `owner-${profileId}`,
      profileKind: "human",
      profileName: "Space Files Tester",
      requestId: `request-${profileId}`,
      openMeldProfileId: profileId,
    },
  };
}
function createAuditEvent(input: {
  entryId: string;
  fixture: ReturnType<typeof createFixture>;
  operation: SpaceFileAuditOperation;
  operationId: string;
  revisionId?: string | null;
}): SpaceFileAuditEvent {
  const requestId = `request-${input.operationId}`;
  return {
    actorKind: "authenticated",
    actorProfileId: actor.profileId,
    entryId: input.entryId,
    errorCode: null,
    eventId: `${input.operation}:${requestId}`,
    occurredAtMs: input.fixture.nowMs,
    operation: input.operation,
    operationId: input.operationId,
    organizationId: "org-files-test",
    representedHumanProfileId: null,
    requestId,
    result: "succeeded",
    revisionId: input.revisionId ?? null,
    spaceId: input.fixture.spaceId,
  };
}
