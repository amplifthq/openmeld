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
});

export const organizationMemberRemovalPreviewBodySchema = z.strictObject({
  memberId: id,
});

export const organizationMemberRemovalPrepareBodySchema =
  organizationMemberRemovalPreviewBodySchema.extend({
    spaces: z.array(organizationMemberRemovalSpaceSchema),
    successorUserId: id.optional(),
  });

export const organizationMemberRemovalPrepareResponseSchema = z.strictObject({
  prepared: z.literal(true),
});

export const organizationMemberRemovalPreviewInputSchema =
  organizationMemberRemovalPreviewBodySchema.extend({
    context: openMeldRequestContextSchema,
  });

export const organizationMemberRemovalPrepareInputSchema =
  organizationMemberRemovalPrepareBodySchema.extend({
    context: openMeldRequestContextSchema,
  });

export const organizationMemberRemovalSpaceInputSchema =
  organizationMemberRemovalPreviewInputSchema.extend({ spaceId: id });

export const organizationMemberRemovalSpacePrepareInputSchema =
  organizationMemberRemovalSpaceInputSchema.extend({
    expected: organizationMemberRemovalSpaceSchema,
    successorUserId: id.optional(),
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
