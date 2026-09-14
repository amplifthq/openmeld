import { z } from "zod/v4";
import { organizationSummarySchema } from "./account-organization-context";
import { organizationNameSchema } from "./schemas/http/organization-identity";

const id = z.string().trim().min(1).max(256);
export const organizationActionSuccessSchema = z.strictObject({
  ok: z.literal(true),
});
export const organizationActionErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});
export const organizationCreateActionSchema = z.strictObject({
  name: organizationNameSchema,
});
export const organizationUpdateActionSchema = z.strictObject({
  organizationId: id,
  data: z.strictObject({
    name: organizationNameSchema.optional(),
    slug: id.optional(),
  }),
});
export const organizationIdActionSchema = z.strictObject({
  organizationId: id,
});
export const organizationInviteRoleSchema = z.enum(["admin", "member"]);
export const organizationInviteActionSchema = z.strictObject({
  email: z.string().trim().pipe(z.email()),
  organizationId: id,
  role: organizationInviteRoleSchema,
});
export const organizationInvitationIdActionSchema = z.strictObject({
  invitationId: id,
});
export const organizationMemberRoleActionSchema = z.strictObject({
  memberId: id,
  organizationId: id,
  role: organizationInviteRoleSchema,
});
export const organizationMemberRemovalActionSchema = z.strictObject({
  memberIdOrEmail: id,
  organizationId: id,
});
export const organizationCreatedActionResponseSchema =
  organizationSummarySchema;
export const organizationInvitationAcceptedSchema = z.strictObject({
  organizationId: id,
});
export const organizationInvitationViewSchema = z.strictObject({
  id,
  email: z.string().min(1),
  expiresAt: z.string().nullable(),
  organizationId: id.nullable(),
  role: z.string().nullable(),
  status: z.string().nullable(),
});
export const userOrganizationInvitationViewSchema =
  organizationInvitationViewSchema.extend({
    organizationId: id,
    organizationName: z.string().min(1),
    createdAt: z.string().nullable(),
    inviterId: id.nullable(),
  });
export const organizationInvitationsResponseSchema = z.array(
  organizationInvitationViewSchema
);
export const userOrganizationInvitationsResponseSchema = z.array(
  userOrganizationInvitationViewSchema
);
export type OrganizationInviteRole = z.infer<
  typeof organizationInviteRoleSchema
>;
export type OrganizationInvitationView = z.infer<
  typeof organizationInvitationViewSchema
>;
export type UserOrganizationInvitationView = z.infer<
  typeof userOrganizationInvitationViewSchema
>;
