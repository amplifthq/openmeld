import {
  buildOrganizationLogoObjectKey,
  ORGANIZATION_LOGO_MAX_DIMENSION,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayAuthRpcEntrypoint } from "../../auth/src/index";
import type { GatewayRpcEntrypoint } from "../../core/src/index";
import app from "../src/index";

const ORGANIZATION_ID = "org-1";
const OWNER_USER_ID = "owner-1";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const GATEWAY_URL = "http://localhost:8080";
const LOGO_URL = `${GATEWAY_URL}/v1/organization-logos/${ORGANIZATION_ID}/${ASSET_ID}.webp`;

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

type AuthRpcMock = {
  commitOrganizationLogoMutation: ReturnType<
    typeof vi.fn<GatewayAuthRpcEntrypoint["commitOrganizationLogoMutation"]>
  >;
  prepareOrganizationLogoMutation: ReturnType<
    typeof vi.fn<GatewayAuthRpcEntrypoint["prepareOrganizationLogoMutation"]>
  >;
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

type OrganizationLogoBucketMock = Pick<R2Bucket, "delete" | "get" | "put">;

function makeEnv(input?: {
  commitResult?: Awaited<
    ReturnType<GatewayAuthRpcEntrypoint["commitOrganizationLogoMutation"]>
  >;
  currentLogo?: string | null;
  deleteError?: Error;
  imageInfo?: ImageInfoResponse;
  object?: R2ObjectBody | null;
  prepareResult?: Awaited<
    ReturnType<GatewayAuthRpcEntrypoint["prepareOrganizationLogoMutation"]>
  >;
  putError?: Error;
}): {
  authRpc: AuthRpcMock;
  bucket: OrganizationLogoBucketMock;
  env: CloudflareBindings;
  images: Pick<ImagesBinding, "info" | "input">;
  transformer: {
    output: ReturnType<typeof vi.fn>;
    transform: ReturnType<typeof vi.fn>;
  };
} {
  const claims = {
    activeOrganizationId: ORGANIZATION_ID,
    authenticated: true as const,
    authMethod: "session" as const,
    callerPrincipalId: OWNER_USER_ID,
    ownerIds: [OWNER_USER_ID],
    requestId: REQUEST_ID,
  };
  const resolvedProfile = {
    ownerUserId: OWNER_USER_ID,
    profileKind: "human" as const,
    profileName: "Mira",
    openMeldProfileId: PROFILE_ID,
  };
  const authRpc: AuthRpcMock = {
    prepareOrganizationLogoMutation: vi.fn(async () =>
      input?.prepareResult
        ? input.prepareResult
        : { currentLogo: input?.currentLogo ?? null, ok: true }
    ),
    commitOrganizationLogoMutation: vi.fn(async (request) =>
      input?.commitResult
        ? input.commitResult
        : {
            logo:
              (
                request as {
                  nextLogo?: { url?: string } | null;
                }
              ).nextLogo?.url ?? null,
            ok: true,
          }
    ),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims,
      ok: true,
      profile: { ok: true, resolvedProfile },
    })),
    resolveRequestAuth: vi.fn(async () => ({ claims, ok: true })),
    resolveProfile: vi.fn(async () => ({ ok: true, resolvedProfile })),
  };

  const bucket: OrganizationLogoBucketMock = {
    delete: vi.fn(() =>
      input?.deleteError
        ? Promise.reject(input.deleteError)
        : Promise.resolve(undefined)
    ),
    get: vi.fn(async () => input?.object ?? null),
    put: vi.fn((key: string) => {
      if (input?.putError) {
        return Promise.reject(input.putError);
      }
      return Promise.resolve(makeStoredMetadata(key));
    }),
  };
  const transformedResult = {
    contentType: () => "image/webp",
    image: () => toTestStream(WEBP_BYTES),
    response: () => new Response(Uint8Array.from(WEBP_BYTES).buffer),
  } satisfies ImageTransformationResult;
  const transformer = {
    draw: vi.fn<ImageTransformer["draw"]>(),
    transform: vi.fn(),
    output: vi.fn<ImageTransformer["output"]>(async () => transformedResult),
  } satisfies ImageTransformer;
  transformer.draw.mockReturnValue(transformer);
  transformer.transform.mockReturnValue(transformer);
  const images = {
    info: vi.fn<ImagesBinding["info"]>(async () =>
      input?.imageInfo
        ? input.imageInfo
        : {
            fileSize: PNG_BYTES.byteLength,
            format: "image/png",
            height: 800,
            width: 1200,
          }
    ),
    input: vi.fn<ImagesBinding["input"]>(() => transformer),
  } satisfies Pick<ImagesBinding, "info" | "input">;

  return {
    authRpc,
    bucket,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: {} as GatewayRpcEntrypoint,
      OPENMELD_GATEWAY_URL: GATEWAY_URL,
      OPENMELD_IMAGES: images,
      OPENMELD_ORGANIZATION_LOGOS: bucket,
    } as unknown as CloudflareBindings,
    images,
    transformer,
  };
}

