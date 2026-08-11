import { z } from "zod/v4";
import {
  IDENTITY_IMAGE_MAX_DIMENSION,
  IDENTITY_IMAGE_MAX_PIXELS,
  IDENTITY_IMAGE_MAX_SIZE_BYTES,
  IDENTITY_IMAGE_OUTPUT_MIME_TYPE,
  IDENTITY_IMAGE_OUTPUT_SIZE,
  identityImageMimeTypeSchema,
} from "./identity-image";

export const ORGANIZATION_LOGO_MAX_SIZE_BYTES = IDENTITY_IMAGE_MAX_SIZE_BYTES;
export const ORGANIZATION_LOGO_MAX_DIMENSION = IDENTITY_IMAGE_MAX_DIMENSION;
export const ORGANIZATION_LOGO_MAX_PIXELS = IDENTITY_IMAGE_MAX_PIXELS;
export const ORGANIZATION_LOGO_OUTPUT_SIZE = IDENTITY_IMAGE_OUTPUT_SIZE;
export const ORGANIZATION_LOGO_OUTPUT_MIME_TYPE =
  IDENTITY_IMAGE_OUTPUT_MIME_TYPE;
export const ORGANIZATION_LOGO_ROUTE =
  "/v1/organizations/current/logo" as const;
export const ORGANIZATION_LOGO_PUBLIC_ROUTE_PREFIX =
  "/v1/organization-logos" as const;

export const organizationLogoMimeTypeSchema = identityImageMimeTypeSchema;

export const organizationLogoOrganizationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_-]+$/u);

export const organizationLogoAssetIdSchema = z.uuid();
export const organizationLogoStoredUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048);

export const organizationLogoReferenceSchema = z.strictObject({
  assetId: organizationLogoAssetIdSchema,
  url: z.url().max(2048),
});

export const organizationLogoPrepareRpcInputSchema = z.strictObject({
  actorUserId: z.string().trim().min(1).max(255),
  organizationId: organizationLogoOrganizationIdSchema,
});

export const organizationLogoCommitRpcInputSchema = z.strictObject({
  actorUserId: z.string().trim().min(1).max(255),
  expectedLogo: organizationLogoStoredUrlSchema.nullable(),
  nextLogo: organizationLogoReferenceSchema.nullable(),
  organizationId: organizationLogoOrganizationIdSchema,
});

export const organizationLogoMutationErrorCodeSchema = z.enum([
  "organization.logo.conflict",
  "organization.logo.forbidden",
  "organization.logo.internal_error",
  "organization.logo.invalid_input",
  "organization.logo.invalid_reference",
  "organization.logo.metadata_invalid",
  "organization.logo.not_found",
  "organization.logo.personal_unsupported",
]);

const organizationLogoMutationFailureSchema = z.strictObject({
  code: organizationLogoMutationErrorCodeSchema,
  message: z.string().trim().min(1),
  ok: z.literal(false),
});

export const organizationLogoPrepareRpcResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      currentLogo: organizationLogoStoredUrlSchema.nullable(),
      ok: z.literal(true),
    }),
    organizationLogoMutationFailureSchema,
  ]
);

export const organizationLogoCommitRpcResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      logo: z.url().max(2048).nullable(),
      ok: z.literal(true),
    }),
    organizationLogoMutationFailureSchema,
  ]
);

export const organizationLogoResponseSchema = z.strictObject({
  logo: z.url().max(2048).nullable(),
  ok: z.literal(true),
});

export function buildOrganizationLogoObjectKey(input: {
  assetId: string;
  organizationId: string;
}): string {
  const parsed = parseOrganizationLogoAddress(input);
  return `organizations/${parsed.organizationId}/logos/${parsed.assetId}.webp`;
}

export function buildOrganizationLogoPublicPath(input: {
  assetId: string;
  organizationId: string;
}): string {
  const parsed = parseOrganizationLogoAddress(input);
  return `${ORGANIZATION_LOGO_PUBLIC_ROUTE_PREFIX}/${encodeURIComponent(
    parsed.organizationId
  )}/${parsed.assetId}.webp`;
}

export function parseOrganizationLogoReferenceFromUrl(
  value: unknown
): { assetId: string; organizationId: string } | null {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return null;
  }

  const prefix = `${ORGANIZATION_LOGO_PUBLIC_ROUTE_PREFIX}/`;
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }
  const segments = url.pathname.slice(prefix.length).split("/");
  if (segments.length !== 2) {
    return null;
  }

  let organizationId: string;
  try {
    organizationId = decodeURIComponent(segments[0] ?? "");
  } catch {
    return null;
  }
  const fileName = segments[1] ?? "";
  if (!fileName.endsWith(".webp")) {
    return null;
  }
  const parsed = z
    .strictObject({
      assetId: organizationLogoAssetIdSchema,
      organizationId: organizationLogoOrganizationIdSchema,
    })
    .safeParse({
      assetId: fileName.slice(0, -".webp".length),
      organizationId,
    });
  return parsed.success ? parsed.data : null;
}

function parseOrganizationLogoAddress(input: {
  assetId: string;
  organizationId: string;
}): { assetId: string; organizationId: string } {
  return z
    .strictObject({
      assetId: organizationLogoAssetIdSchema,
      organizationId: organizationLogoOrganizationIdSchema,
    })
    .parse(input);
}
