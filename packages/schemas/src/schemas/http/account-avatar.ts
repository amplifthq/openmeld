import * as z from "zod/v4";
import {
  IDENTITY_IMAGE_MAX_DIMENSION,
  IDENTITY_IMAGE_MAX_PIXELS,
  IDENTITY_IMAGE_MAX_SIZE_BYTES,
  IDENTITY_IMAGE_OUTPUT_MIME_TYPE,
  IDENTITY_IMAGE_OUTPUT_SIZE,
  identityImageMimeTypeSchema,
} from "./identity-image";

export const ACCOUNT_AVATAR_MAX_SIZE_BYTES = IDENTITY_IMAGE_MAX_SIZE_BYTES;
export const ACCOUNT_AVATAR_MAX_DIMENSION = IDENTITY_IMAGE_MAX_DIMENSION;
export const ACCOUNT_AVATAR_MAX_PIXELS = IDENTITY_IMAGE_MAX_PIXELS;
export const ACCOUNT_AVATAR_OUTPUT_SIZE = IDENTITY_IMAGE_OUTPUT_SIZE;
export const ACCOUNT_AVATAR_OUTPUT_MIME_TYPE = IDENTITY_IMAGE_OUTPUT_MIME_TYPE;
export const ACCOUNT_AVATAR_ROUTE = "/v1/account/avatar" as const;
export const ACCOUNT_AVATAR_PUBLIC_ROUTE_PREFIX =
  "/v1/profile-avatars" as const;

export const accountAvatarMimeTypeSchema = identityImageMimeTypeSchema;
export const accountAvatarProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_-]+$/u);
export const accountAvatarAssetIdSchema = z.uuid();
export const accountAvatarStoredUrlSchema = z.string().trim().min(1).max(2048);

export const accountAvatarReferenceSchema = z.strictObject({
  assetId: accountAvatarAssetIdSchema,
  profileId: accountAvatarProfileIdSchema,
  url: z.url().max(2048),
});

export const accountAvatarPrepareRpcInputSchema = z.strictObject({
  actorUserId: z.string().trim().min(1).max(255),
});

export const accountAvatarCommitRpcInputSchema = z.strictObject({
  actorUserId: z.string().trim().min(1).max(255),
  expectedAvatar: accountAvatarStoredUrlSchema.nullable(),
  expectedDefaultHumanProfileId: accountAvatarProfileIdSchema,
  headers: z.record(z.string(), z.string()).optional(),
  nextAvatar: accountAvatarReferenceSchema.nullable(),
});

export const accountAvatarMutationErrorCodeSchema = z.enum([
  "account.avatar.conflict",
  "account.avatar.internal_error",
  "account.avatar.invalid_input",
  "account.avatar.invalid_reference",
  "account.avatar.profile_not_found",
]);

const accountAvatarMutationFailureSchema = z.strictObject({
  code: accountAvatarMutationErrorCodeSchema,
  message: z.string().trim().min(1),
  ok: z.literal(false),
});

export const accountAvatarPrepareRpcResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      currentAvatar: accountAvatarStoredUrlSchema.nullable(),
      defaultHumanProfileId: accountAvatarProfileIdSchema,
      ok: z.literal(true),
    }),
    accountAvatarMutationFailureSchema,
  ]
);

export const accountAvatarCommitRpcResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    avatar: z.url().max(2048).nullable(),
    defaultHumanProfileId: accountAvatarProfileIdSchema,
    ok: z.literal(true),
    sessionCookies: z
      .array(z.string().trim().min(1).max(4096))
      .max(4)
      .optional(),
  }),
  accountAvatarMutationFailureSchema,
]);

export const accountAvatarResponseSchema = z.strictObject({
  avatar: z.url().max(2048).nullable(),
  defaultHumanProfileId: accountAvatarProfileIdSchema,
  ok: z.literal(true),
});

export function buildAccountAvatarObjectKey(input: {
  assetId: string;
  profileId: string;
}): string {
  const parsed = parseAccountAvatarAddress(input);
  return `profiles/${parsed.profileId}/avatars/${parsed.assetId}.webp`;
}

export function buildAccountAvatarPublicPath(input: {
  assetId: string;
  profileId: string;
}): string {
  const parsed = parseAccountAvatarAddress(input);
  return `${ACCOUNT_AVATAR_PUBLIC_ROUTE_PREFIX}/${encodeURIComponent(
    parsed.profileId
  )}/${parsed.assetId}.webp`;
}

export function parseAccountAvatarReferenceFromUrl(
  value: unknown
): { assetId: string; profileId: string } | null {
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

  const prefix = `${ACCOUNT_AVATAR_PUBLIC_ROUTE_PREFIX}/`;
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }
  const segments = url.pathname.slice(prefix.length).split("/");
  if (segments.length !== 2) {
    return null;
  }

  let profileId: string;
  try {
    profileId = decodeURIComponent(segments[0] ?? "");
  } catch {
    return null;
  }
  const fileName = segments[1] ?? "";
  if (!fileName.endsWith(".webp")) {
    return null;
  }
  const parsed = z
    .strictObject({
      assetId: accountAvatarAssetIdSchema,
      profileId: accountAvatarProfileIdSchema,
    })
    .safeParse({
      assetId: fileName.slice(0, -".webp".length),
      profileId,
    });
  return parsed.success ? parsed.data : null;
}

function parseAccountAvatarAddress(input: {
  assetId: string;
  profileId: string;
}): { assetId: string; profileId: string } {
  return z
    .strictObject({
      assetId: accountAvatarAssetIdSchema,
      profileId: accountAvatarProfileIdSchema,
    })
    .parse(input);
}
