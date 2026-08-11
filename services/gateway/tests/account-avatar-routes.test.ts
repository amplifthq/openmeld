import {
  ACCOUNT_AVATAR_MAX_SIZE_BYTES,
  buildAccountAvatarObjectKey,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayAuthRpcEntrypoint } from "../../auth/src/index";
import type { GatewayRpcEntrypoint } from "../../core/src/index";
import app from "../src/index";

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
const AVATAR_URL = `${GATEWAY_URL}/v1/profile-avatars/${PROFILE_ID}/${ASSET_ID}.webp`;

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

type AuthRpcMock = {
  commitAccountAvatarMutation: ReturnType<
    typeof vi.fn<GatewayAuthRpcEntrypoint["commitAccountAvatarMutation"]>
  >;
  prepareAccountAvatarMutation: ReturnType<
    typeof vi.fn<GatewayAuthRpcEntrypoint["prepareAccountAvatarMutation"]>
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

type AccountAvatarBucketMock = Pick<R2Bucket, "delete" | "get" | "put">;

function makeEnv(input?: {
  commitResult?: Awaited<
    ReturnType<GatewayAuthRpcEntrypoint["commitAccountAvatarMutation"]>
  >;
  currentAvatar?: string | null;
  deleteError?: Error;
  imageInfo?: ImageInfoResponse;
  object?: R2ObjectBody | null;
  prepareResult?: Awaited<
    ReturnType<GatewayAuthRpcEntrypoint["prepareAccountAvatarMutation"]>
  >;
  putError?: Error;
}) {
  let storedObject = input?.object ?? null;
  const claims = {
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
    prepareAccountAvatarMutation: vi.fn(async () =>
      input?.prepareResult
        ? input.prepareResult
        : {
            currentAvatar: input?.currentAvatar ?? null,
            defaultHumanProfileId: PROFILE_ID,
            ok: true,
          }
    ),
    commitAccountAvatarMutation: vi.fn(async (request) =>
      input?.commitResult
        ? input.commitResult
        : {
            avatar:
              (
                request as {
                  nextAvatar?: { url?: string } | null;
                }
              ).nextAvatar?.url ?? null,
            defaultHumanProfileId: PROFILE_ID,
            ok: true,
            sessionCookies: [
              "better-auth.session_data=refreshed; Path=/; HttpOnly",
            ],
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

  const bucket: AccountAvatarBucketMock = {
    delete: vi.fn(() => {
      if (input?.deleteError) {
        return Promise.reject(input.deleteError);
      }
      storedObject = null;
      return Promise.resolve(undefined);
    }),
    get: vi.fn(async () => storedObject),
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
      OPENMELD_ACCOUNT_AVATARS: bucket,
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: {} as GatewayRpcEntrypoint,
      OPENMELD_GATEWAY_URL: GATEWAY_URL,
      OPENMELD_IMAGES: images,
    } as unknown as CloudflareBindings,
    images,
    transformer,
  };
}

function makeUploadRequest(input?: {
  body?: Uint8Array;
  contentLength?: number | null;
  contentType?: string;
  cookie?: string;
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
  if (input?.cookie) {
    headers.set("cookie", input.cookie);
  }
  return new Request("http://local/v1/account/avatar", {
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
    etag: "avatar-etag",
    httpEtag: '"avatar-etag"',
    httpMetadata: {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "image/webp",
    },
    key: buildAccountAvatarObjectKey({
      assetId: ASSET_ID,
      profileId: PROFILE_ID,
    }),
    range: undefined,
    size: bytes.byteLength,
    storageClass: "Standard",
    uploaded: new Date("2026-07-27T00:00:00.000Z"),
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
    uploaded: new Date("2026-07-27T00:00:00.000Z"),
    version: "version-1",
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", "image/webp");
    },
  } satisfies R2Object;
}

async function readError(response: Response) {
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string };
  };
  return payload.error ?? {};
}

describe("Account avatar routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the canonical account avatar instead of the session projection", async () => {
    const { authRpc, env } = makeEnv({
      currentAvatar: null,
    });

    const response = await app.fetch(
      new Request("http://local/v1/account/avatar"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      avatar: null,
      defaultHumanProfileId: PROFILE_ID,
      ok: true,
    });
    expect(authRpc.prepareAccountAvatarMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
    });
    expect(authRpc.commitAccountAvatarMutation).not.toHaveBeenCalled();
  });

  it("authorizes, transforms, stores, and commits an upload", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(ASSET_ID);
    const { authRpc, bucket, env, images, transformer } = makeEnv();

    const response = await app.fetch(
      makeUploadRequest({
        cookie: "better-auth.session_token=original",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      avatar: AVATAR_URL,
      defaultHumanProfileId: PROFILE_ID,
      ok: true,
    });
    expect(authRpc.prepareAccountAvatarMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
    });
    expect(images.info).toHaveBeenCalledTimes(1);
    expect(transformer.transform).toHaveBeenCalledWith({
      fit: "cover",
      gravity: "center",
      height: 512,
      width: 512,
    });
    expect(bucket.put).toHaveBeenCalledWith(
      buildAccountAvatarObjectKey({
        assetId: ASSET_ID,
        profileId: PROFILE_ID,
      }),
      expect.anything(),
      {
        customMetadata: {
          assetId: ASSET_ID,
          profileId: PROFILE_ID,
        },
        httpMetadata: {
          cacheControl: "public, max-age=31536000, immutable",
          contentType: "image/webp",
        },
      }
    );
    expect(authRpc.commitAccountAvatarMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
      expectedAvatar: null,
      expectedDefaultHumanProfileId: PROFILE_ID,
      headers: {
        cookie: "better-auth.session_token=original",
      },
      nextAvatar: {
        assetId: ASSET_ID,
        profileId: PROFILE_ID,
        url: AVATAR_URL,
      },
    });
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_data=refreshed"
    );
  });

  it("rejects invalid input before reading or transforming bytes", async () => {
    const oversized = makeEnv();
    const response = await app.fetch(
      makeUploadRequest({
        contentLength: ACCOUNT_AVATAR_MAX_SIZE_BYTES + 1,
      }),
      oversized.env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("account.avatar.too_large");
    expect(
      oversized.authRpc.prepareAccountAvatarMutation
    ).not.toHaveBeenCalled();
    expect(oversized.images.info).not.toHaveBeenCalled();
  });

  it("removes the new object when the Auth commit conflicts", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(ASSET_ID);
    const { bucket, env } = makeEnv({
      commitResult: {
        code: "account.avatar.conflict",
        message: "Your avatar changed before this update completed.",
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
      buildAccountAvatarObjectKey({
        assetId: ASSET_ID,
        profileId: PROFILE_ID,
      })
    );
  });

  it("commits removal before deleting a previous managed avatar", async () => {
    const { authRpc, bucket, env } = makeEnv({
      currentAvatar: AVATAR_URL,
      object: makeStoredObject(WEBP_BYTES),
    });
    const cacheDelete = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("caches", {
      open: vi.fn(() =>
        Promise.resolve({
          delete: cacheDelete,
          match: vi.fn(() =>
            Promise.resolve(
              new Response(Uint8Array.from(WEBP_BYTES).buffer, {
                headers: {
                  "cache-control": "public, max-age=31536000, immutable",
                  "content-type": "image/webp",
                  etag: '"avatar-etag"',
                },
              })
            )
          ),
        })
      ),
    });

    const response = await app.fetch(
      new Request("http://local/v1/account/avatar", { method: "DELETE" }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      avatar: null,
      defaultHumanProfileId: PROFILE_ID,
      ok: true,
    });
    expect(authRpc.commitAccountAvatarMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
      expectedAvatar: AVATAR_URL,
      expectedDefaultHumanProfileId: PROFILE_ID,
      headers: undefined,
      nextAvatar: null,
    });
    expect(bucket.delete).toHaveBeenCalledWith(
      buildAccountAvatarObjectKey({
        assetId: ASSET_ID,
        profileId: PROFILE_ID,
      })
    );
    expect(cacheDelete).not.toHaveBeenCalled();

    const publicResponse = await app.fetch(
      new Request(AVATAR_URL),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(publicResponse.status).toBe(404);
  });

  it("surfaces a failed managed-avatar deletion after clearing the account reference", async () => {
    const { authRpc, bucket, env } = makeEnv({
      currentAvatar: AVATAR_URL,
      deleteError: new Error("r2 delete unavailable"),
      object: makeStoredObject(WEBP_BYTES),
    });

    const response = await app.fetch(
      new Request("http://local/v1/account/avatar", { method: "DELETE" }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(500);
    expect((await readError(response)).code).toBe(
      "account.avatar.storage_failed"
    );
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_data=refreshed"
    );
    expect(authRpc.commitAccountAvatarMutation).toHaveBeenCalledWith({
      actorUserId: OWNER_USER_ID,
      expectedAvatar: AVATAR_URL,
      expectedDefaultHumanProfileId: PROFILE_ID,
      headers: undefined,
      nextAvatar: null,
    });
    expect(bucket.delete).toHaveBeenCalledWith(
      buildAccountAvatarObjectKey({
        assetId: ASSET_ID,
        profileId: PROFILE_ID,
      })
    );

    const publicResponse = await app.fetch(
      new Request(AVATAR_URL),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(publicResponse.status).toBe(200);
  });

  it("serves immutable public avatar bytes without authenticating", async () => {
    const { authRpc, bucket, env } = makeEnv({
      object: makeStoredObject(WEBP_BYTES),
    });

    const response = await app.fetch(
      new Request(AVATAR_URL),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(response.headers.get("etag")).toBe('"avatar-etag"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WEBP_BYTES);
    expect(authRpc.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(bucket.get).toHaveBeenCalledWith(
      buildAccountAvatarObjectKey({
        assetId: ASSET_ID,
        profileId: PROFILE_ID,
      })
    );
  });
});
