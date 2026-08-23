import { buildSpaceFileObjectKey } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { createCoreRpcHttpError } from "../src/rpc/errors";
import {
  rpcReadSpaceFileContent,
  rpcRestoreSpaceFileRevision,
  rpcWriteSpaceFileContent,
} from "../src/rpc/methods";

const SPACE_ID = "a".repeat(64);
const ORGANIZATION_ID = "org-files-test";
const FILE_ID = "file-files-test";
const REVISION_ID = "revision-files-test";
const OBJECT_KEY = buildSpaceFileObjectKey({
  organizationId: ORGANIZATION_ID,
  spaceId: SPACE_ID,
  fileId: FILE_ID,
  revisionId: REVISION_ID,
});
const BYTES = new TextEncoder().encode("Shared launch notes\n");
const CONTEXT: OpenMeldRequestContext = {
  activeOrganizationId: ORGANIZATION_ID,
  actorContext: {
    requestId: "request-files-test",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    profileKind: "human",
    profileName: "Mira Stone",
    ownerUserId: "owner-files-test",
    callerPrincipalId: "owner-files-test",
  },
};
const ACTOR = {
  profileId: CONTEXT.actorContext.openMeldProfileId,
  profileKind: "human" as const,
  displayName: "Mira Stone",
  ownerUserId: "owner-files-test",
};
const REVISION = {
  id: REVISION_ID,
  fileId: FILE_ID,
  revision: 1,
  mimeType: "text/markdown",
  sizeBytes: BYTES.byteLength,
  createdAt: "2026-08-22T08:00:00.000Z",
  createdBy: ACTOR,
};
const FILE = {
  id: FILE_ID,
  spaceId: SPACE_ID,
  parentId: null,
  name: "launch-notes.md",
  path: "/launch-notes.md",
  kind: "file" as const,
  createdAt: "2026-08-22T08:00:00.000Z",
  updatedAt: "2026-08-22T08:00:00.000Z",
  createdBy: ACTOR,
  updatedBy: ACTOR,
  latestRevision: REVISION,
};
const WRITE = {
  spaceId: SPACE_ID,
  fileId: FILE_ID,
  revisionId: REVISION_ID,
  name: FILE.name,
  parentId: null,
  baseRevision: null,
  clientMutationId: "mutation-files-test",
  mimeType: REVISION.mimeType,
  sizeBytes: BYTES.byteLength,
};

function makeEnv(input?: {
  commitError?: Error;
  objectKey?: string;
  readBytes?: ArrayBuffer;
}) {
  const objectKey = input?.objectKey ?? OBJECT_KEY;
  const stub = {
    rpcPrepareSpaceFileWrite: vi.fn(
      async (request: { write: { fileId: string; revisionId: string } }) => ({
        organizationId: ORGANIZATION_ID,
        objectKey:
          input?.objectKey ??
          buildSpaceFileObjectKey({
            organizationId: ORGANIZATION_ID,
            spaceId: SPACE_ID,
            fileId: request.write.fileId,
            revisionId: request.write.revisionId,
          }),
      })
    ),
    rpcCommitSpaceFileWrite: vi.fn(() => {
      if (input?.commitError) {
        return Promise.reject(input.commitError);
      }
      return Promise.resolve(FILE);
    }),
    rpcResolveSpaceFileContent: vi.fn(async () => ({
      organizationId: ORGANIZATION_ID,
      objectKey,
      file: FILE,
      revision: REVISION,
    })),
  };
  const bucket = {
    put: vi.fn(async () => null),
    get: vi.fn(async () => ({
      arrayBuffer: async () =>
        input?.readBytes ?? Uint8Array.from(BYTES).buffer,
    })),
    delete: vi.fn(async () => undefined),
  };
  const namespace = {
    idFromString: vi.fn(() => ({ toString: () => SPACE_ID })),
    get: vi.fn(() => stub),
  };
  return {
    bucket,
    env: {
      OPENMELD_SPACES: namespace,
      OPENMELD_SPACE_ATTACHMENTS: bucket,
    } as unknown as CoreBindings,
    stub,
  };
}

