import * as z from "zod/v4";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { postSpaceMembersResponseSchema } from "./space-members";
import { spaceNameSchema } from "./space-name";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);

export const openDirectMessageSpaceBodySchema = z.strictObject({
  targetProfileId: openMeldRuntimeProfileIdSchema,
});

export const openDirectMessageSpaceResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  memberProfileId: openMeldRuntimeProfileIdSchema,
  targetProfileId: openMeldRuntimeProfileIdSchema,
  spaceId: trimmedNonEmptyStringSchema,
  created: z.boolean(),
});

const directMessageConversionProfileIdsSchema = z
  .array(openMeldRuntimeProfileIdSchema)
  .min(1)
  .max(100);

export const convertDirectMessageToSpaceBodySchema = z.strictObject({
  includeMemberSnapshots: z.boolean().optional(),
  name: spaceNameSchema,
  profileIds: directMessageConversionProfileIdsSchema,
});

export const convertDirectMessageToSpaceResponseSchema = z.strictObject({
  accessMode: z.literal("members_only"),
  addedMemberIds: z.array(openMeldRuntimeProfileIdSchema),
  alreadyMemberIds: z.array(openMeldRuntimeProfileIdSchema),
  convertedAt: z.iso.datetime({ offset: true }),
  items: postSpaceMembersResponseSchema.shape.items.optional(),
  name: spaceNameSchema,
  spaceId: trimmedNonEmptyStringSchema,
});
