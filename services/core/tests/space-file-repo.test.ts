import { env, runInDurableObject } from "cloudflare:test";
import type {
  OpenMeldRequestContext,
  SpaceFileActor,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  SpaceFileRepository,
  type SpaceFileRepositoryError,
} from "../src/space/infrastructure/sql/space-file-repo";
import { upsertSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import type { Space } from "../src/space/transport/do/space";

const actor: SpaceFileActor = {
  profileId: "profile-human-files-test",
  profileKind: "human",
  displayName: "Avery Stone",
  ownerUserId: "user-files-test",
};

describe("SpaceFileRepository", () => {
  it("stores folders, immutable file revisions, paths, and actor attribution in Space SQLite", async () => {
    const fixture = createFixture();

    await withRepository(fixture.spaceId, (repository) => {
      const folder = repository.createFolder({
        actor,
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

  it("rejects stale writes with the current file and safely replays identical mutations", async () => {
    const fixture = createFixture();

    await withRepository(fixture.spaceId, (repository) => {
      const input = {
        actor,
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
        nowMs: fixture.nowMs + 2,
        write: secondWrite,
      });
      expect(repository.prepareWrite(secondWrite)).toEqual(secondRevision);

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

  it("prevents duplicate names, folder cycles, and trashing non-empty folders", async () => {
    const fixture = createFixture();

    await withRepository(fixture.spaceId, (repository) => {
      const parent = repository.createFolder({
        actor,
        clientMutationId: `${fixture.prefix}-parent`,
        folderId: `${fixture.prefix}-parent-folder`,
        name: "Product",
        nowMs: fixture.nowMs,
        spaceId: fixture.spaceId,
      });
      const child = repository.createFolder({
        actor,
        clientMutationId: `${fixture.prefix}-child`,
        folderId: `${fixture.prefix}-child-folder`,
        name: "Specs",
        nowMs: fixture.nowMs + 1,
        parentId: parent.id,
        spaceId: fixture.spaceId,
      });

      expect(() =>
        repository.createFolder({
          actor,
          clientMutationId: `${fixture.prefix}-duplicate`,
          folderId: `${fixture.prefix}-duplicate-folder`,
          name: "product",
          nowMs: fixture.nowMs + 2,
          spaceId: fixture.spaceId,
        })
      ).toThrowError(
        expect.objectContaining({ code: "space_file.name_conflict" })
      );
      expect(() =>
        repository.updateEntry({
          actor,
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
          clientMutationId: `${fixture.prefix}-trash-parent`,
          entryId: parent.id,
          nowMs: fixture.nowMs + 4,
        })
      ).toThrowError(
        expect.objectContaining({ code: "space_file.folder_not_empty" })
      );
    });
  });

  it("lists Trash separately and restores the same file with every revision intact", async () => {
    const fixture = createFixture();

    await withRepository(fixture.spaceId, (repository) => {
      const file = repository.commitWrite({
        actor,
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
          canWrite: true,
        }).entries
      ).toMatchObject([{ id: file.id }]);
    });
  });

  it("allows active human members to write and rejects Organization-only users", async () => {
    const fixture = createFixture();
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
          query: { view: "active" },
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
          query: { view: "trash" },
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
  operation: (repository: SpaceFileRepository) => void
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
      )
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
