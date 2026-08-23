import {
  buildSpaceFileObjectKey,
  buildSpaceFileRevisionIdForMutation,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  PrepareSpaceFileWriteResponse,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  trashedAt: null,
  trashedBy: null,
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

afterEach(() => {
  vi.restoreAllMocks();
});

function makeEnv(input?: {
  commitError?: Error;
  objectKey?: string;
  readBytes?: ArrayBuffer;
}) {
  const objectKey = input?.objectKey ?? OBJECT_KEY;
  const stub = {
    rpcPrepareSpaceFileWrite: vi.fn(
      async (request: {
        write: { fileId: string; revisionId: string };
      }): Promise<PrepareSpaceFileWriteResponse> => ({
        fileId: request.write.fileId,
        organizationId: ORGANIZATION_ID,
        revisionId: request.write.revisionId,
        spaceId: SPACE_ID,
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
    rpcCommitSpaceFileWrite: vi.fn((_request: { write: typeof WRITE }) => {
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

  it("leaves an uncommitted R2 object unreachable when the metadata commit conflicts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[1]).not.toHaveProperty("error");
  });

  it("does not delete committed bytes after an uncertain commit response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { bucket, env, stub } = makeEnv();
    const uncertainCommit = new Error(
      "Space commit response was lost for launch-notes.md"
    );
    stub.rpcCommitSpaceFileWrite.mockImplementationOnce(() => {
      stub.rpcPrepareSpaceFileWrite.mockResolvedValue({
        committedFile: FILE,
        fileId: FILE_ID,
        objectKey: OBJECT_KEY,
        organizationId: ORGANIZATION_ID,
        revisionId: REVISION_ID,
        spaceId: SPACE_ID,
      });
      return Promise.reject(uncertainCommit);
    });

    await expect(
      rpcWriteSpaceFileContent(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        spaceId: SPACE_ID,
        write: WRITE,
      })
    ).rejects.toBe(uncertainCommit);
    await expect(
      rpcWriteSpaceFileContent(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        spaceId: SPACE_ID,
        write: WRITE,
      })
    ).resolves.toEqual(FILE);

    expect(bucket.delete).not.toHaveBeenCalled();
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1]).not.toHaveProperty("error");
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
    const committedWrite =
      stub.rpcCommitSpaceFileWrite.mock.calls[0]?.[0].write;
    if (!committedWrite) {
      throw new Error("Expected the restored revision to be committed.");
    }
    expect(committedWrite.revisionId).toBe(
      await buildSpaceFileRevisionIdForMutation({
        baseRevision: 1,
        bytes: Uint8Array.from(BYTES).buffer,
        clientMutationId: "restore-version-1",
        mimeType: REVISION.mimeType,
      })
    );
  });
});
