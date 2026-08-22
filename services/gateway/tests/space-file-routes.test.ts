import {
  buildSpaceFileObjectKey,
  SPACE_FILE_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type { CommitSpaceFileWriteInput } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { GatewayAuthRpcEntrypoint } from "../../auth/src/index";
import type { GatewayRpcEntrypoint } from "../../core/src/index";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import app from "../src/index";

const SPACE_ID = "space-files-route-test";
const ORGANIZATION_ID = "org-files-route-test";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "owner-files-route-test";
const REQUEST_ID = "req-files-route-test";
const FILE_ID = "file-route-test";
const REVISION_ID = "revision-route-test";
const OBJECT_KEY = `org/${ORGANIZATION_ID}/space/${SPACE_ID}/files/${FILE_ID}/revisions/${REVISION_ID}`;
const TEXT_BYTES = new TextEncoder().encode("Shared launch notes\n");

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const ACTOR = {
  profileId: HUMAN_PROFILE_ID,
  profileKind: "human" as const,
  displayName: "Mira Stone",
  ownerUserId: OWNER_USER_ID,
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
  latestRevision: {
    id: REVISION_ID,
    fileId: FILE_ID,
    revision: 1,
    mimeType: "text/markdown",
    sizeBytes: TEXT_BYTES.byteLength,
    createdAt: "2026-08-22T08:00:00.000Z",
    createdBy: ACTOR,
  },
};

type CoreRpcMock = {
  commitSpaceFileWrite: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["commitSpaceFileWrite"]>
  >;
  prepareSpaceFileWrite: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["prepareSpaceFileWrite"]>
  >;
  resolveSpaceFileContent: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["resolveSpaceFileContent"]>
  >;
};

type R2DeleteMock = (
  ...args: Parameters<R2Bucket["delete"]>
) => ReturnType<R2Bucket["delete"]>;
type R2GetMock = (
  ...args: Parameters<R2Bucket["get"]>
) => ReturnType<R2Bucket["get"]>;
type R2PutMock = (
  ...args: Parameters<R2Bucket["put"]>
) => ReturnType<R2Bucket["put"]>;

function makeEnv(input?: {
  commitError?: Error;
  getResult?: R2ObjectBody | null;
  preparedObjectKey?: string;
  resolvedObjectKey?: string;
}): {
  bucket: {
    delete: ReturnType<typeof vi.fn<R2DeleteMock>>;
    get: ReturnType<typeof vi.fn<R2GetMock>>;
    put: ReturnType<typeof vi.fn<R2PutMock>>;
  };
  coreRpc: CoreRpcMock;
  env: CloudflareBindings;
} {
  const coreRpc: CoreRpcMock = {
    prepareSpaceFileWrite: vi.fn<GatewayRpcEntrypoint["prepareSpaceFileWrite"]>(
      (rpcInput) => {
        const write = rpcInput.write as CommitSpaceFileWriteInput;
        return Promise.resolve({
          organizationId: ORGANIZATION_ID,
          spaceId: write.spaceId,
          fileId: write.fileId,
          revisionId: write.revisionId,
          objectKey:
            input?.preparedObjectKey ??
            buildSpaceFileObjectKey({
              organizationId: ORGANIZATION_ID,
              spaceId: write.spaceId,
              fileId: write.fileId,
              revisionId: write.revisionId,
            }),
        });
      }
    ),
    commitSpaceFileWrite: vi.fn<GatewayRpcEntrypoint["commitSpaceFileWrite"]>(
      () =>
        input?.commitError
          ? Promise.reject(input.commitError)
          : Promise.resolve(FILE)
    ),
    resolveSpaceFileContent: vi.fn<
      GatewayRpcEntrypoint["resolveSpaceFileContent"]
    >(async () => ({
      organizationId: ORGANIZATION_ID,
      objectKey: input?.resolvedObjectKey ?? OBJECT_KEY,
      file: FILE,
      revision: FILE.latestRevision,
    })),
  };
  const authenticatedClaims = {
    activeOrganizationId: ORGANIZATION_ID,
    authenticated: true as const,
    authMethod: "session" as const,
    ownerIds: [OWNER_USER_ID],
    requestId: REQUEST_ID,
  };
  const resolvedProfile = {
    openMeldProfileId: HUMAN_PROFILE_ID,
    ownerUserId: OWNER_USER_ID,
    profileKind: "human" as const,
    profileName: "Mira Stone",
  };
  const authRpc = {
    resolveRequestAuthWithProfile: vi.fn<
      GatewayAuthRpcEntrypoint["resolveRequestAuthWithProfile"]
    >(async () => ({
      ok: true,
      claims: authenticatedClaims,
      profile: { ok: true, resolvedProfile },
    })),
    resolveRequestAuth: vi.fn<GatewayAuthRpcEntrypoint["resolveRequestAuth"]>(
      async () => ({ ok: true, claims: authenticatedClaims })
    ),
    resolveProfile: vi.fn<GatewayAuthRpcEntrypoint["resolveProfile"]>(
      async () => ({ ok: true, resolvedProfile })
    ),
  };
  const bucket = {
    put: vi.fn<R2PutMock>(async (key, value) =>
      makeR2Object(key, sizeOfR2Value(value))
    ),
    get: vi.fn<R2GetMock>(async () => input?.getResult ?? null),
    delete: vi.fn<R2DeleteMock>(async () => undefined),
  };
  return {
    bucket,
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
      OPENMELD_SPACE_ATTACHMENTS: bucket,
    } as unknown as CloudflareBindings,
  };
}

