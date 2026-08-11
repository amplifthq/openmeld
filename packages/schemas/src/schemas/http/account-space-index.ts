import { z } from "zod/v4";
import {
  profileSpaceCreatorKindSchema,
  profileSpaceHistoryGatewayHostSchema,
} from "./profile-space-history";
import { spaceOrganizationVisibilitySchema } from "./space-meta";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
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
const ACCOUNT_SPACE_INDEX_MAX_LIMIT = 500;
const NON_NEGATIVE_INT_RE = /^\d+$/;
export const accountSpaceIndexScopeSchema = z.enum(["account", "profile"]);

export const accountSpaceIndexLimitSchema = z
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
  }, z.number().int().min(1).max(ACCOUNT_SPACE_INDEX_MAX_LIMIT))
  .optional();

// Opt-in flag (query string "true"). Lets the Web request the recently-deleted
// notice payload while strict legacy clients (e.g. the published CLI) that omit it
// keep the legacy response shape. See recentlyDeletedItems on the response schema.
export const accountSpaceIndexIncludeRecentlyDeletedItemsSchema = z
  .preprocess((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    return value === "true";
  }, z.boolean())
  .optional();

// Opt-in flag (query string "true"). Lets newer clients request managed Space
// purpose metadata while strict legacy clients keep the legacy response shape.
export const accountSpaceIndexIncludePurposesSchema = z
  .preprocess((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    return value === "true";
  }, z.boolean())
  .optional();

export const accountSpaceIndexQuerySchema = z.strictObject({
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
  includeRecentlyDeletedItems:
    accountSpaceIndexIncludeRecentlyDeletedItemsSchema,
  includePurposes: accountSpaceIndexIncludePurposesSchema,
  limit: accountSpaceIndexLimitSchema,
  scope: accountSpaceIndexScopeSchema.default("account"),
  selectedProfileId: trimmedNonEmptyStringSchema,
});

export const accountSpaceIndexJoinedProfileSchema = z.strictObject({
  lastJoinedAt: ISO_DATE_TIME_SCHEMA,
  pinnedAt: nullableIsoDateTimeSchema,
  profileId: trimmedNonEmptyStringSchema,
  profileName: trimmedNonEmptyStringSchema,
});

export const accountSpaceIndexItemSchema = z.strictObject({
  creatorKind: z.union([profileSpaceCreatorKindSchema, z.null()]),
  creatorOwnerUserId: nullableTrimmedStringSchema,
  creatorProfileId: nullableTrimmedStringSchema,
  creatorProfileName: nullableTrimmedStringSchema,
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
  joinedProfiles: z.array(accountSpaceIndexJoinedProfileSchema),
  lastJoinedAt: ISO_DATE_TIME_SCHEMA,
  lastSeenTs: nullableNonNegativeIntSchema,
  openProfileId: trimmedNonEmptyStringSchema,
  openProfileName: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  pinnedAt: nullableIsoDateTimeSchema,
  pinnedProfileIds: z.array(trimmedNonEmptyStringSchema),
  spaceCreatedAt: nullableIsoDateTimeSchema,
  spaceId: trimmedNonEmptyStringSchema,
  spaceName: trimmedNonEmptyStringSchema,
  activeAgentCount: nullableNonNegativeIntSchema.optional(),
  activeHumanCount: nullableNonNegativeIntSchema.optional(),
  activeMemberCount: nullableNonNegativeIntSchema.optional(),
  directMessageConvertedAt: nullableIsoDateTimeSchema.optional(),
  spacePurpose: nullableTrimmedStringSchema.optional(),
  spaceUpdatedAt: nullableIsoDateTimeSchema,
  status: trimmedNonEmptyStringSchema,
  updatedAt: ISO_DATE_TIME_SCHEMA,
  visibility: spaceOrganizationVisibilitySchema,
});

// A whole-space deletion the account was a member of, surfaced briefly (recent
// window) so clients can show a one-time "X deleted this space" notice instead of
// the space silently vanishing. Driven off the durable Space Index projection
// (deletedAt/deletedBy) — the per-Space signal channel dies with the deleted DO.
export const accountSpaceIndexDeletedItemSchema = z.strictObject({
  deletedAt: ISO_DATE_TIME_SCHEMA,
  deletedByProfileName: nullableTrimmedStringSchema,
  spaceId: trimmedNonEmptyStringSchema,
  spaceName: nullableTrimmedStringSchema,
});

export const accountSpaceIndexResponseSchema = z.strictObject({
  pinnedItems: z.array(accountSpaceIndexItemSchema),
  // Opt-in field — only present when the caller passes includeRecentlyDeletedItems.
  // Kept strictly optional with NO default on purpose: a published strict client
  // (e.g. CLI 0.7.63) that never opts in must receive the legacy
  // {pinnedItems, spaceItems} shape, or its own strictObject response parse rejects
  // the unknown key. Do NOT re-add .default([]) — the Gateway re-validates Core's
  // response with this schema, and a default would inject the key for clients that
  // did not opt in, re-breaking them.
  recentlyDeletedItems: z.array(accountSpaceIndexDeletedItemSchema).optional(),
  spaceItems: z.array(accountSpaceIndexItemSchema),
});