function makeUploadRequest(input?: {
  body?: Uint8Array;
  contentLength?: number | null;
  contentType?: string;
}): Request {
  const body = input?.body ?? PNG_BYTES;
  const headers = new Headers({
    "content-type": input?.contentType ?? "image/png",
  });
  if (input?.contentLength !== null) {
    headers.set(
      "content-length",
      String(input?.contentLength ?? body.byteLength)
    );
  }
  return new Request("http://local/v1/organizations/current/logo", {
    body: Uint8Array.from(body).buffer,
    headers,
    method: "PUT",
  });
}

function makeStoredObject(bytes: Uint8Array): R2ObjectBody {
  const copiedBytes = Uint8Array.from(bytes);
  return {
    body: toTestStream(copiedBytes),
    bodyUsed: false,
    bytes: async () => Uint8Array.from(bytes),
    checksums: {} as R2Checksums,
    customMetadata: {},
    etag: "logo-etag",
    httpEtag: '"logo-etag"',
    httpMetadata: {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "image/webp",
    },
    key: buildOrganizationLogoObjectKey({
      assetId: ASSET_ID,
      organizationId: ORGANIZATION_ID,
    }),
    range: undefined,
    size: bytes.byteLength,
    storageClass: "Standard",
    uploaded: new Date("2026-07-14T00:00:00.000Z"),
    version: "version-1",
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", "image/webp");
      headers.set("cache-control", "public, max-age=31536000, immutable");
    },
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    blob: async () => new Blob([copiedBytes.buffer]),
    json: async <T>() => await Promise.reject<T>(new Error("Not implemented.")),
    text: async () => "",
  } satisfies R2ObjectBody;
}

function toTestStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = Uint8Array.from(bytes);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
}

function makeStoredMetadata(key: string): R2Object {
  return {
    checksums: {} as R2Checksums,
    customMetadata: {},
    etag: "stored-etag",
    httpEtag: '"stored-etag"',
    httpMetadata: {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "image/webp",
    },
    key,
    range: undefined,
    size: WEBP_BYTES.byteLength,
    storageClass: "Standard",
    uploaded: new Date("2026-07-14T00:00:00.000Z"),
    version: "version-1",
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", "image/webp");
    },
  } satisfies R2Object;
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

