import type { GatewayErrorCode } from "@openmeld/gateway-contract";
import {
  jsonErrorResponse,
  toErrorMessage,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import {
  buildOrganizationLogoObjectKey,
  buildOrganizationLogoPublicPath,
  ORGANIZATION_LOGO_OUTPUT_MIME_TYPE,
  ORGANIZATION_LOGO_PUBLIC_ROUTE_PREFIX,
  ORGANIZATION_LOGO_ROUTE,
  organizationLogoAssetIdSchema,
  organizationLogoOrganizationIdSchema,
  organizationLogoResponseSchema,
  parseOrganizationLogoReferenceFromUrl,
} from "@openmeld/schemas";
import type { OrganizationLogoMutationErrorCode } from "@openmeld/schemas/types";
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

const ORGANIZATION_LOGO_PUBLIC_ROUTE = `${ORGANIZATION_LOGO_PUBLIC_ROUTE_PREFIX}/:organizationId/:assetFile`;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const WEBP_FILE_SUFFIX = ".webp";

type LogoMutationContext = {
  actorUserId: string;
  organizationId: string;
  requestId: string;
};

type LogoRouteError = {
  code: GatewayErrorCode;
  message: string;
  status: number;
};

export function registerOrganizationLogoRoutes(app: Hono<HonoBindings>): void {
  app.put(ORGANIZATION_LOGO_ROUTE, uploadOrganizationLogo);
  app.delete(ORGANIZATION_LOGO_ROUTE, removeOrganizationLogo);
  app.on(["GET", "HEAD"], ORGANIZATION_LOGO_PUBLIC_ROUTE, readOrganizationLogo);
}

async function uploadOrganizationLogo(
  c: Context<HonoBindings>
): Promise<Response> {
  const mutationContext = readMutationContext(c);
  if (!mutationContext.ok) {
    return respondLogoError(c, mutationContext.error);
  }
  const contentLength = parseIdentityImageContentLength(
    c.req.header("content-length")
  );
  if (!contentLength.ok) {
    return respondLogoError(c, mapImageError(contentLength.error));
  }
  const mimeType = parseIdentityImageMimeType(c.req.header("content-type"));
  if (!mimeType.ok) {
    return respondLogoError(c, mapImageError(mimeType.error));
  }
  const bindings = readLogoBindings(c);
  if (!bindings.ok) {
    return respondLogoError(c, bindings.error);
  }

  const prepared = await prepareMutation(c, mutationContext.value);
  if (!prepared.ok) {
    return respondLogoError(c, prepared.error);
  }

  const body = await readIdentityImageBody(c.req.raw, contentLength.value);
  if (!body.ok) {
    return respondLogoError(c, mapImageError(body.error));
  }
  if (!matchesIdentityImageMagicBytes(body.bytes, mimeType.value)) {
    return respondLogoError(c, {
      code: "organization.logo.content_mismatch",
      message: "Image bytes do not match the declared Content-Type.",
      status: 415,
    });
  }

  const imageInfo = await inspectIdentityImage(bindings.images, body.bytes);
  if (!imageInfo.ok) {
    return respondLogoError(c, mapImageError(imageInfo.error));
  }

  const transformed = await transformIdentityImage(bindings.images, body.bytes);
  if (!transformed.ok) {
    return respondLogoError(c, mapImageError(transformed.error));
  }

  const assetId = crypto.randomUUID();
  const key = buildOrganizationLogoObjectKey({
    assetId,
    organizationId: mutationContext.value.organizationId,
  });
  const publicUrl = new URL(
    buildOrganizationLogoPublicPath({
      assetId,
      organizationId: mutationContext.value.organizationId,
    }),
    bindings.gatewayUrl
  ).toString();

  try {
    const stored = await bindings.bucket.put(key, transformed.stream, {
      customMetadata: {
        assetId,
        organizationId: mutationContext.value.organizationId,
      },
      httpMetadata: {
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        contentType: ORGANIZATION_LOGO_OUTPUT_MIME_TYPE,
      },
    });
    if (!stored) {
      throw new Error("R2 put returned no stored object metadata.");
    }
  } catch (error) {
    logLogoFailure("storage_failed", mutationContext.value, error, { assetId });
    return respondLogoError(c, {
      code: "organization.logo.storage_failed",
      message: "The organization logo could not be stored.",
      status: 500,
    });
  }

  const committed = await commitMutation(c, mutationContext.value, {
    expectedLogo: prepared.currentLogo,
    nextLogo: { assetId, url: publicUrl },
  });
  if (!committed.ok) {
    const rolledBack = await deleteStoredLogo(
      bindings.bucket,
      key,
      mutationContext.value,
      {
        assetId,
        operation: "rollback_new_logo",
      }
    );
    if (!rolledBack) {
      return respondLogoError(c, {
        code: "organization.logo.storage_failed",
        message: "The uncommitted organization logo could not be removed.",
        status: 500,
      });
    }
    return respondLogoError(c, committed.error);
  }

  await deletePreviousManagedLogo({
    bucket: bindings.bucket,
    currentLogo: prepared.currentLogo,
    mutationContext: mutationContext.value,
  });
  return respondLogoSuccess(c, committed.logo);
}

async function removeOrganizationLogo(
  c: Context<HonoBindings>
): Promise<Response> {
  const mutationContext = readMutationContext(c);
  if (!mutationContext.ok) {
    return respondLogoError(c, mutationContext.error);
  }
  const bucket = c.env.OPENMELD_ORGANIZATION_LOGOS;
  if (!bucket) {
    return respondLogoError(c, missingBinding("OPENMELD_ORGANIZATION_LOGOS"));
  }

  const prepared = await prepareMutation(c, mutationContext.value);
  if (!prepared.ok) {
    return respondLogoError(c, prepared.error);
  }
  const committed = await commitMutation(c, mutationContext.value, {
    expectedLogo: prepared.currentLogo,
    nextLogo: null,
  });
  if (!committed.ok) {
    return respondLogoError(c, committed.error);
  }

  await deletePreviousManagedLogo({
    bucket,
    currentLogo: prepared.currentLogo,
    mutationContext: mutationContext.value,
  });
  return respondLogoSuccess(c, null);
}

async function readOrganizationLogo(
  c: Context<HonoBindings>
): Promise<Response> {
  const requestId = c.var.ingressOpenMeldContext.requestId;
  if (new URL(c.req.url).search.length > 0) {
    return publicLogoNotFound(requestId);
  }
  const organizationId = organizationLogoOrganizationIdSchema.safeParse(
    c.req.param("organizationId")
  );
  const assetFile = c.req.param("assetFile");
  const assetId = organizationLogoAssetIdSchema.safeParse(
    assetFile.endsWith(WEBP_FILE_SUFFIX)
      ? assetFile.slice(0, -WEBP_FILE_SUFFIX.length)
      : ""
  );
  if (!(organizationId.success && assetId.success)) {
    return publicLogoNotFound(requestId);
  }
  const cacheKey = new Request(c.req.url, { method: "GET" });
  let cache: Cache | null = null;
  try {
    cache = await caches.open("organization-logos-v1");
    const cached = await cache.match(cacheKey);
    if (cached) {
      return respondWithPublicLogo(c, cached, requestId);
    }
  } catch (error) {
    logLogoFailure(
      "cache_read_failed",
      {
        actorUserId: "public",
        organizationId: organizationId.data,
        requestId,
      },
      error,
      { assetId: assetId.data }
    );
  }
  const bucket = c.env.OPENMELD_ORGANIZATION_LOGOS;
  if (!bucket) {
    return jsonErrorResponse({
      code: "gateway.misconfigured",
      message: "Missing worker binding: OPENMELD_ORGANIZATION_LOGOS.",
      requestId,
      status: 503,
    });
  }

  const key = buildOrganizationLogoObjectKey({
    assetId: assetId.data,
    organizationId: organizationId.data,
  });
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch (error) {
    logLogoFailure(
      "public_read_failed",
      {
        actorUserId: "public",
        organizationId: organizationId.data,
        requestId,
      },
      error,
      { assetId: assetId.data }
    );
    return jsonErrorResponse({
      code: "organization.logo.storage_failed",
      message: "The organization logo could not be read.",
      requestId,
      status: 500,
    });
  }
  if (!object) {
    return publicLogoNotFound(requestId);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
  headers.set("content-type", ORGANIZATION_LOGO_OUTPUT_MIME_TYPE);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  const response = new Response(object.body, { headers });
  if (cache) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch (error) {
      logLogoFailure(
        "cache_write_failed",
        {
          actorUserId: "public",
          organizationId: organizationId.data,
          requestId,
        },
        error,
        { assetId: assetId.data }
      );
    }
  }
  return respondWithPublicLogo(c, response, requestId);
}

function respondWithPublicLogo(
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
  | { ok: true; value: LogoMutationContext }
  | { ok: false; error: LogoRouteError } {
  const actorUserId = c.var.authClaims.callerPrincipalId?.trim();
  const organizationId = c.var.authClaims.activeOrganizationId?.trim();
  if (!actorUserId) {
    return {
      error: {
        code: "organization.context_unavailable",
        message: "The signed-in user identity is unavailable.",
        status: 403,
      },
      ok: false,
    };
  }
  const parsedOrganizationId =
    organizationLogoOrganizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return {
      error: {
        code: "organization.context_required",
        message: "Select an organization before changing its logo.",
        status: 400,
      },
      ok: false,
    };
  }
  return {
    ok: true,
    value: {
      actorUserId,
      organizationId: parsedOrganizationId.data,
      requestId: c.var.openMeldRequestContext.actorContext.requestId,
    },
  };
}

function readLogoBindings(c: Context<HonoBindings>):
  | {
      ok: true;
      bucket: R2Bucket;
      gatewayUrl: string;
      images: ImagesBinding;
    }
  | { ok: false; error: LogoRouteError } {
  if (!c.env.OPENMELD_ORGANIZATION_LOGOS) {
    return { error: missingBinding("OPENMELD_ORGANIZATION_LOGOS"), ok: false };
  }
  if (!c.env.OPENMELD_IMAGES) {
    return { error: missingBinding("OPENMELD_IMAGES"), ok: false };
  }
  if (!c.env.OPENMELD_GATEWAY_URL) {
    return { error: missingBinding("OPENMELD_GATEWAY_URL"), ok: false };
  }
  return {
    bucket: c.env.OPENMELD_ORGANIZATION_LOGOS,
    gatewayUrl: c.env.OPENMELD_GATEWAY_URL,
    images: c.env.OPENMELD_IMAGES,
    ok: true,
  };
}

function missingBinding(binding: string): LogoRouteError {
  return {
    code: "gateway.misconfigured",
    message: `Missing worker binding: ${binding}.`,
    status: 503,
  };
}

async function prepareMutation(
  c: Context<HonoBindings>,
  mutationContext: LogoMutationContext
): Promise<
  | { ok: true; currentLogo: string | null }
  | { ok: false; error: LogoRouteError }
> {
  try {
    const result = await c.var.authRpc.prepareOrganizationLogoMutation({
      actorUserId: mutationContext.actorUserId,
      organizationId: mutationContext.organizationId,
    });
    return result.ok
      ? { currentLogo: result.currentLogo, ok: true }
      : { error: mapMutationError(result.code, result.message), ok: false };
  } catch (error) {
    logLogoFailure("prepare_failed", mutationContext, error);
    return {
      error: {
        code: "upstream_unreachable",
        message: "Organization logo settings are temporarily unavailable.",
        status: 502,
      },
      ok: false,
    };
  }
}

async function commitMutation(
  c: Context<HonoBindings>,
  mutationContext: LogoMutationContext,
  input: {
    expectedLogo: string | null;
    nextLogo: { assetId: string; url: string } | null;
  }
): Promise<
  { ok: true; logo: string | null } | { ok: false; error: LogoRouteError }
> {
  try {
    const result = await c.var.authRpc.commitOrganizationLogoMutation({
      actorUserId: mutationContext.actorUserId,
      expectedLogo: input.expectedLogo,
      nextLogo: input.nextLogo,
      organizationId: mutationContext.organizationId,
    });
    return result.ok
      ? { logo: result.logo, ok: true }
      : { error: mapMutationError(result.code, result.message), ok: false };
  } catch (error) {
    logLogoFailure("commit_failed", mutationContext, error);
    return {
      error: {
        code: "upstream_unreachable",
        message: "The organization logo update could not be completed.",
        status: 502,
      },
      ok: false,
    };
  }
}

function mapMutationError(
  code: OrganizationLogoMutationErrorCode,
  message: string
): LogoRouteError {
  switch (code) {
    case "organization.logo.conflict":
      return { code, message, status: 409 };
    case "organization.logo.forbidden":
      return { code, message, status: 403 };
    case "organization.logo.metadata_invalid":
      return { code, message, status: 409 };
    case "organization.logo.not_found":
      return { code, message, status: 404 };
    case "organization.logo.personal_unsupported":
      return { code, message, status: 400 };
    case "organization.logo.internal_error":
    case "organization.logo.invalid_input":
    case "organization.logo.invalid_reference":
      return {
        code: "upstream_error",
        message: "The organization logo update could not be completed.",
        status: 502,
      };
    default:
      return {
        code: "upstream_error",
        message: "The organization logo update could not be completed.",
        status: 502,
      };
  }
}

function mapImageError(error: IdentityImageError): LogoRouteError {
  switch (error.kind) {
    case "image_invalid":
      return {
        code: "organization.logo.invalid_image",
        message: error.message,
        status: error.status,
      };
    case "too_large":
      return {
        code: "organization.logo.too_large",
        message: "Organization logos must be 5 MB or smaller.",
        status: error.status,
      };
    case "transform_failed":
      return {
        code: "organization.logo.transform_failed",
        message: "The organization logo could not be processed.",
        status: error.status,
      };
    case "type_unsupported":
      return {
        code: "organization.logo.type_unsupported",
        message: "Only JPG, PNG, and WebP organization logos are supported.",
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
        message: "The organization logo could not be processed.",
        status: 400,
      };
  }
}

async function deletePreviousManagedLogo(input: {
  bucket: R2Bucket;
  currentLogo: string | null;
  mutationContext: LogoMutationContext;
}): Promise<void> {
  const previous = parseOrganizationLogoReferenceFromUrl(input.currentLogo);
  if (previous?.organizationId !== input.mutationContext.organizationId) {
    return;
  }
  await deleteStoredLogo(
    input.bucket,
    buildOrganizationLogoObjectKey(previous),
    input.mutationContext,
    { assetId: previous.assetId, operation: "delete_previous_logo" }
  );
}

async function deleteStoredLogo(
  bucket: R2Bucket,
  key: string,
  mutationContext: LogoMutationContext,
  input: { assetId: string; operation: string }
): Promise<boolean> {
  try {
    await bucket.delete(key);
    return true;
  } catch (error) {
    logLogoFailure(input.operation, mutationContext, error, {
      assetId: input.assetId,
    });
    return false;
  }
}

function respondLogoSuccess(
  c: Context<HonoBindings>,
  logo: string | null
): Response {
  const payload = organizationLogoResponseSchema.parse({ logo, ok: true });
  return withRequestIdHeader(
    Response.json(payload),
    c.var.openMeldRequestContext.actorContext.requestId
  );
}

function respondLogoError(
  c: Context<HonoBindings>,
  error: LogoRouteError
): Response {
  const requestId =
    c.var.openMeldRequestContext?.actorContext.requestId ??
    c.var.ingressOpenMeldContext.requestId;
  console.warn("[gateway.organization_logo.request_rejected]", {
    code: error.code,
    requestId,
    status: error.status,
  });
  return jsonErrorResponse({ ...error, requestId });
}

function publicLogoNotFound(requestId: string): Response {
  return jsonErrorResponse({
    code: "organization.logo.not_found",
    message: "Organization logo not found.",
    requestId,
    status: 404,
  });
}

function logLogoFailure(
  operation: string,
  context: LogoMutationContext,
  error: unknown,
  details?: { assetId?: string }
): void {
  console.error(
    JSON.stringify({
      event: "gateway.organization_logo.failure",
      operation,
      organizationId: context.organizationId,
      requestId: context.requestId,
      ...(details?.assetId ? { assetId: details.assetId } : {}),
      error: toErrorMessage(error),
    })
  );
}
