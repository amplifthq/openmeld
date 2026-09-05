import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./schemas/daemon/profile-identity";
import { resolvedSpaceMemberProfileSchema } from "./schemas/http/space-members";

const id = z.string().trim().min(1).max(200);
export const ORGANIZATION_INVITATION_LIFETIME_SECONDS = 48 * 60 * 60;

export const spaceInvitationRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    organizationId: id,
    spaceId: id,
    email: z.string().trim().toLowerCase().pipe(z.email()),
  }),
  z.strictObject({
    action: z.literal("list"),
    organizationId: id,
    spaceId: id,
  }),
  z.strictObject({ action: z.literal("pending") }),
  z.strictObject({ action: z.literal("preview"), invitationId: id }),
  z.strictObject({ action: z.literal("accept"), invitationId: id }),
  z.strictObject({ action: z.literal("revoke"), invitationId: id }),
  z.strictObject({ action: z.literal("resend"), invitationId: id }),
]);

export const spaceInvitationSchema = z.strictObject({
  id,
  organizationId: id,
  organizationName: z.string(),
  spaceId: id,
  spaceName: z.string(),
  inviterName: z.string(),
  email: z.email(),
  status: z.enum(["pending", "accepting", "accepted", "revoked", "expired"]),
  expiresAt: z.number().int(),
});

export const spaceInvitationResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    invitations: z.array(spaceInvitationSchema),
  }),
  z.strictObject({ ok: z.literal(false), code: id, message: z.string() }),
]);

// Auth supplies identity from its authenticated session. Clients cannot supply
// these fields or invoke the internal lifecycle operations.
export const spaceInvitationRpcInputSchema = z.strictObject({
  userId: id,
  email: z.email(),
  emailVerified: z.boolean(),
  request: z.union([
    spaceInvitationRequestSchema,
    z.strictObject({
      action: z.literal("bind"),
      invitationId: id,
      organizationInvitationId: id,
      organizationInvitationOwned: z.boolean(),
    }),
    z.strictObject({ action: z.literal("claim"), invitationId: id }),
    z.strictObject({ action: z.literal("complete"), invitationId: id }),
  ]),
});

export const spaceInvitationRpcResultSchema = z.strictObject({
  result: spaceInvitationResponseSchema,
  organizationInvitationId: id.nullable().optional(),
  organizationMember: z.boolean().optional(),
  cancelOrganizationInvitation: z.boolean().optional(),
});

export type SpaceInvitation = z.infer<typeof spaceInvitationSchema>;
export type SpaceInvitationRequest = z.infer<
  typeof spaceInvitationRequestSchema
>;
export type SpaceInvitationResponse = z.infer<
  typeof spaceInvitationResponseSchema
>;
export type SpaceInvitationRpcInput = z.infer<
  typeof spaceInvitationRpcInputSchema
>;
export type SpaceInvitationRpcResult = z.infer<
  typeof spaceInvitationRpcResultSchema
>;

export type SpaceInvitationWorker = {
  spaceInvitation(
    input: SpaceInvitationRpcInput
  ): Promise<SpaceInvitationRpcResult>;
};

export const spaceInvitationAccessInputSchema = z.strictObject({
  spaceId: id,
  context: openMeldRequestContextSchema,
});
export const spaceInvitationGrantInputSchema =
  spaceInvitationAccessInputSchema.extend({
    invitationId: id,
    member: resolvedSpaceMemberProfileSchema,
  });
export const spaceInvitationRevokeInputSchema =
  spaceInvitationAccessInputSchema.extend({ invitationId: id });
export type SpaceInvitationRevokeInput = z.infer<
  typeof spaceInvitationRevokeInputSchema
>;
export type SpaceInvitationAccessInput = z.infer<
  typeof spaceInvitationAccessInputSchema
>;
export type SpaceInvitationGrantInput = z.infer<
  typeof spaceInvitationGrantInputSchema
>;
