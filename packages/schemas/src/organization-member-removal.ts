import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./schemas/daemon/profile-identity";

const id = z.string().trim().min(1).max(255);

export const organizationMemberRemovalSpaceSchema = z.strictObject({
  spaceId: id,
  name: z.string(),
  action: z.enum(["close", "demote", "transfer"]),
});

export const organizationMemberRemovalPlanSchema = z.strictObject({
  memberId: id,
  userId: id,
  spaces: z.array(organizationMemberRemovalSpaceSchema),
  defaultSuccessor: z
    .strictObject({ userId: id, profileName: z.string() })
    .optional(),
});

const organizationMemberRemovalTargetSchema = z.strictObject({
  memberId: id,
});

export const organizationMemberRemovalPreviewBodySchema =
  organizationMemberRemovalTargetSchema;

export const organizationMemberRemovalPrepareBodySchema =
  organizationMemberRemovalTargetSchema.extend({
    spaces: z.array(organizationMemberRemovalSpaceSchema),
    successorUserId: id.optional(),
    useDefaultSuccessor: z.literal(true).optional(),
  });

export const organizationMemberRemovalPrepareResponseSchema = z.strictObject({
  prepared: z.literal(true),
});

export const organizationMemberRemovalPreviewInputSchema =
  organizationMemberRemovalPreviewBodySchema.extend({
    context: openMeldRequestContextSchema,
    includeDefaultSuccessor: z.literal(true).optional(),
  });

export const organizationMemberRemovalPrepareInputSchema =
  organizationMemberRemovalPrepareBodySchema.extend({
    context: openMeldRequestContextSchema,
  });

export const organizationMemberRemovalSpaceInputSchema =
  organizationMemberRemovalTargetSchema.extend({
    context: openMeldRequestContextSchema,
    spaceId: id,
    defaultSuccessorProfileId: id.optional(),
  });

export const organizationMemberRemovalSpacePrepareInputSchema =
  organizationMemberRemovalTargetSchema.extend({
    context: openMeldRequestContextSchema,
    spaceId: id,
    expected: organizationMemberRemovalSpaceSchema,
    successorUserId: id.optional(),
    useDefaultSuccessor: z.literal(true).optional(),
  });

export type OrganizationMemberRemovalSpace = z.infer<
  typeof organizationMemberRemovalSpaceSchema
>;
export type OrganizationMemberRemovalPlan = z.infer<
  typeof organizationMemberRemovalPlanSchema
>;
export type OrganizationMemberRemovalPreviewBody = z.infer<
  typeof organizationMemberRemovalPreviewBodySchema
>;
export type OrganizationMemberRemovalPrepareBody = z.infer<
  typeof organizationMemberRemovalPrepareBodySchema
>;
export type OrganizationMemberRemovalPreviewInput = z.infer<
  typeof organizationMemberRemovalPreviewInputSchema
>;
export type OrganizationMemberRemovalPrepareInput = z.infer<
  typeof organizationMemberRemovalPrepareInputSchema
>;
export type OrganizationMemberRemovalSpaceInput = z.infer<
  typeof organizationMemberRemovalSpaceInputSchema
>;
export type OrganizationMemberRemovalSpacePrepareInput = z.infer<
  typeof organizationMemberRemovalSpacePrepareInputSchema
>;
export type OrganizationMemberRemovalPrepareResponse = z.infer<
  typeof organizationMemberRemovalPrepareResponseSchema
>;
