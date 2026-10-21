import * as z from "zod/v4";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import { signalTextEnvelopeSchema } from "../protocol/envelope";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { postSpaceMembersResponseSchema } from "./space-members";
import { spaceNameSchema } from "./space-name";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);

export const openDirectMessageSpaceBodySchema = z.strictObject({
  targetProfileId: openMeldRuntimeProfileIdSchema,
  // Pin publication to the exact DM returned by an earlier open request.
  spaceId: trimmedNonEmptyStringSchema.optional(),
  // A new Human–Agent Session (Center Agent or any agent Profile). Other
  // pairs reuse their current DM.
  creationId: z.uuid().optional(),
  message: z
    .strictObject({
      clientMessageId: z.uuid(),
      text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
      wake: z.boolean(),
    })
    .optional(),
});

export const openDirectMessageSpaceResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  memberProfileId: openMeldRuntimeProfileIdSchema,
  targetProfileId: openMeldRuntimeProfileIdSchema,
  spaceId: trimmedNonEmptyStringSchema,
  created: z.boolean(),
  creationId: z.uuid().optional(),
  signal: signalTextEnvelopeSchema.optional(),
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