describe("Core Space file content RPC", () => {
  it("prepares metadata, stores immutable bytes, and commits one revision", async () => {
    const { bucket, env, stub } = makeEnv();

    await expect(
      rpcWriteSpaceFileContent(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        spaceId: SPACE_ID,
        write: WRITE,
      })
    ).resolves.toEqual(FILE);

    expect(stub.rpcPrepareSpaceFileWrite).toHaveBeenCalledOnce();
    expect(bucket.put).toHaveBeenCalledWith(
      OBJECT_KEY,
      expect.any(ArrayBuffer),
      expect.objectContaining({
        customMetadata: {
          fileId: FILE_ID,
          revisionId: REVISION_ID,
          spaceId: SPACE_ID,
        },
      })
    );
    expect(stub.rpcCommitSpaceFileWrite).toHaveBeenCalledOnce();
  });

  it("removes an uncommitted R2 object when the metadata commit conflicts", async () => {
    const conflict = createCoreRpcHttpError({
      status: 409,
      code: "space_file.conflict",
      reason: "This file changed after you opened it.",
    });
    const { bucket, env } = makeEnv({ commitError: conflict });

    await expect(
      rpcWriteSpaceFileContent(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        spaceId: SPACE_ID,
        write: WRITE,
      })
    ).rejects.toBe(conflict);
    expect(bucket.delete).toHaveBeenCalledWith(OBJECT_KEY);
  });

  it("authorizes metadata before reading the matching R2 revision", async () => {
    const { bucket, env, stub } = makeEnv();

    const result = await rpcReadSpaceFileContent(env, {
      content: { spaceId: SPACE_ID, fileId: FILE_ID },
      context: CONTEXT,
      spaceId: SPACE_ID,
    });

    expect(stub.rpcResolveSpaceFileContent).toHaveBeenCalledOnce();
    expect(bucket.get).toHaveBeenCalledWith(OBJECT_KEY);
    expect(new Uint8Array(result.bytes)).toEqual(BYTES);
  });

  it("fails closed before R2 when metadata points outside the file scope", async () => {
    const { bucket, env } = makeEnv({ objectKey: "org/wrong/file" });

    await expect(
      rpcReadSpaceFileContent(env, {
        content: { spaceId: SPACE_ID, fileId: FILE_ID },
        context: CONTEXT,
        spaceId: SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "upstream_unreachable",
      status: 502,
    });
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("restores old bytes as a new conflict-safe current revision", async () => {
    const restoredFile = {
      ...FILE,
      latestRevision: {
        ...REVISION,
        id: "restored-revision-id",
        revision: 2,
      },
    };
    const { bucket, env, stub } = makeEnv();
    stub.rpcCommitSpaceFileWrite.mockResolvedValueOnce(restoredFile);

    await expect(
      rpcRestoreSpaceFileRevision(env, {
        body: {
          baseRevision: 1,
          clientMutationId: "restore-version-1",
        },
        context: CONTEXT,
        fileId: FILE_ID,
        revision: 1,
        spaceId: SPACE_ID,
      })
    ).resolves.toEqual(restoredFile);

    expect(stub.rpcResolveSpaceFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          fileId: FILE_ID,
          revision: 1,
        }),
      })
    );
    expect(bucket.put).toHaveBeenCalledWith(
      expect.stringContaining(`/files/${FILE_ID}/revisions/`),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: { contentType: REVISION.mimeType },
      })
    );
    expect(stub.rpcCommitSpaceFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        write: expect.objectContaining({
          baseRevision: 1,
          clientMutationId: "restore-version-1",
          mimeType: REVISION.mimeType,
          sizeBytes: BYTES.byteLength,
        }),
      })
    );
  });
});
