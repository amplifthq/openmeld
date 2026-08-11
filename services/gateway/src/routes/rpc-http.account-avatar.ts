import type { GatewayErrorCode } from "@openmeld/gateway-contract";
import {
  jsonErrorResponse,
  toErrorMessage,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import {
  ACCOUNT_AVATAR_OUTPUT_MIME_TYPE,
  ACCOUNT_AVATAR_PUBLIC_ROUTE_PREFIX,
  ACCOUNT_AVATAR_ROUTE,
  accountAvatarAssetIdSchema,
  accountAvatarProfileIdSchema,
  accountAvatarResponseSchema,
  buildAccountAvatarObjectKey,
  buildAccountAvatarPublicPath,
  parseAccountAvatarReferenceFromUrl,
} from "@openmeld/schemas";
import type { AccountAvatarMutationErrorCode } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import type { IdentityImageError } from "../lib/identity-image";
import {
  inspectIdentityImage,
  matchesIdentityImageMagicBytes,
  parseIdentityImageContentLength,
  parseIdentityImageMimeType,
  readIdentityImageBody,
  transformIdentityImage,
} from "../lib/identity-image";

const ACCOUNT_AVATAR_PUBLIC_ROUTE = `${ACCOUNT_AVATAR_PUBLIC_ROUTE_PREFIX}/:profileId/:assetFile`;
// Keep R2 as the only server-side read source so removing a profile photo makes
// its unique URL unavailable immediately. Clients can still cache immutable
// avatar URLs through the response header below.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const WEBP_FILE_SUFFIX = ".webp";

type AvatarMutationContext = {
  actorUserId: string;
  requestId: string;
};

type AvatarRouteError = {
  code: GatewayErrorCode;
  message: string;
  status: number;
};

export function registerAccountAvatarRoutes(app: Hono<HonoBindings>): void {
  app.get(ACCOUNT_AVATAR_ROUTE, readCurrentAccountAvatar);
  app.put(ACCOUNT_AVATAR_ROUTE, uploadAccountAvatar);
  app.delete(ACCOUNT_AVATAR_ROUTE, removeAccountAvatar);
  app.on(["GET", "HEAD"], ACCOUNT_AVATAR_PUBLIC_ROUTE, readStoredAccountAvatar);
}

async function readCurrentAccountAvatar(
  c: Context<HonoBindings>
): Promise<Response> {
  const mutationContext = readMutationContext(c);
  if (!mutationContext.ok) {
    return respondAvatarError(c, mutationContext.error);
  }
  const current = await prepareMutation(c, mutationContext.value);
  if (!current.ok) {
    return respondAvatarError(c, current.error);
  }
  return respondAvatarSuccess(c, {
    avatar: current.currentAvatar,
    defaultHumanProfileId: current.defaultHumanProfileId,
  });
}

async function uploadAccountAvatar(
  c: Context<HonoBindings>
): Promise<Response> {
  const mutationContext = readMutationContext(c);
  if (!mutationContext.ok) {
    return respondAvatarError(c, mutationContext.error);
  }
  const contentLength = parseIdentityImageContentLength(
    c.req.header("content-length")
  );
  if (!contentLength.ok) {
    return respondAvatarError(c, mapImageError(contentLength.error));
  }
  const mimeType = parseIdentityImageMimeType(c.req.header("content-type"));
  if (!mimeType.ok) {
    return respondAvatarError(c, mapImageError(mimeType.error));
  }
  const bindings = readAvatarBindings(c);
  if (!bindings.ok) {
    return respondAvatarError(c, bindings.error);
  }

  const prepared = await prepareMutation(c, mutationContext.value);
  if (!prepared.ok) {
    return respondAvatarError(c, prepared.error);
  }

  const body = await readIdentityImageBody(c.req.raw, contentLength.value);
  if (!body.ok) {
    return respondAvatarError(c, mapImageError(body.error));
  }
  if (!matchesIdentityImageMagicBytes(body.bytes, mimeType.value)) {
    return respondAvatarError(c, {
      code: "account.avatar.content_mismatch",
      message: "Image bytes do not match the declared Content-Type.",
      status: 415,
    });
  }

  const imageInfo = await inspectIdentityImage(bindings.images, body.bytes);
  if (!imageInfo.ok) {
    return respondAvatarError(c, mapImageError(imageInfo.error));
  }
  const transformed = await transformIdentityImage(bindings.images, body.bytes);
  if (!transformed.ok) {
    return respondAvatarError(c, mapImageError(transformed.error));
  }

  const assetId = crypto.randomUUID();
  const key = buildAccountAvatarObjectKey({
    assetId,
    profileId: prepared.defaultHumanProfileId,
  });
  const publicUrl = new URL(
    buildAccountAvatarPublicPath({
      assetId,
      profileId: prepared.defaultHumanProfileId,
    }),
    bindings.gatewayUrl
  ).toString();

  try {
    const stored = await bindings.bucket.put(key, transformed.stream, {
      customMetadata: {
        assetId,
        profileId: prepared.defaultHumanProfileId,
      },
      httpMetadata: {
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        contentType: ACCOUNT_AVATAR_OUTPUT_MIME_TYPE,
      },
    });
    if (!stored) {
      throw new Error("R2 put returned no stored object metadata.");
    }
  } catch (error) {
    logAvatarFailure("storage_failed", mutationContext.value, error, {
      assetId,
      profileId: prepared.defaultHumanProfileId,
    });
    return respondAvatarError(c, {
      code: "account.avatar.storage_failed",
      message: "Your avatar could not be stored.",
      status: 500,
    });
  }

  const committed = await commitMutation(c, mutationContext.value, {
    expectedAvatar: prepared.currentAvatar,
    expectedDefaultHumanProfileId: prepared.defaultHumanProfileId,
    headers: readSessionHeaders(c.req.raw.headers),
    nextAvatar: {
      assetId,
      profileId: prepared.defaultHumanProfileId,
      url: publicUrl,
    },
  });
  if (!committed.ok) {
    const rolledBack = await deleteStoredAvatar(
      bindings.bucket,
      key,
      mutationContext.value,
      {
        assetId,
        operation: "rollback_new_avatar",
        profileId: prepared.defaultHumanProfileId,
      }
    );
    if (!rolledBack) {
      return respondAvatarError(c, {
        code: "account.avatar.storage_failed",
        message: "The uncommitted avatar could not be removed.",
        status: 500,
      });
    }
    return respondAvatarError(c, committed.error);
  }

  await deletePreviousManagedAvatar({
    bucket: bindings.bucket,
    currentAvatar: prepared.currentAvatar,
    mutationContext: mutationContext.value,
    profileId: committed.defaultHumanProfileId,
  });
  return respondAvatarSuccess(c, {
    avatar: committed.avatar,
    defaultHumanProfileId: committed.defaultHumanProfileId,
    sessionCookies: committed.sessionCookies,
  });
}

async function removeAccountAvatar(
  c: Context<HonoBindings>
): Promise<Response> {
  const mutationContext = readMutationContext(c);
  if (!mutationContext.ok) {
    return respondAvatarError(c, mutationContext.error);
  }
  const bucket = c.env.OPENMELD_ACCOUNT_AVATARS;
  if (!bucket) {
    return respondAvatarError(c, missingBinding("OPENMELD_ACCOUNT_AVATARS"));
  }

  const prepared = await prepareMutation(c, mutationContext.value);
  if (!prepared.ok) {
    return respondAvatarError(c, prepared.error);
  }
  const committed = await commitMutation(c, mutationContext.value, {
    expectedAvatar: prepared.currentAvatar,
    expectedDefaultHumanProfileId: prepared.defaultHumanProfileId,
    headers: readSessionHeaders(c.req.raw.headers),
    nextAvatar: null,
  });
  if (!committed.ok) {
    return respondAvatarError(c, committed.error);
  }

  const removed = await deletePreviousManagedAvatar({
    bucket,
    currentAvatar: prepared.currentAvatar,
    mutationContext: mutationContext.value,
    profileId: committed.defaultHumanProfileId,
  });
  if (!removed) {
    return respondAvatarError(
      c,
      {
        code: "account.avatar.storage_failed",
        message:
          "Your profile photo was cleared, but its stored image could not be removed.",
        status: 500,
      },
      committed.sessionCookies
    );
  }
  return respondAvatarSuccess(c, {
    avatar: null,
    defaultHumanProfileId: committed.defaultHumanProfileId,
    sessionCookies: committed.sessionCookies,
  });
}

async function readStoredAccountAvatar(
  c: Context<HonoBindings>
): Promise<Response> {
  const requestId = c.var.ingressOpenMeldContext.requestId;
  if (new URL(c.req.url).search.length > 0) {
    return publicAvatarNotFound(requestId);
  }
  const profileId = accountAvatarProfileIdSchema.safeParse(
    c.req.param("profileId")
  );
  const assetFile = c.req.param("assetFile");
  const assetId = accountAvatarAssetIdSchema.safeParse(
    assetFile.endsWith(WEBP_FILE_SUFFIX)
      ? assetFile.slice(0, -WEBP_FILE_SUFFIX.length)
      : ""
  );
  if (!(profileId.success && assetId.success)) {
    return publicAvatarNotFound(requestId);
  }

  const bucket = c.env.OPENMELD_ACCOUNT_AVATARS;
  if (!bucket) {
    return jsonErrorResponse({
      code: "gateway.misconfigured",
      message: "Missing worker binding: OPENMELD_ACCOUNT_AVATARS.",
      requestId,
      status: 503,
    });
  }
  const key = buildAccountAvatarObjectKey({
    assetId: assetId.data,
    profileId: profileId.data,
  });
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch (error) {
    logAvatarFailure(
      "public_read_failed",
      { actorUserId: "public", requestId },
      error,
      { assetId: assetId.data, profileId: profileId.data }
    );
    return jsonErrorResponse({
      code: "account.avatar.storage_failed",
      message: "The account avatar could not be read.",
      requestId,
      status: 500,
    });
  }
  if (!object) {
    return publicAvatarNotFound(requestId);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
  headers.set("content-type", ACCOUNT_AVATAR_OUTPUT_MIME_TYPE);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  const response = new Response(object.body, { headers });
  return respondWithPublicAvatar(c, response, requestId);
}

function respondWithPublicAvatar(
  c: Context<HonoBindings>,
  response: Response,
  requestId: string
): Response {
  if (c.req.header("if-none-match") === response.headers.get("etag")) {
    return withRequestIdHeader(
      new Response(null, { headers: response.headers, status: 304 }),
      requestId
    );
  }
  return withRequestIdHeader(
    new Response(c.req.method === "HEAD" ? null : response.body, {
      headers: response.headers,
    }),
    requestId
  );
}

function readMutationContext(
  c: Context<HonoBindings>
):
  | { ok: true; value: AvatarMutationContext }
  | { ok: false; error: AvatarRouteError } {
  const actorUserId = c.var.authClaims.callerPrincipalId?.trim();
  if (!actorUserId) {
    return {
      error: {
        code: "auth.unauthenticated",
        message: "The signed-in user identity is unavailable.",
        status: 401,
      },
      ok: false,
    };
  }
  return {
    ok: true,
    value: {
      actorUserId,
      requestId: c.var.openMeldRequestContext.actorContext.requestId,
    },
  };
}

function readAvatarBindings(c: Context<HonoBindings>):
  | {
      ok: true;
      bucket: R2Bucket;
      gatewayUrl: string;
      images: ImagesBinding;
    }
  | { ok: false; error: AvatarRouteError } {
  if (!c.env.OPENMELD_ACCOUNT_AVATARS) {
    return { error: missingBinding("OPENMELD_ACCOUNT_AVATARS"), ok: false };
  }
  if (!c.env.OPENMELD_IMAGES) {
    return { error: missingBinding("OPENMELD_IMAGES"), ok: false };
  }
  if (!c.env.OPENMELD_GATEWAY_URL) {
    return { error: missingBinding("OPENMELD_GATEWAY_URL"), ok: false };
  }
  return {
    bucket: c.env.OPENMELD_ACCOUNT_AVATARS,
    gatewayUrl: c.env.OPENMELD_GATEWAY_URL,
    images: c.env.OPENMELD_IMAGES,
    ok: true,
  };
}

function missingBinding(binding: string): AvatarRouteError {
  return {
    code: "gateway.misconfigured",
    message: `Missing worker binding: ${binding}.`,
    status: 503,
  };
}

async function prepareMutation(
  c: Context<HonoBindings>,
  mutationContext: AvatarMutationContext
): Promise<
  | {
      ok: true;
      currentAvatar: string | null;
      defaultHumanProfileId: string;
    }
  | { ok: false; error: AvatarRouteError }
> {
  try {
    const result = await c.var.authRpc.prepareAccountAvatarMutation({
      actorUserId: mutationContext.actorUserId,
    });
    return result.ok
      ? {
          currentAvatar: result.currentAvatar,
          defaultHumanProfileId: result.defaultHumanProfileId,
          ok: true,
        }
      : { error: mapMutationError(result.code, result.message), ok: false };
  } catch (error) {
    logAvatarFailure("prepare_failed", mutationContext, error);
    return {
      error: {
        code: "upstream_unreachable",
        message: "Account avatar settings are temporarily unavailable.",
        status: 502,
      },
      ok: false,
    };
  }
}

async function commitMutation(
  c: Context<HonoBindings>,
  mutationContext: AvatarMutationContext,
  input: {
    expectedAvatar: string | null;
    expectedDefaultHumanProfileId: string;
    headers?: Record<string, string>;
    nextAvatar: {
      assetId: string;
      profileId: string;
      url: string;
    } | null;
  }
): Promise<
  | {
      ok: true;
      avatar: string | null;
      defaultHumanProfileId: string;
      sessionCookies?: string[];
    }
  | { ok: false; error: AvatarRouteError }
> {
  try {
    const result = await c.var.authRpc.commitAccountAvatarMutation({
      actorUserId: mutationContext.actorUserId,
      expectedAvatar: input.expectedAvatar,
      expectedDefaultHumanProfileId: input.expectedDefaultHumanProfileId,
      headers: input.headers,
      nextAvatar: input.nextAvatar,
    });
    return result.ok
      ? {
          avatar: result.avatar,
          defaultHumanProfileId: result.defaultHumanProfileId,
          ok: true,
          sessionCookies: result.sessionCookies,
        }
      : { error: mapMutationError(result.code, result.message), ok: false };
  } catch (error) {
    logAvatarFailure("commit_failed", mutationContext, error);
    return {
      error: {
        code: "upstream_unreachable",
        message: "Your avatar update could not be completed.",
        status: 502,
      },
      ok: false,
    };
  }
}

function mapMutationError(
  code: AccountAvatarMutationErrorCode,
  message: string
): AvatarRouteError {
  switch (code) {
    case "account.avatar.conflict":
      return { code, message, status: 409 };
    case "account.avatar.profile_not_found":
      return { code, message, status: 404 };
    case "account.avatar.internal_error":
    case "account.avatar.invalid_input":
    case "account.avatar.invalid_reference":
      return {
        code: "upstream_error",
        message: "Your avatar update could not be completed.",
        status: 502,
      };
    default:
      return {
        code: "upstream_error",
        message: "Your avatar update could not be completed.",
        status: 502,
      };
  }
}

function mapImageError(error: IdentityImageError): AvatarRouteError {
  switch (error.kind) {
    case "image_invalid":
      return {
        code: "account.avatar.invalid_image",
        message: error.message,
        status: error.status,
      };
    case "too_large":
      return {
        code: "account.avatar.too_large",
        message: "Profile photos must be 5 MB or smaller.",
        status: error.status,
      };
    case "transform_failed":
      return {
        code: "account.avatar.transform_failed",
        message: "Your profile photo could not be processed.",
        status: error.status,
      };
    case "type_unsupported":
      return {
        code: "account.avatar.type_unsupported",
        message: "Only JPG, PNG, and WebP profile photos are supported.",
        status: error.status,
      };
    case "content_length_invalid":
    case "content_length_mismatch":
    case "read_failed":
      return {
        code: "invalid_payload",
        message: error.message,
        status: error.status,
      };
    default:
      return {
        code: "invalid_payload",
        message: "The profile photo could not be processed.",
        status: 400,
      };
  }
}

async function deletePreviousManagedAvatar(input: {
  bucket: R2Bucket;
  currentAvatar: string | null;
  mutationContext: AvatarMutationContext;
  profileId: string;
}): Promise<boolean> {
  const publicUrl = input.currentAvatar;
  const previous = parseAccountAvatarReferenceFromUrl(input.currentAvatar);
  if (!publicUrl || previous?.profileId !== input.profileId) {
    return true;
  }
  return await deleteStoredAvatar(
    input.bucket,
    buildAccountAvatarObjectKey(previous),
    input.mutationContext,
    {
      assetId: previous.assetId,
      operation: "delete_previous_avatar",
      profileId: previous.profileId,
    }
  );
}

async function deleteStoredAvatar(
  bucket: R2Bucket,
  key: string,
  mutationContext: AvatarMutationContext,
  input: {
    assetId: string;
    operation: string;
    profileId: string;
  }
): Promise<boolean> {
  try {
    await bucket.delete(key);
    return true;
  } catch (error) {
    logAvatarFailure(input.operation, mutationContext, error, {
      assetId: input.assetId,
      profileId: input.profileId,
    });
    return false;
  }
}

function respondAvatarSuccess(
  c: Context<HonoBindings>,
  input: {
    avatar: string | null;
    defaultHumanProfileId: string;
    sessionCookies?: string[];
  }
): Response {
  const payload = accountAvatarResponseSchema.parse({
    avatar: input.avatar,
    defaultHumanProfileId: input.defaultHumanProfileId,
    ok: true,
  });
  const response = withRequestIdHeader(
    Response.json(payload),
    c.var.openMeldRequestContext.actorContext.requestId
  );
  response.headers.set("cache-control", "private, no-store");
  for (const cookie of input.sessionCookies ?? []) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function readSessionHeaders(
  headers: Headers
): Record<string, string> | undefined {
  const selectedHeaders: Record<string, string> = {};
  for (const name of ["authorization", "cookie"] as const) {
    const value = headers.get(name);
    if (value) {
      selectedHeaders[name] = value;
    }
  }
  return Object.keys(selectedHeaders).length > 0 ? selectedHeaders : undefined;
}

function respondAvatarError(
  c: Context<HonoBindings>,
  error: AvatarRouteError,
  sessionCookies?: string[]
): Response {
  const requestId =
    c.var.openMeldRequestContext?.actorContext.requestId ??
    c.var.ingressOpenMeldContext.requestId;
  console.warn("[gateway.account_avatar.request_rejected]", {
    code: error.code,
    requestId,
    status: error.status,
  });
  const response = jsonErrorResponse({ ...error, requestId });
  for (const cookie of sessionCookies ?? []) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function publicAvatarNotFound(requestId: string): Response {
  return jsonErrorResponse({
    code: "account.avatar.profile_not_found",
    message: "Account avatar not found.",
    requestId,
    status: 404,
  });
}

function logAvatarFailure(
  operation: string,
  context: AvatarMutationContext,
  error: unknown,
  details?: { assetId?: string; profileId?: string }
): void {
  console.error(
    JSON.stringify({
      event: "gateway.account_avatar.failure",
      operation,
      requestId: context.requestId,
      ...(details?.profileId ? { profileId: details.profileId } : {}),
      ...(details?.assetId ? { assetId: details.assetId } : {}),
      error: toErrorMessage(error),
    })
  );
}
