import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { accountSpaceIndexItemSchema } from "./account-space-index";
import { spaceOrganizationVisibilitySchema } from "./space-meta";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableIsoDateTimeSchema = z.union([ISO_DATE_TIME_SCHEMA, z.null()]);

export const organizationSpaceDirectoryItemSchema = z.strictObject({
  spaceId: trimmedNonEmptyStringSchema,
  name: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  visibility: spaceOrganizationVisibilitySchema,
  joined: z.boolean(),
  lastJoinedAt: nullableIsoDateTimeSchema,
  spaceCreatedAt: nullableIsoDateTimeSchema,
  spaceUpdatedAt: nullableIsoDateTimeSchema,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});

export const organizationSpaceDirectoryResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  spaces: z.array(organizationSpaceDirectoryItemSchema),
});

export const organizationSpaceDirectoryWithMemberCountsItemSchema =
  organizationSpaceDirectoryItemSchema.extend({
    activeMemberCount: z.number().int().nonnegative().nullable(),
    memberPreviews: accountSpaceIndexItemSchema.shape.memberPreviews,
  });

export const organizationSpaceDirectoryQuerySchema = z.strictObject({
  includeMemberPreviews: z
    .union([
      z.boolean(),
      z.enum(["true", "false"]).transform((value) => value === "true"),
    ])
    .optional(),
});
export const getCurrentOrganizationSpaceDirectoryRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema.optional(),
    includeMemberPreviews: z.boolean().optional(),
  });

export const organizationSpaceDirectoryWithMemberCountsResponseSchema =
  z.strictObject({
    organizationId: trimmedNonEmptyStringSchema,
    generatedAt: ISO_DATE_TIME_SCHEMA,
    spaces: z.array(organizationSpaceDirectoryWithMemberCountsItemSchema),
  });
