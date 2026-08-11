import { SPACE_ATTACHMENT_MAX_SIZE_BYTES } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { GatewayAuthRpcEntrypoint } from "../../auth/src/index";
import type { GatewayRpcEntrypoint } from "../../core/src/index";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import app from "../src/index";

const SPACE_ID = "space-attachment-test";
const OTHER_SPACE_ID = "space-other";
const ATTACHMENT_ID = "attachment-1";
const ORGANIZATION_ID = "org-1";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "owner-1";
const REQUEST_ID = "req-space-attachment";
const ATTACHMENT_KEY = `org/${ORGANIZATION_ID}/space/${SPACE_ID}/${ATTACHMENT_ID}`;

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const WORKER_ROUTE_TEST_TIMEOUT_MS = 30_000;

const ATTACHMENT_DESCRIPTOR = {
  id: ATTACHMENT_ID,
  spaceId: SPACE_ID,
  organizationId: ORGANIZATION_ID,
  mimeType: "image/png" as const,
  sizeBytes: PNG_BYTES.byteLength,
  width: 640,
  height: 480,
  fileName: "photo.png",
  createdAt: "2026-07-11T00:00:00.000Z",
};

type CoreRpcMock = {
  deleteSpaceAttachmentRecord: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["deleteSpaceAttachmentRecord"]>
  >;
  recordSpaceAttachment: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["recordSpaceAttachment"]>
  >;
  resolveSpaceAttachmentForDownload: ReturnType<
    typeof vi.fn<GatewayRpcEntrypoint["resolveSpaceAttachmentForDownload"]>
  >;
};

type AuthRpcMock = {
  resolveProfile: ReturnType<
    typeof vi.fn<GatewayAuthRpcEntrypoint["resolveProfile"]>
  >;
  resolveRequestAuth: ReturnType<
    typeof vi.fn<GatewayAuthRpcEntrypoint["resolveRequestAuth"]>
  >;
  resolveRequestAuthWithProfile: ReturnType<
    typeof vi.fn<GatewayAuthRpcEntrypoint["resolveRequestAuthWithProfile"]>
  >;
};

type RequestAuthResult = Awaited<
  ReturnType<GatewayAuthRpcEntrypoint["resolveRequestAuth"]>
>;
type AuthenticatedClaims = Extract<RequestAuthResult, { ok: true }>["claims"];
type AttachmentAuthClaims = AuthenticatedClaims & {
  activeOrganizationId: string;
};
type ResolveProfileResult = Awaited<
  ReturnType<GatewayAuthRpcEntrypoint["resolveProfile"]>
>;
type ResolvedProfile = Extract<
  ResolveProfileResult,
  { ok: true }
>["resolvedProfile"];

type R2GetMock = (
  ...args: Parameters<R2Bucket["get"]>
) => ReturnType<R2Bucket["get"]>;
type R2PutMock = (
  ...args: Parameters<R2Bucket["put"]>
) => ReturnType<R2Bucket["put"]>;

type AttachmentBucketMock = {
  get: ReturnType<typeof vi.fn<R2GetMock>>;
  put: ReturnType<typeof vi.fn<R2PutMock>>;
};

