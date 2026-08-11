import { z } from "zod/v4";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const GATEWAY_HOST_MAX_LENGTH = 255;
const PROFILE_SPACE_HISTORY_MAX_LIMIT = 500;
const NON_NEGATIVE_INT_RE = /^\d+$/;
const GATEWAY_HOST_PATH_CHARS_RE = /[/?#]/;

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);
const nullableNonNegativeIntSchema = z.union([
  z.number().int().min(0),
  z.null(),
]);
const nullableIsoDateTimeSchema = z.union([ISO_DATE_TIME_SCHEMA, z.null()]);

export const profileSpaceHistoryGatewayHostSchema = z
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

const profileSpaceHistoryLimitSchema = z
  .preprocess((value) => {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value !== "string") {
      return value;
    }

    const normalized = value.trim();
    if (!NON_NEGATIVE_INT_RE.test(normalized)) {
      return Number.NaN;
    }
    return Number.parseInt(normalized, 10);
  }, z.number().int().min(1).max(PROFILE_SPACE_HISTORY_MAX_LIMIT))
  .optional();

const profileSpaceHistoryPinnedFilterSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((value) => {
    if (value === undefined || typeof value === "boolean") {
      return value;
    }

    return value === "true";
  });

export const profileSpaceHistoryStatusSchema = z.enum([
  "active",
  "removed",
  "inaccessible",
]);

export const profileSpaceCreatorKindSchema = z.enum([
  "human",
  "agent",
  "system",
]);

const profileSpaceHistoryStatusListSchema = z
  .union([
    profileSpaceHistoryStatusSchema,
    z.array(profileSpaceHistoryStatusSchema),
  ])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    return Array.isArray(value) ? value : [value];
  });

export const profileSpaceHistoryRecordSchema = z.strictObject({
  profileId: trimmedNonEmptyStringSchema,
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
  spaceId: trimmedNonEmptyStringSchema,
  spaceName: nullableTrimmedStringSchema,
  creatorProfileId: nullableTrimmedStringSchema,
  creatorKind: z.union([profileSpaceCreatorKindSchema, z.null()]),
  spaceCreatedAt: nullableIsoDateTimeSchema,
  spaceUpdatedAt: nullableIsoDateTimeSchema,
  lastJoinedAt: ISO_DATE_TIME_SCHEMA,
  lastSeenTs: nullableNonNegativeIntSchema,
  pinnedAt: nullableIsoDateTimeSchema,
  status: profileSpaceHistoryStatusSchema,
  createdAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});

export const listProfileSpaceHistoryQuerySchema = z.strictObject({
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
  status: profileSpaceHistoryStatusListSchema,
  limit: profileSpaceHistoryLimitSchema,
  pinned: profileSpaceHistoryPinnedFilterSchema,
});

export const listProfileSpaceHistoryResponseSchema = z.strictObject({
  items: z.array(profileSpaceHistoryRecordSchema),
});

export const profileSpaceHistorySpaceIndexOverlaySchema = z.strictObject({
  repairAttempted: z.boolean(),
  status: z.enum(["applied", "degraded", "pending"]),
  updated: z.boolean(),
});

export const upsertProfileSpaceHistoryBodySchema = z.strictObject({
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
  spaceName: nullableTrimmedStringSchema.optional(),
  creatorProfileId: nullableTrimmedStringSchema.optional(),
  creatorKind: z.union([profileSpaceCreatorKindSchema, z.null()]).optional(),
  spaceCreatedAt: nullableIsoDateTimeSchema.optional(),
  spaceUpdatedAt: nullableIsoDateTimeSchema.optional(),
  lastJoinedAt: ISO_DATE_TIME_SCHEMA.optional(),
  lastSeenTs: nullableNonNegativeIntSchema.optional(),
  pinnedAt: nullableIsoDateTimeSchema.optional(),
  status: profileSpaceHistoryStatusSchema.optional(),
});

export const upsertProfileSpaceHistoryResponseSchema = z.strictObject({
  item: profileSpaceHistoryRecordSchema,
  spaceIndexOverlay: profileSpaceHistorySpaceIndexOverlaySchema,
});

export const patchProfileSpaceHistoryStatusBodySchema = z.strictObject({
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
  status: profileSpaceHistoryStatusSchema,
  reason: z.string().trim().min(1).max(500).optional(),
});

export const patchProfileSpaceHistoryStatusResponseSchema = z.strictObject({
  profileId: trimmedNonEmptyStringSchema,
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
  spaceId: trimmedNonEmptyStringSchema,
  status: profileSpaceHistoryStatusSchema,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});
