import {
  buildSpaceComposerPublishedFileId,
  buildSpaceComposerUploadObjectKey,
  buildSpaceFileObjectKey,
  SPACE_COMPOSER_UPLOAD_TTL_MS,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  PrepareSpaceFileWriteResponse,
  ResolveSpaceComposerUploadScopeResponse,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcDiscardSpaceComposerUpload,
  rpcPublishSpaceComposerUpload,
  rpcStageSpaceComposerUpload,
} from "../src/rpc/methods";
import { deleteExpiredSpaceComposerUploads } from "../src/space/application/space-composer-upload-storage";

const SPACE_ID = "a".repeat(64);
const ORGANIZATION_ID = "org-composer-upload-test";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "file-composer-upload-test";
const REVISION_ID = "revision-composer-upload-test";
const NOW_MS = Date.parse("2026-08-29T08:00:00.000Z");
const EXPIRES_AT_MS = NOW_MS + SPACE_COMPOSER_UPLOAD_TTL_MS;
const BYTES = new TextEncoder().encode("Composer attachment\n");
const CONTEXT: OpenMeldRequestContext = {
  activeOrganizationId: ORGANIZATION_ID,
  actorContext: {
    requestId: "request-composer-upload-test",
    openMeldProfileId: PROFILE_ID,
    profileKind: "human",
    profileName: "Mira Stone",
    ownerUserId: "owner-composer-upload-test",
    callerPrincipalId: "owner-composer-upload-test",
  },
};
const SCOPE: ResolveSpaceComposerUploadScopeResponse = {
  actorProfileId: PROFILE_ID,
  organizationId: ORGANIZATION_ID,
};
const ACTOR = {
  profileId: PROFILE_ID,
  profileKind: "human" as const,
  displayName: "Mira Stone",
  ownerUserId: "owner-composer-upload-test",
};
const FILE = {
  id: FILE_ID,
  spaceId: SPACE_ID,
  parentId: null,
  name: "notes.txt",
  path: "/notes.txt",
  kind: "file" as const,
  createdAt: "2026-08-29T08:00:00.000Z",
  updatedAt: "2026-08-29T08:00:00.000Z",
  createdBy: ACTOR,
  updatedBy: ACTOR,
  trashedAt: null,
  trashedBy: null,
  latestRevision: {
    id: REVISION_ID,
    fileId: FILE_ID,
    revision: 1,
    mimeType: "text/plain",
    sizeBytes: BYTES.byteLength,
    createdAt: "2026-08-29T08:00:00.000Z",
    createdBy: ACTOR,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

function createStageMetadata(expiresAtMs = EXPIRES_AT_MS) {
  return {
    actorProfileId: PROFILE_ID,
    expiresAtMs: String(expiresAtMs),
    mimeType: "text/plain",
    name: "notes.txt",
    organizationId: ORGANIZATION_ID,
    sizeBytes: String(BYTES.byteLength),
    spaceId: SPACE_ID,
    uploadId: UPLOAD_ID,
  };
}

function makeEnv(input?: { expiresAtMs?: number }) {
  const stub = {
    rpcResolveSpaceComposerUploadScope: vi.fn(async () => SCOPE),
    rpcResolveCommittedSpaceFileWrite: vi.fn(
      async (): Promise<typeof FILE | null> => null
    ),
    rpcPrepareSpaceFileWrite: vi.fn(
      async (request: {
        write: { fileId: string; revisionId: string };
      }): Promise<PrepareSpaceFileWriteResponse> => ({
        fileId: request.write.fileId,
        organizationId: ORGANIZATION_ID,
        revisionId: request.write.revisionId,
        spaceId: SPACE_ID,
        objectKey: buildSpaceFileObjectKey({
          organizationId: ORGANIZATION_ID,
          spaceId: SPACE_ID,
          fileId: request.write.fileId,
          revisionId: request.write.revisionId,
        }),
      })
    ),
    rpcCommitSpaceFileWrite: vi.fn(async () => FILE),
    rpcRecordSpaceFileAuditEvent: vi.fn(async () => undefined),
  };
  const bucket = {
    put: vi.fn(async (): Promise<R2Object | null> => ({}) as R2Object),
    get: vi.fn(async () => ({
      arrayBuffer: async () => Uint8Array.from(BYTES).buffer,
      customMetadata: createStageMetadata(input?.expiresAtMs),
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

describe("Core Space Composer upload RPC", () => {
  it("stages temporary bytes without committing a canonical Space File", async () => {
    const { bucket, env, stub } = makeEnv();

    await expect(
      rpcStageSpaceComposerUpload(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        mimeType: "text/plain",
        name: "notes.txt",
        nowMs: NOW_MS,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).resolves.toEqual({
      id: UPLOAD_ID,
      expiresAt: new Date(EXPIRES_AT_MS).toISOString(),
      mimeType: "text/plain",
      name: "notes.txt",
      sizeBytes: BYTES.byteLength,
    });

    expect(bucket.put).toHaveBeenCalledWith(
      buildSpaceComposerUploadObjectKey({
        actorProfileId: PROFILE_ID,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      }),
      expect.any(ArrayBuffer),
      expect.objectContaining({ customMetadata: createStageMetadata() })
    );
    expect(stub.rpcPrepareSpaceFileWrite).not.toHaveBeenCalled();
    expect(stub.rpcCommitSpaceFileWrite).not.toHaveBeenCalled();
  });

  it("preserves the first expiry when an exact stage request replays", async () => {
    const { bucket, env } = makeEnv();
    bucket.put.mockResolvedValue(null);

    await expect(
      rpcStageSpaceComposerUpload(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        mimeType: "text/plain",
        name: "notes.txt",
        nowMs: NOW_MS + 1000,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).resolves.toEqual({
      id: UPLOAD_ID,
      expiresAt: new Date(EXPIRES_AT_MS).toISOString(),
      mimeType: "text/plain",
      name: "notes.txt",
      sizeBytes: BYTES.byteLength,
    });

    expect(bucket.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        onlyIf: { etagDoesNotMatch: "*" },
      })
    );
    expect(bucket.get).toHaveBeenCalledOnce();
  });

  it("rejects a different payload that reuses a staged upload identity", async () => {
    const { bucket, env } = makeEnv();
    bucket.put.mockResolvedValue(null);

    await expect(
      rpcStageSpaceComposerUpload(env, {
        bytes: Uint8Array.from(new TextEncoder().encode("Different bytes\n"))
          .buffer,
        context: CONTEXT,
        mimeType: "text/plain",
        name: "different.txt",
        nowMs: NOW_MS + 1000,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).rejects.toMatchObject({
      code: "space_file.conflict",
      status: 409,
    });

    expect(bucket.get).toHaveBeenCalledOnce();
  });

  it("publishes staged bytes as a canonical root Space File on Send", async () => {
    const { bucket, env, stub } = makeEnv();

    await expect(
      rpcPublishSpaceComposerUpload(env, {
        clientMutationId: "publish-composer-upload-test",
        context: CONTEXT,
        nowMs: NOW_MS,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).resolves.toEqual(FILE);

    expect(bucket.get).toHaveBeenCalledWith(
      buildSpaceComposerUploadObjectKey({
        actorProfileId: PROFILE_ID,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    );
    expect(stub.rpcPrepareSpaceFileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        write: expect.objectContaining({
          baseRevision: null,
          clientMutationId: "publish-composer-upload-test",
          mimeType: "text/plain",
          name: "notes.txt",
          parentId: null,
          sizeBytes: BYTES.byteLength,
          spaceId: SPACE_ID,
        }),
      })
    );
    expect(stub.rpcCommitSpaceFileWrite).toHaveBeenCalledOnce();
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("replays a committed publication after its temporary upload is gone", async () => {
    const { bucket, env, stub } = makeEnv();
    stub.rpcResolveCommittedSpaceFileWrite.mockResolvedValue(FILE);

    await expect(
      rpcPublishSpaceComposerUpload(env, {
        clientMutationId: "publish-composer-upload-test",
        context: CONTEXT,
        nowMs: NOW_MS,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).resolves.toEqual(FILE);

    expect(stub.rpcResolveCommittedSpaceFileWrite).toHaveBeenCalledWith({
      clientMutationId: "publish-composer-upload-test",
      expectedFileId: await buildSpaceComposerPublishedFileId({
        clientMutationId: "publish-composer-upload-test",
        uploadId: UPLOAD_ID,
      }),
      spaceAccess: expect.any(Object),
      spaceId: SPACE_ID,
    });
    expect(bucket.get).not.toHaveBeenCalled();
    expect(stub.rpcPrepareSpaceFileWrite).not.toHaveBeenCalled();
    expect(stub.rpcCommitSpaceFileWrite).not.toHaveBeenCalled();
  });

  it("publishes with the longest valid client mutation identity", async () => {
    const { bucket, env, stub } = makeEnv();
    const clientMutationId = "m".repeat(128);
    stub.rpcResolveCommittedSpaceFileWrite.mockResolvedValue(FILE);

    await expect(
      rpcPublishSpaceComposerUpload(env, {
        clientMutationId,
        context: CONTEXT,
        nowMs: NOW_MS,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).resolves.toEqual(FILE);

    expect(stub.rpcResolveCommittedSpaceFileWrite).toHaveBeenCalledWith({
      clientMutationId,
      expectedFileId: expect.any(String),
      spaceAccess: expect.any(Object),
      spaceId: SPACE_ID,
    });
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("discards only the current actor's temporary upload", async () => {
    const { bucket, env } = makeEnv();

    await expect(
      rpcDiscardSpaceComposerUpload(env, {
        context: CONTEXT,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).resolves.toEqual({ discarded: true, uploadId: UPLOAD_ID });

    expect(bucket.delete).toHaveBeenCalledWith(
      buildSpaceComposerUploadObjectKey({
        actorProfileId: PROFILE_ID,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    );
  });

  it("rejects and deletes an expired upload before publication", async () => {
    const { bucket, env, stub } = makeEnv({ expiresAtMs: NOW_MS - 1 });

    await expect(
      rpcPublishSpaceComposerUpload(env, {
        clientMutationId: "publish-expired-composer-upload-test",
        context: CONTEXT,
        nowMs: NOW_MS,
        spaceId: SPACE_ID,
        uploadId: UPLOAD_ID,
      })
    ).rejects.toMatchObject({
      code: "space_file.not_found",
      status: 404,
    });

    expect(bucket.delete).toHaveBeenCalledOnce();
    expect(stub.rpcPrepareSpaceFileWrite).not.toHaveBeenCalled();
    expect(stub.rpcCommitSpaceFileWrite).not.toHaveBeenCalled();
  });

  it("deletes expired staged uploads while preserving active ones", async () => {
    const bucket = {
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => ({
        cursor: undefined,
        delimitedPrefixes: [],
        objects: [
          {
            customMetadata: createStageMetadata(NOW_MS - 1),
            key: "composer-uploads/v1/expired",
          },
          {
            customMetadata: createStageMetadata(NOW_MS + 1),
            key: "composer-uploads/v1/active",
          },
          {
            customMetadata: { expiresAtMs: "not-a-date" },
            key: "composer-uploads/v1/invalid",
          },
        ],
        truncated: false,
      })),
    } as unknown as R2Bucket;

    await expect(
      deleteExpiredSpaceComposerUploads({ bucket, nowMs: NOW_MS })
    ).resolves.toEqual({ deleted: 2, scanned: 3 });

    expect(bucket.delete).toHaveBeenCalledWith([
      "composer-uploads/v1/expired",
      "composer-uploads/v1/invalid",
    ]);
  });
});