function makeEnv(input?: {
  authOverrides?: Partial<AuthRpcMock>;
  coreOverrides?: Partial<CoreRpcMock>;
  getResult?: R2ObjectBody | null;
  putError?: Error;
}): {
  authRpc: AuthRpcMock;
  bucket: AttachmentBucketMock;
  coreRpc: CoreRpcMock;
  env: CloudflareBindings;
} {
  const coreRpc: CoreRpcMock = {
    deleteSpaceAttachmentRecord: vi.fn<
      GatewayRpcEntrypoint["deleteSpaceAttachmentRecord"]
    >(async () => ({ deleted: true })),
    recordSpaceAttachment: vi.fn<GatewayRpcEntrypoint["recordSpaceAttachment"]>(
      async () => ATTACHMENT_DESCRIPTOR
    ),
    resolveSpaceAttachmentForDownload: vi.fn<
      GatewayRpcEntrypoint["resolveSpaceAttachmentForDownload"]
    >(async () => ATTACHMENT_DESCRIPTOR),
    ...(input?.coreOverrides ?? {}),
  };

  const authenticatedClaims: AttachmentAuthClaims = {
    activeOrganizationId: ORGANIZATION_ID,
    authenticated: true,
    authMethod: "session",
    ownerIds: [OWNER_USER_ID],
    requestId: REQUEST_ID,
  };
  const resolvedProfile: ResolvedProfile = {
    openMeldProfileId: HUMAN_PROFILE_ID,
    ownerUserId: OWNER_USER_ID,
    profileKind: "human",
    profileName: "Mira",
  };
  const authRpc: AuthRpcMock = {
    resolveRequestAuthWithProfile: vi.fn<
      GatewayAuthRpcEntrypoint["resolveRequestAuthWithProfile"]
    >(async () => ({
      ok: true,
      claims: authenticatedClaims,
      profile: {
        ok: true,
        resolvedProfile,
      },
    })),
    resolveRequestAuth: vi.fn<GatewayAuthRpcEntrypoint["resolveRequestAuth"]>(
      async () => ({
        ok: true,
        claims: authenticatedClaims,
      })
    ),
    resolveProfile: vi.fn<GatewayAuthRpcEntrypoint["resolveProfile"]>(
      async () => ({
        ok: true,
        resolvedProfile,
      })
    ),
    ...(input?.authOverrides ?? {}),
  };

  const put = vi.fn<R2PutMock>((key, value) => {
    if (input?.putError) {
      return Promise.reject(input.putError);
    }
    return Promise.resolve(makeR2Object(key, sizeOfR2Value(value)));
  });
  const get = vi.fn<R2GetMock>(async () => input?.getResult ?? null);
  const bucket = { get, put };

  return {
    authRpc,
    bucket,
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
      OPENMELD_SPACE_ATTACHMENTS: bucket,
    } as unknown as CloudflareBindings,
  };
}

