import { z } from "zod/v4";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);

export const centerAgentReadSlackWorkspaceDirectoryBodySchema = z.strictObject({
  cursor: trimmedNonEmptyStringSchema.max(2048).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const slackWorkspaceMembershipSchema = z.discriminatedUnion("status", [
  z.strictObject({
    matchedBy: z.enum(["identity_link", "email"]),
    memberDisplayName: trimmedNonEmptyStringSchema,
    status: z.literal("member"),
  }),
  z.strictObject({
    status: z.literal("not_member"),
  }),
  z.strictObject({
    reason: z.literal("email_unavailable"),
    status: z.literal("unknown"),
  }),
]);

export const slackWorkspaceDirectoryMemberSchema = z.strictObject({
  displayName: trimmedNonEmptyStringSchema,
  email: nullableTrimmedStringSchema,
  isAdmin: z.boolean(),
  isGuest: z.boolean(),
  isOwner: z.boolean(),
  realName: nullableTrimmedStringSchema,
  slackUserId: trimmedNonEmptyStringSchema,
  title: nullableTrimmedStringSchema,
  openMeldMembership: slackWorkspaceMembershipSchema,
});

export const slackWorkspaceDirectoryResponseSchema = z.strictObject({
  generatedAt: ISO_DATE_TIME_SCHEMA,
  members: z.array(slackWorkspaceDirectoryMemberSchema),
  nextCursor: nullableTrimmedStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
});
