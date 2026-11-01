import * as z from "zod/v4";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import {
  agentProfileIdSchema,
  openMeldRuntimeProfileIdSchema,
  profileKindSchema,
  uuidProfileIdSchema,
} from "../protocol/profile";
import {
  spaceAccessModeSchema,
  spaceLinkJoinPolicySchema,
} from "./space-access-mode";
import { spaceNameSchema } from "./space-name";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

// The guide holds room rules a steward writes by hand, so it gets the same cap
// as other Space text instead of a short-summary limit.
export const MAX_SPACE_GUIDE_LENGTH = MAX_TEXT_LENGTH;

export const spaceOrganizationVisibilitySchema = z.enum(["public", "private"]);

export function resolveInitialSpaceAccessMode(
  _visibility: z.infer<typeof spaceOrganizationVisibilitySchema>
): "members_only" {
  return "members_only";
}

export const spaceCreatorSchema = z
  .strictObject({
    profileId: openMeldRuntimeProfileIdSchema,
    profileName: trimmedNonEmptyStringSchema.optional(),
    kind: profileKindSchema.optional(),
    profile: trimmedNonEmptyStringSchema.optional(),
    ownerUserId: trimmedNonEmptyStringSchema.optional(),
    ownerName: trimmedNonEmptyStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.kind) {
      return;
    }

    const expectedSchema =
      value.kind === "agent" ? agentProfileIdSchema : uuidProfileIdSchema;
    if (expectedSchema.safeParse(value.profileId).success) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message:
        value.kind === "agent"
          ? "agent profileId must use agt_<UUID>"
          : "human/system profileId must be a UUID",
      path: ["profileId"],
    });
  });

export const spaceStorageUsageSchema = z.strictObject({
  usedBytes: z.number().finite().min(0),
  softLimitBytes: z.number().finite().positive(),
  usagePercent: z.number().finite().min(0),
});

export const spaceDirectMessageMetaSchema = z.strictObject({
  convertedAt: isoDateTimeSchema.optional(),
  pairKey: trimmedNonEmptyStringSchema,
});

export const spaceMetaSchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  visibility: spaceOrganizationVisibilitySchema,
  name: trimmedNonEmptyStringSchema.optional(),
  purpose: trimmedNonEmptyStringSchema.optional(),
  directMessage: spaceDirectMessageMetaSchema.optional(),
  creator: spaceCreatorSchema.optional(),
  ownerUserIds: z.array(trimmedNonEmptyStringSchema).optional(),
  allowGuests: z.boolean().optional(),
  guide: trimmedNonEmptyStringSchema.optional(),
  accessMode: spaceAccessModeSchema.optional(),
  linkJoinPolicy: spaceLinkJoinPolicySchema.optional(),
  passwordProtected: z.boolean().optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
  deletedAt: isoDateTimeSchema.optional(),
  storageUsage: spaceStorageUsageSchema.optional(),
});

export const patchSpaceMetaResponseSchema = spaceMetaSchema;

export const getSpaceMetaResponseSchema = spaceMetaSchema;

/** Authorized entry facts read together by the owning Space. */
export const spaceEntryAccessResponseSchema = z.strictObject({
  meta: spaceMetaSchema,
  activeMember: z.boolean(),
});

export const patchSpaceMetaBodySchema = z
  .strictObject({
    visibility: spaceOrganizationVisibilitySchema.optional(),
    allowGuests: z.boolean().optional(),
    ownership: z
      .strictObject({
        userId: trimmedNonEmptyStringSchema,
        role: z.enum(["owner", "member"]),
      })
      .optional(),
    name: spaceNameSchema.optional(),
    purpose: z.string().optional(),
    guide: z.string().max(MAX_SPACE_GUIDE_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.ownership !== undefined ||
      value.allowGuests !== undefined ||
      value.name !== undefined ||
      value.visibility !== undefined ||
      value.purpose !== undefined ||
      value.guide !== undefined
    ) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message: "Expected name, purpose, guide or visibility",
    });
  })
  .transform((value) => ({
    ...(value.allowGuests === undefined
      ? {}
      : { allowGuests: value.allowGuests }),
    ...(value.ownership === undefined ? {} : { ownership: value.ownership }),
    ...(value.visibility === undefined ? {} : { visibility: value.visibility }),
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.purpose === undefined ? {} : { purpose: value.purpose }),
    ...(value.guide === undefined ? {} : { guide: value.guide }),
  }));