function makeUploadRequest(input?: {
  body?: Uint8Array;
  contentLength?: number | null;
  contentType?: string;
  query?: string;
}): Request {
  const body = input?.body ?? PNG_BYTES;
  const headers = new Headers({
    "content-type": input?.contentType ?? "image/png",
  });
  const contentLength = input?.contentLength;
  if (contentLength !== null) {
    headers.set("content-length", String(contentLength ?? body.byteLength));
  }
  return new Request(
    `http://local/v1/spaces/${SPACE_ID}/attachments${input?.query ?? ""}`,
    {
      body: Uint8Array.from(body).buffer,
      headers,
      method: "POST",
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

describe("Space attachment upload route", () => {
  it("records metadata before storing validated image bytes in the private R2 key", async () => {
    const { bucket, coreRpc, env } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest({
        query: "?fileName=folder%5Cphoto.png&width=640&height=480",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      attachment: ATTACHMENT_DESCRIPTOR,
    });
    expect(coreRpc.recordSpaceAttachment).toHaveBeenCalledWith({
      context: expect.objectContaining({
        activeOrganizationId: ORGANIZATION_ID,
        actorContext: expect.objectContaining({
          ownerUserId: OWNER_USER_ID,
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
      fileName: "photo.png",
      height: 480,
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      spaceAccess: {
        actor: {
          kind: "authenticated",
          requestContext: expect.objectContaining({
            activeOrganizationId: ORGANIZATION_ID,
            actorContext: expect.objectContaining({
              ownerUserId: OWNER_USER_ID,
              openMeldProfileId: HUMAN_PROFILE_ID,
            }),
          }),
        },
        proof: { kind: "none" },
        spaceId: SPACE_ID,
      },
      spaceId: SPACE_ID,
      width: 640,
    });
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.put).toHaveBeenCalledWith(
      ATTACHMENT_KEY,
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: "image/png" } }
    );
    const storedValue = bucket.put.mock.calls[0]?.[1];
    if (!(storedValue instanceof ArrayBuffer)) {
      throw new TypeError("expected Gateway to pass an ArrayBuffer to R2");
    }
    expect(new Uint8Array(storedValue)).toEqual(PNG_BYTES);
    expect(
      coreRpc.recordSpaceAttachment.mock.invocationCallOrder[0]
    ).toBeLessThan(bucket.put.mock.invocationCallOrder[0] ?? 0);
  });

  it("rejects a missing Content-Length before reading or recording the body", async () => {
    const { bucket, coreRpc, env } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest({ contentLength: null }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(411);
    expect(await readError(response)).toMatchObject({ code: "bad_request" });
    expect(coreRpc.recordSpaceAttachment).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects a declared body larger than 5 MiB with attachment_too_large", async () => {
    const { bucket, coreRpc, env } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest({
        contentLength: SPACE_ATTACHMENT_MAX_SIZE_BYTES + 1,
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(413);
    expect(await readError(response)).toMatchObject({
      code: "attachment_too_large",
    });
    expect(coreRpc.recordSpaceAttachment).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects an actual body larger than 5 MiB even when the declared size is allowed", async () => {
    const { bucket, coreRpc, env } = makeEnv();
    const oversizedBytes = new Uint8Array(SPACE_ATTACHMENT_MAX_SIZE_BYTES + 1);
    oversizedBytes.set(PNG_BYTES);

    const response = await app.fetch(
      makeUploadRequest({
        body: oversizedBytes,
        contentLength: SPACE_ATTACHMENT_MAX_SIZE_BYTES,
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(413);
    expect(await readError(response)).toMatchObject({
      code: "attachment_too_large",
    });
    expect(coreRpc.recordSpaceAttachment).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects MIME types outside the shared allowlist", async () => {
    const { bucket, coreRpc, env } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest({ contentType: "image/gif" }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(415);
    expect(await readError(response)).toMatchObject({
      code: "attachment_type_unsupported",
    });
    expect(coreRpc.recordSpaceAttachment).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects bytes whose magic signature does not match the declared MIME type", async () => {
    const { bucket, coreRpc, env } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest({ body: JPEG_BYTES, contentType: "image/png" }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(415);
    expect(await readError(response)).toMatchObject({
      code: "attachment_content_mismatch",
    });
    expect(coreRpc.recordSpaceAttachment).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated uploads before Core or R2 is called", async () => {
    const unauthenticatedResult: RequestAuthResult = {
      ok: true,
      claims: {
        authenticated: false,
        authMethod: "none",
        ownerIds: [],
        requestId: REQUEST_ID,
      },
    };
    const { bucket, coreRpc, env } = makeEnv({
      authOverrides: {
        resolveRequestAuthWithProfile: vi.fn<
          GatewayAuthRpcEntrypoint["resolveRequestAuthWithProfile"]
        >(async () => unauthenticatedResult),
        resolveRequestAuth: vi.fn<
          GatewayAuthRpcEntrypoint["resolveRequestAuth"]
        >(async () => unauthenticatedResult),
      },
    });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    expect(await readError(response)).toMatchObject({
      code: "auth.unauthenticated",
    });
    expect(coreRpc.recordSpaceAttachment).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("does not write R2 when Core rejects a non-member", async () => {
    const { bucket, coreRpc, env } = makeEnv({
      coreOverrides: {
        recordSpaceAttachment: vi.fn(() =>
          Promise.reject(
            createCoreRpcHttpError({
              code: "space.forbidden",
              reason: "Space membership is required.",
              status: 403,
            })
          )
        ),
      },
    });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(403);
    expect(await readError(response)).toMatchObject({
      code: "space.forbidden",
    });
    expect(coreRpc.recordSpaceAttachment).toHaveBeenCalledTimes(1);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it(
    "does not write an R2 key when Core returns a descriptor for another Organization",
    async () => {
      const { bucket, env } = makeEnv({
        coreOverrides: {
          recordSpaceAttachment: vi.fn(async () => ({
            ...ATTACHMENT_DESCRIPTOR,
            organizationId: "org-other",
          })),
        },
      });

      const response = await app.fetch(
        makeUploadRequest(),
        env,
        TEST_EXECUTION_CONTEXT
      );

      expect(response.status).toBe(502);
      expect(await readError(response)).toMatchObject({
        code: "upstream_error",
      });
      expect(bucket.put).not.toHaveBeenCalled();
    },
    WORKER_ROUTE_TEST_TIMEOUT_MS
  );

  it("deletes the metadata record when R2 put fails and returns an explicit storage failure", async () => {
    const { bucket, coreRpc, env } = makeEnv({
      putError: new Error("simulated R2 put failure"),
    });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(500);
    expect(await readError(response)).toMatchObject({
      code: "attachment_storage_failed",
    });
    expect(coreRpc.deleteSpaceAttachmentRecord).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT_ID,
    });
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.put.mock.invocationCallOrder[0]).toBeLessThan(
      coreRpc.deleteSpaceAttachmentRecord.mock.invocationCallOrder[0] ?? 0
    );
  });
});

describe("Space attachment download route", () => {
  it("streams a member's image with the descriptor MIME type and private cache policy", async () => {
    const { bucket, coreRpc, env } = makeEnv({
      getResult: makeR2ObjectBody(ATTACHMENT_KEY, PNG_BYTES),
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/attachments/${ATTACHMENT_ID}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
    expect(coreRpc.resolveSpaceAttachmentForDownload).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT_ID,
      context: expect.objectContaining({
        actorContext: expect.objectContaining({
          ownerUserId: OWNER_USER_ID,
        }),
      }),
      spaceAccess: expect.objectContaining({
        actor: expect.objectContaining({ kind: "authenticated" }),
        proof: { kind: "none" },
        spaceId: SPACE_ID,
      }),
      spaceId: SPACE_ID,
    });
    expect(bucket.get).toHaveBeenCalledWith(ATTACHMENT_KEY);
  });

  it("does not read R2 when Core rejects a non-member", async () => {
    const { bucket, env } = makeEnv({
      coreOverrides: {
        resolveSpaceAttachmentForDownload: vi.fn(() =>
          Promise.reject(
            createCoreRpcHttpError({
              code: "space.forbidden",
              reason: "Space membership is required.",
              status: 403,
            })
          )
        ),
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/attachments/${ATTACHMENT_ID}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(403);
    expect(await readError(response)).toMatchObject({
      code: "space.forbidden",
    });
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("returns attachment_not_found when Core cannot resolve the metadata row", async () => {
    const { bucket, env } = makeEnv({
      coreOverrides: {
        resolveSpaceAttachmentForDownload: vi.fn(() =>
          Promise.reject(
            createCoreRpcHttpError({
              code: "attachment_not_found",
              reason: "Attachment not found.",
              status: 404,
            })
          )
        ),
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/attachments/${ATTACHMENT_ID}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(404);
    expect(await readError(response)).toMatchObject({
      code: "attachment_not_found",
    });
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("returns attachment_not_found when the authorized row exists but R2 has no object", async () => {
    const { bucket, env } = makeEnv({ getResult: null });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/attachments/${ATTACHMENT_ID}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(404);
    expect(await readError(response)).toMatchObject({
      code: "attachment_not_found",
    });
    expect(bucket.get).toHaveBeenCalledWith(ATTACHMENT_KEY);
  });

  it("fails closed when Core returns a descriptor for another Space", async () => {
    const { bucket, env } = makeEnv({
      coreOverrides: {
        resolveSpaceAttachmentForDownload: vi.fn(async () => ({
          ...ATTACHMENT_DESCRIPTOR,
          spaceId: OTHER_SPACE_ID,
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/attachments/${ATTACHMENT_ID}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    expect(await readError(response)).toMatchObject({ code: "upstream_error" });
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("fails closed when Core returns a descriptor for another Organization", async () => {
    const { bucket, env } = makeEnv({
      coreOverrides: {
        resolveSpaceAttachmentForDownload: vi.fn(async () => ({
          ...ATTACHMENT_DESCRIPTOR,
          organizationId: "org-other",
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${SPACE_ID}/attachments/${ATTACHMENT_ID}`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    expect(await readError(response)).toMatchObject({ code: "upstream_error" });
    expect(bucket.get).not.toHaveBeenCalled();
  });
});

function makeR2Object(key: string, size: number): R2Object {
  return {
    key,
    version: "test-version",
    size,
    etag: "test-etag",
    httpEtag: '"test-etag"',
    checksums: {
      toJSON: () => ({}),
    },
    uploaded: new Date("2026-07-11T00:00:00.000Z"),
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