describe("Organization logo routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authorizes, transforms, stores, and commits an owner upload", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(ASSET_ID);
    const { authRpc, bucket, env, images, transformer } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      logo: LOGO_URL,
      ok: true,
    });
    expect(authRpc.prepareOrganizationLogoMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(images.info).toHaveBeenCalledTimes(1);
    expect(transformer.transform).toHaveBeenCalledWith({
      fit: "cover",
      gravity: "center",
      height: 512,
      width: 512,
    });
    expect(transformer.output).toHaveBeenCalledWith({
      anim: false,
      format: "image/webp",
      quality: 88,
    });
    expect(bucket.put).toHaveBeenCalledWith(
      buildOrganizationLogoObjectKey({
        assetId: ASSET_ID,
        organizationId: ORGANIZATION_ID,
      }),
      expect.anything(),
      {
        customMetadata: {
          assetId: ASSET_ID,
          organizationId: ORGANIZATION_ID,
        },
        httpMetadata: {
          cacheControl: "public, max-age=31536000, immutable",
          contentType: "image/webp",
        },
      }
    );
    expect(authRpc.commitOrganizationLogoMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
      expectedLogo: null,
      nextLogo: { assetId: ASSET_ID, url: LOGO_URL },
      organizationId: ORGANIZATION_ID,
    });
  });

  it("accepts a bounded streamed upload without Content-Length", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(ASSET_ID);
    const { authRpc, bucket, env } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest({ contentLength: null }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(authRpc.prepareOrganizationLogoMutation).toHaveBeenCalledTimes(1);
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });

  it("rejects non-owner authorization before reading or transforming bytes", async () => {
    const { authRpc, bucket, env, images } = makeEnv({
      prepareResult: {
        code: "organization.logo.forbidden",
        message: "Only the organization owner can change the logo.",
        ok: false,
      },
    });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(403);
    expect(await readError(response)).toEqual(
      expect.objectContaining({
        code: "organization.logo.forbidden",
        message: "Only the organization owner can change the logo.",
      })
    );
    expect(authRpc.commitOrganizationLogoMutation).not.toHaveBeenCalled();
    expect(images.info).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects oversized requests and bytes that contradict the MIME type", async () => {
    const oversized = makeEnv();
    const oversizedResponse = await app.fetch(
      makeUploadRequest({
        contentLength: ORGANIZATION_LOGO_MAX_SIZE_BYTES + 1,
      }),
      oversized.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(oversizedResponse.status).toBe(413);
    expect((await readError(oversizedResponse)).code).toBe(
      "organization.logo.too_large"
    );
    expect(
      oversized.authRpc.prepareOrganizationLogoMutation
    ).not.toHaveBeenCalled();

    const streamedOversized = makeEnv();
    const streamedOversizedResponse = await app.fetch(
      makeUploadRequest({
        body: new Uint8Array(ORGANIZATION_LOGO_MAX_SIZE_BYTES + 1),
        contentLength: null,
      }),
      streamedOversized.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(streamedOversizedResponse.status).toBe(413);
    expect((await readError(streamedOversizedResponse)).code).toBe(
      "organization.logo.too_large"
    );
    expect(streamedOversized.images.info).not.toHaveBeenCalled();

    const mismatch = makeEnv();
    const mismatchResponse = await app.fetch(
      makeUploadRequest({ body: WEBP_BYTES, contentType: "image/png" }),
      mismatch.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(mismatchResponse.status).toBe(415);
    expect((await readError(mismatchResponse)).code).toBe(
      "organization.logo.content_mismatch"
    );
    expect(mismatch.bucket.put).not.toHaveBeenCalled();
  });

  it("removes the new R2 object when the database commit conflicts", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(ASSET_ID);
    const { bucket, env } = makeEnv({
      commitResult: {
        code: "organization.logo.conflict",
        message: "The organization logo changed before this update completed.",
        ok: false,
      },
    });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(409);
    expect(bucket.delete).toHaveBeenCalledWith(
      buildOrganizationLogoObjectKey({
        assetId: ASSET_ID,
        organizationId: ORGANIZATION_ID,
      })
    );
  });

  it("surfaces a failed rollback instead of hiding an orphaned R2 object", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(ASSET_ID);
    const { bucket, env } = makeEnv({
      commitResult: {
        code: "organization.logo.conflict",
        message: "The organization logo changed before this update completed.",
        ok: false,
      },
      deleteError: new Error("r2 delete unavailable"),
    });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(500);
    expect((await readError(response)).code).toBe(
      "organization.logo.storage_failed"
    );
    expect(bucket.delete).toHaveBeenCalledWith(
      buildOrganizationLogoObjectKey({
        assetId: ASSET_ID,
        organizationId: ORGANIZATION_ID,
      })
    );
  });

  it("rejects unsafe decoded dimensions before transforming or storing", async () => {
    const { bucket, env, transformer } = makeEnv({
      imageInfo: {
        fileSize: PNG_BYTES.byteLength,
        format: "image/png",
        height: 1,
        width: ORGANIZATION_LOGO_MAX_DIMENSION + 1,
      },
    });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(422);
    expect((await readError(response)).code).toBe(
      "organization.logo.invalid_image"
    );
    expect(transformer.output).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("does not commit when R2 rejects the transformed object", async () => {
    const { authRpc, env } = makeEnv({ putError: new Error("r2 unavailable") });

    const response = await app.fetch(
      makeUploadRequest(),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(500);
    expect((await readError(response)).code).toBe(
      "organization.logo.storage_failed"
    );
    expect(authRpc.commitOrganizationLogoMutation).not.toHaveBeenCalled();
  });

  it("commits removal before deleting the previously managed object", async () => {
    const { authRpc, bucket, env } = makeEnv({ currentLogo: LOGO_URL });

    const response = await app.fetch(
      new Request("http://local/v1/organizations/current/logo", {
        method: "DELETE",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ logo: null, ok: true });
    expect(authRpc.commitOrganizationLogoMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
      expectedLogo: LOGO_URL,
      nextLogo: null,
      organizationId: ORGANIZATION_ID,
    });
    expect(bucket.delete).toHaveBeenCalledWith(
      buildOrganizationLogoObjectKey({
        assetId: ASSET_ID,
        organizationId: ORGANIZATION_ID,
      })
    );
  });

  it("serves immutable public logo bytes without authenticating", async () => {
    const object = makeStoredObject(WEBP_BYTES);
    const { authRpc, bucket, env } = makeEnv({ object });

    const response = await app.fetch(
      new Request(LOGO_URL),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(response.headers.get("etag")).toBe('"logo-etag"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WEBP_BYTES);
    expect(authRpc.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(bucket.get).toHaveBeenCalledWith(
      buildOrganizationLogoObjectKey({
        assetId: ASSET_ID,
        organizationId: ORGANIZATION_ID,
      })
    );
  });

  it("rejects query variants of immutable public logo URLs", async () => {
    const { authRpc, bucket, env } = makeEnv({
      object: makeStoredObject(WEBP_BYTES),
    });

    const response = await app.fetch(
      new Request(`${LOGO_URL}?download=1`),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(404);
    expect(authRpc.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
