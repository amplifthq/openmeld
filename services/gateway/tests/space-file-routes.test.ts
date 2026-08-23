import { SPACE_FILE_MAX_SIZE_BYTES } from "@openmeld/schemas";
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
  trashedAt: null,
  trashedBy: null,
};

type CoreRpcMock = {
  readSpaceFileContent: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["readSpaceFileContent"]>
  >;
  writeSpaceFileContent: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["writeSpaceFileContent"]>
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

function makeEnv(input?: { readBytes?: ArrayBuffer; writeError?: Error }): {
  bucket: {
    delete: ReturnType<typeof vi.fn<R2DeleteMock>>;
    get: ReturnType<typeof vi.fn<R2GetMock>>;
    put: ReturnType<typeof vi.fn<R2PutMock>>;
  };
  coreRpc: CoreRpcMock;
  env: CloudflareBindings;
} {
  const coreRpc: CoreRpcMock = {
    readSpaceFileContent: vi.fn<GatewayRpcEntrypoint["readSpaceFileContent"]>(
      async () => ({
        bytes: input?.readBytes ?? Uint8Array.from(TEXT_BYTES).buffer,
        organizationId: ORGANIZATION_ID,
        objectKey: OBJECT_KEY,
        file: FILE,
        revision: FILE.latestRevision,
      })
    ),
    writeSpaceFileContent: vi.fn<GatewayRpcEntrypoint["writeSpaceFileContent"]>(
      () =>
        input?.writeError
          ? Promise.reject(input.writeError)
          : Promise.resolve(FILE)
    ),
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
    get: vi.fn<R2GetMock>(async () => null),
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
  it("preserves the requested Trash view when listing Space files", async () => {
    const { coreRpc, env } = makeEnv();
    const listSpaceFiles = vi.fn(async () => ({
      breadcrumbs: [{ id: null, name: "Files" }],
      capabilities: { canRead: true as const, canWrite: true },
      entries: [],
      parentId: null,
      spaceId: SPACE_ID,
      view: "trash" as const,
    }));
    Object.assign(coreRpc, { listSpaceFiles });

    const response = await app.fetch(
      new Request(`http://local/v1/spaces/${SPACE_ID}/files?view=trash`),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ view: "trash" });
    expect(listSpaceFiles).toHaveBeenCalledWith(
      expect.objectContaining({ query: { view: "trash" } })
    );
  });

  it("restores a trashed entry through the authenticated Gateway route", async () => {
    const { coreRpc, env } = makeEnv();
    const restoreSpaceFileEntry = vi.fn(async () => ({ entry: FILE }));
    Object.assign(coreRpc, { restoreSpaceFileEntry });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/files/${FILE_ID}/restore`,
        {
          body: JSON.stringify({
            clientMutationId: "restore-entry-route-test",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ entry: FILE });
    expect(restoreSpaceFileEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { clientMutationId: "restore-entry-route-test" },
        entryId: FILE_ID,
        spaceId: SPACE_ID,
      })
    );
  });

  it("restores an older revision through the authenticated Gateway route", async () => {
    const { coreRpc, env } = makeEnv();
    const restoreSpaceFileRevision = vi.fn(async () => FILE);
    Object.assign(coreRpc, { restoreSpaceFileRevision });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/files/${FILE_ID}/revisions/1/restore`,
        {
          body: JSON.stringify({
            baseRevision: 1,
            clientMutationId: "restore-revision-route-test",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ file: FILE });
    expect(restoreSpaceFileRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          baseRevision: 1,
          clientMutationId: "restore-revision-route-test",
        },
        fileId: FILE_ID,
        revision: 1,
        spaceId: SPACE_ID,
      })
    );
  });

  it("sends file bytes and metadata to the Core-owned storage operation", async () => {
    const { bucket, coreRpc, env } = makeEnv();
    const response = await app.fetch(
      uploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ file: FILE });
    expect(coreRpc.writeSpaceFileContent).toHaveBeenCalledOnce();
    expect(coreRpc.writeSpaceFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: expect.any(ArrayBuffer),
        spaceId: SPACE_ID,
        write: expect.objectContaining({
          mimeType: "text/markdown",
          name: "launch-notes.md",
          spaceId: SPACE_ID,
        }),
      })
    );
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("preserves a Core revision conflict for the caller", async () => {
    const conflict = createCoreRpcHttpError({
      status: 409,
      code: "space_file.conflict",
      reason: "This file changed after you opened it.",
    });
    const { bucket, env } = makeEnv({ writeError: conflict });
    const response = await app.fetch(
      uploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(409);
    await expect(readError(response)).resolves.toMatchObject({
      code: "space_file.conflict",
    });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("asks Core to authorize and read before streaming a private revision", async () => {
    const { bucket, coreRpc, env } = makeEnv();
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
    expect(coreRpc.readSpaceFileContent).toHaveBeenCalledOnce();
    expect(bucket.get).not.toHaveBeenCalled();
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
    expect(coreRpc.writeSpaceFileContent).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("fails closed when Core returns incomplete bytes", async () => {
    const { bucket, env } = makeEnv({ readBytes: new ArrayBuffer(1) });
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
