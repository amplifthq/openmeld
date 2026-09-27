import {
  OPENMELD_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
import {
  buildSpaceFileObjectKey,
  buildSpaceFileRevisionIdForMutation,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceFileAuditEventSchema,
  spaceFileRevisionSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  PrepareSpaceFileWriteResponse,
  SpaceFileAuditEvent,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentRpcEntrypoint, GatewayRpcEntrypoint } from "../src/index";
import type { CoreBindings } from "../src/lib/bindings";
import { createCoreRpcHttpError } from "../src/rpc/errors";
import {
  rpcReadSpaceFileContent,
  rpcRestoreSpaceFileRevision,
  rpcStreamSpaceFileContent,
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
  imageDimensions: { width: 300, height: 900 },
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
  origin: "artifact" as const,
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
  committedFile?: typeof FILE;
  commitError?: Error;
  getError?: Error;
  objectKey?: string;
  putError?: Error;
  readBytes?: ArrayBuffer;
}) {
  const objectKey = input?.objectKey ?? OBJECT_KEY;
  const stub = {
    rpcFilePins: vi.fn(async () => ({
      pins: [
        {
          file: FILE,
          pinnedByProfileId: CONTEXT.actorContext.openMeldProfileId,
          pinnedByName: "Mira Stone",
          pinnedAt: FILE.createdAt,
        },
      ],
    })),
    rpcPrepareSpaceFileWrite: vi.fn(
      async (request: {
        write: { fileId: string; revisionId: string };
      }): Promise<PrepareSpaceFileWriteResponse> => ({
        ...(input?.committedFile ? { committedFile: input.committedFile } : {}),
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
    rpcRecordSpaceFileAuditEvent: vi.fn(async () => undefined),
  };
  const bucket = {
    put: vi.fn(() => {
      if (input?.putError) {
        return Promise.reject(input.putError);
      }
      return Promise.resolve(null);
    }),
    head: vi.fn(async () => ({ size: (input?.readBytes ?? BYTES).byteLength })),
    get: vi.fn(
      (
        _key: string,
        options?: { range?: { offset: number; length: number } }
      ) => {
        if (input?.getError) {
          return Promise.reject(input.getError);
        }
        return Promise.resolve({
          size: (input?.readBytes ?? BYTES).byteLength,
          body: options?.range
            ? new Blob([input?.readBytes ?? BYTES])
                .slice(
                  options.range.offset,
                  options.range.offset + options.range.length
                )
                .stream()
            : new Blob([input?.readBytes ?? BYTES]).stream(),
          arrayBuffer: async () =>
            input?.readBytes ?? Uint8Array.from(BYTES).buffer,
        });
      }
    ),
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
  it("gives two file reads in one request distinct audit identities while preserving the request correlation", async () => {
    const { env, stub } = makeEnv();
    const events: SpaceFileAuditEvent[] = [];
    stub.rpcRecordSpaceFileAuditEvent.mockImplementation(
      (...args: unknown[]) => {
        const event = spaceFileAuditEventSchema.parse(
          (args[0] as { event: unknown }).event
        );
        if (events.some((previous) => previous.eventId === event.eventId)) {
          return Promise.reject(new Error("duplicate audit event"));
        }
        events.push(event);
        return Promise.resolve(undefined);
      }
    );
    for (const fileId of [FILE_ID, "second-file"]) {
      const revision = { ...REVISION, fileId };
      stub.rpcResolveSpaceFileContent.mockResolvedValueOnce({
        organizationId: ORGANIZATION_ID,
        objectKey: buildSpaceFileObjectKey({
          organizationId: ORGANIZATION_ID,
          spaceId: SPACE_ID,
          fileId,
          revisionId: REVISION_ID,
        }),
        file: { ...FILE, id: fileId, latestRevision: revision },
        revision,
      });
      const result = await rpcStreamSpaceFileContent(env, {
        context: CONTEXT,
        spaceId: SPACE_ID,
        content: { spaceId: SPACE_ID, fileId, revision: 1 },
      });
      expect(await new Response(result.bytes).text()).toBe(
        "Shared launch notes\n"
      );
    }
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
    expect(new Set(events.map((event) => event.operationId)).size).toBe(2);
    expect(events.map((event) => event.requestId)).toEqual([
      CONTEXT.actorContext.requestId,
      CONTEXT.actorContext.requestId,
    ]);
    expect(events.map((event) => event.entryId)).toEqual([
      FILE_ID,
      "second-file",
    ]);
  });

  it("keeps the buffered write path capped when the Space file limit grows", async () => {
    const { env, stub } = makeEnv();
    await expect(
      rpcWriteSpaceFileContent(env, {
        bytes: new ArrayBuffer(0),
        context: CONTEXT,
        spaceId: SPACE_ID,
        write: { ...WRITE, sizeBytes: SPACE_FILE_RAW_UPLOAD_MAX_BYTES + 1 },
      })
    ).rejects.toThrow("Use multipart upload");
    expect(stub.rpcPrepareSpaceFileWrite).not.toHaveBeenCalled();
  });
  it("authorizes the exact revision and requests only its R2 range without buffering", async () => {
    const { env, bucket, stub } = makeEnv();
    const result = await rpcStreamSpaceFileContent(
      env,
      {
        context: CONTEXT,
        spaceId: SPACE_ID,
        content: { spaceId: SPACE_ID, fileId: FILE_ID, revision: 1 },
      },
      { range: "bytes=7-12" }
    );
    expect(result.stream).toEqual({
      status: 206,
      etag: `"${REVISION_ID}"`,
      offset: 7,
      length: 6,
    });
    expect(bucket.get).toHaveBeenCalledWith(OBJECT_KEY, {
      range: { offset: 7, length: 6 },
    });
    expect(stub.rpcResolveSpaceFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { spaceId: SPACE_ID, fileId: FILE_ID, revision: 1 },
      })
    );
    expect(await new Response(result.bytes).text()).toBe("launch");
    expect(stub.rpcRecordSpaceFileAuditEvent).toHaveBeenCalledOnce();
  });

  it("does not open file bytes for HEAD, rejected ranges, or access denial", async () => {
    const { env, bucket, stub } = makeEnv();
    const input = {
      context: CONTEXT,
      spaceId: SPACE_ID,
      content: { spaceId: SPACE_ID, fileId: FILE_ID, revision: 1 },
    };
    const head = await rpcStreamSpaceFileContent(env, input, {
      head: true,
      range: "bytes=0-1",
    });
    expect(head.stream?.status).toBe(200);
    expect(await new Response(head.bytes).text()).toBe("");
    expect(bucket.head).toHaveBeenCalledWith(OBJECT_KEY);
    const rejected = await rpcStreamSpaceFileContent(env, input, {
      range: "bytes=900-",
    });
    expect(rejected.stream?.status).toBe(416);
    expect(await new Response(rejected.bytes).text()).toBe("");
    stub.rpcResolveSpaceFileContent.mockRejectedValueOnce(
      new Error("Access denied")
    );
    await expect(
      rpcStreamSpaceFileContent(env, input, { range: "bytes=0-1" })
    ).rejects.toThrow("Access denied");
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("does not add opt-in stream metadata to legacy RPC results", async () => {
    const { env } = makeEnv();
    const result = await rpcStreamSpaceFileContent(env, {
      context: CONTEXT,
      spaceId: SPACE_ID,
      content: { spaceId: SPACE_ID, fileId: FILE_ID },
    });
    expect(result).not.toHaveProperty("stream");
    expect(await new Response(result.bytes).text()).toBe(
      "Shared launch notes\n"
    );
  });

  it("negotiates geometry for Gateway callers while legacy Gateway and Remote Agent retain their revision contract", async () => {
    const { env } = makeEnv({ committedFile: FILE });
    const request = {
      bytes: Uint8Array.from(BYTES).buffer,
      context: CONTEXT,
      spaceId: SPACE_ID,
      write: WRITE,
    };
    const gateway = Object.create(
      GatewayRpcEntrypoint.prototype
    ) as GatewayRpcEntrypoint;
    const remote = Object.create(
      CenterAgentRpcEntrypoint.prototype
    ) as CenterAgentRpcEntrypoint;
    Reflect.set(gateway, "env", env);
    Reflect.set(remote, "env", env);
    const visible = await gateway.writeSpaceFileContent(
      request,
      OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    const legacy = await gateway.writeSpaceFileContent(
      request,
      OPENMELD_SPACE_FILES_ORIGIN_VERSION
    );
    const wire = await remote.writeSpaceFileContent(
      request,
      OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    expect(visible.latestRevision.imageDimensions).toEqual(
      REVISION.imageDimensions
    );
    expect(wire.latestRevision).not.toHaveProperty("imageDimensions");
    const legacyRevision = spaceFileRevisionSchema
      .omit({ imageDimensions: true })
      .strict();
    expect(legacyRevision.safeParse(visible.latestRevision).success).toBe(
      false
    );
    expect(legacyRevision.safeParse(legacy.latestRevision).success).toBe(true);
    expect(legacyRevision.safeParse(wire.latestRevision).success).toBe(true);
    const replay = await gateway.prepareSpaceFileWrite(request);
    const currentReplay = await gateway.prepareSpaceFileWrite(
      request,
      OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    expect(
      legacyRevision.safeParse(replay.committedFile?.latestRevision).success
    ).toBe(true);
    expect(currentReplay.committedFile?.latestRevision.imageDimensions).toEqual(
      REVISION.imageDimensions
    );
    const legacyPins = await gateway.spaceFilePins(request);
    const currentPins = await gateway.spaceFilePins(
      request,
      OPENMELD_SPACE_FILES_ORIGIN_VERSION,
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
    );
    expect(
      legacyRevision.safeParse(legacyPins.pins[0]?.file.latestRevision).success
    ).toBe(true);
    expect(currentPins.pins[0]?.file.latestRevision.imageDimensions).toEqual(
      REVISION.imageDimensions
    );
    expect(FILE.latestRevision.imageDimensions).toEqual({
      width: 300,
      height: 900,
    });
  });

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
    expect(stub.rpcRecordSpaceFileAuditEvent).not.toHaveBeenCalled();
  });

  it("audits a replayed write without storing the same bytes again", async () => {
    const { bucket, env, stub } = makeEnv({ committedFile: FILE });

    await expect(
      rpcWriteSpaceFileContent(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        spaceId: SPACE_ID,
        write: WRITE,
      })
    ).resolves.toEqual(FILE);

    expect(bucket.put).not.toHaveBeenCalled();
    expect(stub.rpcCommitSpaceFileWrite).not.toHaveBeenCalled();
    expect(stub.rpcRecordSpaceFileAuditEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        actorKind: "authenticated",
        actorProfileId: CONTEXT.actorContext.openMeldProfileId,
        entryId: FILE_ID,
        errorCode: null,
        operation: "content_write",
        operationId: WRITE.clientMutationId,
        organizationId: ORGANIZATION_ID,
        requestId: CONTEXT.actorContext.requestId,
        result: "succeeded",
        revisionId: REVISION_ID,
        spaceId: SPACE_ID,
      }),
    });
  });

  it("audits a failed R2 write before returning the storage failure", async () => {
    const { env, stub } = makeEnv({ putError: new Error("R2 unavailable") });

    await expect(
      rpcWriteSpaceFileContent(env, {
        bytes: Uint8Array.from(BYTES).buffer,
        context: CONTEXT,
        spaceId: SPACE_ID,
        write: WRITE,
      })
    ).rejects.toMatchObject({
      code: "space_file.storage_failed",
      status: 503,
    });

    expect(stub.rpcCommitSpaceFileWrite).not.toHaveBeenCalled();
    expect(stub.rpcRecordSpaceFileAuditEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        errorCode: "space_file.storage_failed",
        operation: "content_write",
        result: "failed",
        revisionId: REVISION_ID,
      }),
    });
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
    expect(stub.rpcRecordSpaceFileAuditEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        actorKind: "authenticated",
        actorProfileId: CONTEXT.actorContext.openMeldProfileId,
        entryId: FILE_ID,
        errorCode: null,
        operation: "content_read",
        organizationId: ORGANIZATION_ID,
        requestId: CONTEXT.actorContext.requestId,
        result: "succeeded",
        revisionId: REVISION_ID,
        spaceId: SPACE_ID,
      }),
    });
  });

  it("audits a failed R2 read before returning the storage failure", async () => {
    const { env, stub } = makeEnv({ getError: new Error("R2 unavailable") });

    await expect(
      rpcReadSpaceFileContent(env, {
        content: { spaceId: SPACE_ID, fileId: FILE_ID },
        context: CONTEXT,
        spaceId: SPACE_ID,
      })
    ).rejects.toMatchObject({
      code: "space_file.storage_failed",
      status: 503,
    });

    expect(stub.rpcRecordSpaceFileAuditEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        errorCode: "space_file.storage_failed",
        operation: "content_read",
        result: "failed",
        revisionId: REVISION_ID,
      }),
    });
  });

  it("fails closed before R2 when metadata points outside the file scope", async () => {
    const { bucket, env, stub } = makeEnv({ objectKey: "org/wrong/file" });

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
    expect(stub.rpcRecordSpaceFileAuditEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        errorCode: "upstream_unreachable",
        operation: "content_read",
        result: "failed",
      }),
    });
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
      expect.any(ReadableStream),
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
