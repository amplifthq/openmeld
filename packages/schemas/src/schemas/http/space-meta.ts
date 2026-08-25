import * as z from "zod/v4";
import {
  agentProfileIdSchema,
  openMeldRuntimeProfileIdSchema,
  profileKindSchema,
  uuidProfileIdSchema,
} from "../protocol/profile";
import { spaceAccessModeSchema } from "./space-access-mode";
import { spaceNameSchema } from "./space-name";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const MAX_SPACE_GUIDE_LENGTH = 4000 as const;

export const spaceOrganizationVisibilitySchema = z.enum(["public", "private"]);

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
  guide: trimmedNonEmptyStringSchema.optional(),
  accessMode: spaceAccessModeSchema.optional(),
  passwordProtected: z.boolean().optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
  storageUsage: spaceStorageUsageSchema.optional(),
});

export const patchSpaceMetaResponseSchema = spaceMetaSchema;

export const getSpaceMetaResponseSchema = spaceMetaSchema;

export const patchSpaceMetaBodySchema = z
  .strictObject({
    name: spaceNameSchema.optional(),
    purpose: z.string().optional(),
    guide: z.string().max(MAX_SPACE_GUIDE_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.name !== undefined ||
      value.purpose !== undefined ||
      value.guide !== undefined
    ) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message: "Expected name, purpose or guide",
    });
  })
  .transform((value) => ({
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.purpose === undefined ? {} : { purpose: value.purpose }),
    ...(value.guide === undefined ? {} : { guide: value.guide }),
  }));