describe("Space file routes", () => {
  it("writes immutable R2 bytes between Space prepare and commit", async () => {
    const { bucket, coreRpc, env } = makeEnv();
    const response = await app.fetch(
      uploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ file: FILE });
    expect(coreRpc.prepareSpaceFileWrite).toHaveBeenCalledOnce();
    expect(bucket.put).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^org/${ORGANIZATION_ID}/space/${SPACE_ID}/files/`)
      ),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: { contentType: "text/markdown" },
      })
    );
    expect(coreRpc.commitSpaceFileWrite).toHaveBeenCalledOnce();
  });

  it("deletes an orphaned immutable object when the Space commit conflicts", async () => {
    const conflict = createCoreRpcHttpError({
      status: 409,
      code: "space_file.conflict",
      reason: "This file changed after you opened it.",
    });
    const { bucket, env } = makeEnv({ commitError: conflict });
    const response = await app.fetch(
      uploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(409);
    await expect(readError(response)).resolves.toMatchObject({
      code: "space_file.conflict",
    });
    const storedObjectKey = bucket.put.mock.calls[0]?.[0];
    expect(storedObjectKey).toEqual(expect.any(String));
    expect(bucket.delete).toHaveBeenCalledWith(storedObjectKey);
  });

  it("authorizes metadata before streaming a private revision", async () => {
    const { bucket, coreRpc, env } = makeEnv({
      getResult: makeR2ObjectBody(OBJECT_KEY, TEXT_BYTES),
    });
    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/files/${FILE_ID}/content`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown");
    expect(response.headers.get("x-openmeld-file-revision")).toBe("1");
    await expect(response.text()).resolves.toBe("Shared launch notes\n");
    expect(coreRpc.resolveSpaceFileContent).toHaveBeenCalledOnce();
    expect(bucket.get).toHaveBeenCalledWith(OBJECT_KEY);
  });

  it("rejects oversized files before contacting Core or R2", async () => {
    const { bucket, coreRpc, env } = makeEnv();
    const response = await app.fetch(
      uploadRequest({ contentLength: SPACE_FILE_MAX_SIZE_BYTES + 1 }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(413);
    await expect(readError(response)).resolves.toMatchObject({
      code: "space_file.too_large",
    });
    expect(coreRpc.prepareSpaceFileWrite).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("fails closed when Core prepares a different storage scope", async () => {
    const { bucket, coreRpc, env } = makeEnv({
      preparedObjectKey: `${OBJECT_KEY}-other`,
    });
    const response = await app.fetch(
      uploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    await expect(readError(response)).resolves.toMatchObject({
      code: "upstream_unreachable",
    });
    expect(coreRpc.prepareSpaceFileWrite).toHaveBeenCalledOnce();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("fails closed when Core resolves a different storage scope", async () => {
    const { bucket, env } = makeEnv({
      getResult: makeR2ObjectBody(OBJECT_KEY, TEXT_BYTES),
      resolvedObjectKey: `${OBJECT_KEY}-other`,
    });
    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/files/${FILE_ID}/content`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    await expect(readError(response)).resolves.toMatchObject({
      code: "upstream_unreachable",
    });
    expect(bucket.get).not.toHaveBeenCalled();
  });
});

function uploadRequest(input?: { contentLength?: number }): Request {
  return new Request(
    `http://local/v1/spaces/${SPACE_ID}/files?name=launch-notes.md&clientMutationId=mutation-route-test`,
    {
      method: "POST",
      headers: {
        "content-length": String(input?.contentLength ?? TEXT_BYTES.byteLength),
        "content-type": "text/markdown; charset=utf-8",
      },
      body: Uint8Array.from(TEXT_BYTES).buffer,
    }
  );
}

async function readError(response: Response): Promise<{
  code?: string;
  message?: string;
}> {
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string };
  };
  return payload.error ?? {};
}

function makeR2Object(key: string, size: number): R2Object {
  return {
    key,
    version: "test-version",
    size,
    etag: "test-etag",
    httpEtag: '"test-etag"',
    checksums: { toJSON: () => ({}) },
    uploaded: new Date("2026-08-22T08:00:00.000Z"),
    storageClass: "Standard",
    writeHttpMetadata: () => undefined,
  };
}

function makeR2ObjectBody(key: string, bytes: Uint8Array): R2ObjectBody {
  const copiedBytes = Uint8Array.from(bytes);
  const response = new Response(copiedBytes);
  const object = makeR2Object(key, copiedBytes.byteLength);
  return {
    ...object,
    writeHttpMetadata: (headers) => object.writeHttpMetadata(headers),
    get body() {
      if (!response.body) {
        throw new TypeError("test R2 object body is unavailable");
      }
      return response.body;
    },
    get bodyUsed() {
      return response.bodyUsed;
    },
    arrayBuffer: async () => Uint8Array.from(copiedBytes).buffer,
    bytes: async () => Uint8Array.from(copiedBytes),
    text: async () => new TextDecoder().decode(copiedBytes),
    json: async <T>() => JSON.parse(new TextDecoder().decode(copiedBytes)) as T,
    blob: async () => new Blob([Uint8Array.from(copiedBytes)]),
  };
}

function sizeOfR2Value(value: Parameters<R2Bucket["put"]>[1]): number {
  if (value === null) {
    return 0;
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value).byteLength;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  if (value instanceof Blob) {
    return value.size;
  }
  return 0;
}
