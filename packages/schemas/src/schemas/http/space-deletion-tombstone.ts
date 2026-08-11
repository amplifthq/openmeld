import { z } from "zod/v4";
import { profileSpaceCreatorKindSchema } from "./profile-space-history";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const GATEWAY_HOST_MAX_LENGTH = 255;
const SPACE_DELETION_TOMBSTONE_QUERY_MAX_SPACE_IDS = 500;
const GATEWAY_HOST_PATH_CHARS_RE = /[/?#]/;

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);

const gatewayHostSchema = z
  .string()
  .transform((value, ctx) => {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "gatewayHost is required",
      });
      return z.NEVER;
    }

    if (normalized.includes("://")) {
      try {
        const url = new URL(normalized);
        const hasPath = url.pathname !== "/";
        if (hasPath || url.search.length > 0 || url.hash.length > 0) {
          ctx.addIssue({
            code: "custom",
            message: "gatewayHost must not include path/query/hash",
          });
          return z.NEVER;
        }
        if (url.host.length === 0) {
          ctx.addIssue({
            code: "custom",
            message: "gatewayHost is required",
          });
          return z.NEVER;
        }
        return url.host.toLowerCase();
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "gatewayHost must be a valid host",
        });
        return z.NEVER;
      }
    }

    if (GATEWAY_HOST_PATH_CHARS_RE.test(normalized)) {
      ctx.addIssue({
        code: "custom",
        message: "gatewayHost must not include path/query/hash",
      });
      return z.NEVER;
    }

    return normalized;
  })
  .pipe(z.string().max(GATEWAY_HOST_MAX_LENGTH));

export const spaceDeletionTombstoneRecordSchema = z.strictObject({
  gatewayHost: gatewayHostSchema,
  spaceId: trimmedNonEmptyStringSchema,
  spaceName: nullableTrimmedStringSchema,
  creatorProfileId: nullableTrimmedStringSchema,
  creatorKind: z.union([profileSpaceCreatorKindSchema, z.null()]),
  deletedByProfileId: nullableTrimmedStringSchema,
  deletedByProfileName: nullableTrimmedStringSchema,
  deletedByOwnerUserId: nullableTrimmedStringSchema,
  deletedAt: ISO_DATE_TIME_SCHEMA,
  createdAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});

export const upsertSpaceDeletionTombstoneBodySchema = z.strictObject({
  gatewayHost: gatewayHostSchema,
  spaceName: nullableTrimmedStringSchema.optional(),
  creatorProfileId: nullableTrimmedStringSchema.optional(),
  creatorKind: z.union([profileSpaceCreatorKindSchema, z.null()]).optional(),
  deletedByProfileId: nullableTrimmedStringSchema.optional(),
  deletedByProfileName: nullableTrimmedStringSchema.optional(),
  deletedByOwnerUserId: nullableTrimmedStringSchema.optional(),
  deletedAt: ISO_DATE_TIME_SCHEMA.optional(),
});

export const upsertSpaceDeletionTombstoneResponseSchema = z.strictObject({
  item: spaceDeletionTombstoneRecordSchema,
});

export const querySpaceDeletionTombstonesBodySchema = z.strictObject({
  gatewayHost: gatewayHostSchema,
  spaceIds: z
    .array(trimmedNonEmptyStringSchema)
    .min(1)
    .max(SPACE_DELETION_TOMBSTONE_QUERY_MAX_SPACE_IDS)
    .transform((values) => Array.from(new Set(values))),
});

export const querySpaceDeletionTombstonesResponseSchema = z.strictObject({
  items: z.array(spaceDeletionTombstoneRecordSchema),
});
