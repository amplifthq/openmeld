import { z } from "zod/v4";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const timestampMsSchema = z.number().int().nonnegative();

export const slackOAuthStateSchema = z
  .string()
  .regex(/^slackoauth_[0-9a-f]{64}$/u);

export const slackOAuthStateCreateResponseSchema = z.strictObject({
  expiresAtMs: timestampMsSchema,
  state: slackOAuthStateSchema,
});

export const slackOAuthStateConsumeResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("invalid") }),
    z.strictObject({
      returnPath: trimmedNonEmptyStringSchema,
      status: z.literal("expired"),
    }),
    z.strictObject({
      actorProfileId: trimmedNonEmptyStringSchema,
      moveFromOrganizationId: trimmedNonEmptyStringSchema.nullable(),
      organizationId: trimmedNonEmptyStringSchema,
      returnPath: trimmedNonEmptyStringSchema,
      status: z.literal("valid"),
      userId: trimmedNonEmptyStringSchema,
    }),
  ]
);

export const slackOAuthInstallationInputSchema = z.strictObject({
  actorProfileId: trimmedNonEmptyStringSchema,
  botToken: z.string().trim().min(1).max(4096),
  botUserId: trimmedNonEmptyStringSchema.max(256),
  installedByUserId: trimmedNonEmptyStringSchema,
  moveFromOrganizationId: trimmedNonEmptyStringSchema.optional(),
  organizationId: trimmedNonEmptyStringSchema,
  slackInstallerUserId: trimmedNonEmptyStringSchema.max(256).optional(),
  slackTeamId: trimmedNonEmptyStringSchema.max(256),
});

export const slackOAuthOrganizationMembershipInputSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  userId: trimmedNonEmptyStringSchema,
});

export const slackOAuthOrganizationMembershipResultSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      organizationId: trimmedNonEmptyStringSchema,
      organizationName: trimmedNonEmptyStringSchema,
      role: trimmedNonEmptyStringSchema,
      status: z.literal("member"),
    }),
    z.strictObject({ status: z.literal("not_member") }),
  ]);

export const slackOAuthInstallationStatusSchema = z.enum([
  "created",
  "moved",
  "unchanged",
  "workspace_already_bound",
  "organization_already_bound",
]);

const slackOAuthExistingWorkspaceBindingSchema = z.strictObject({
  createdAtMs: timestampMsSchema,
  organizationId: trimmedNonEmptyStringSchema,
  slackTeamId: trimmedNonEmptyStringSchema,
  updatedAtMs: timestampMsSchema,
});

export const slackOAuthInstallationResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.enum(["created", "moved", "unchanged"]),
    }),
    z.strictObject({
      existing: slackOAuthExistingWorkspaceBindingSchema,
      status: z.enum(["workspace_already_bound", "organization_already_bound"]),
    }),
  ]
);

export const slackOAuthErrorCodeSchema = z.enum([
  "access_denied",
  "configuration_missing",
  "expired_state",
  "installation_failed",
  "invalid_state",
  "missing_code",
  "oauth_exchange_failed",
  "organization_already_bound",
  "organization_required",
  "state_creation_failed",
  "state_validation_failed",
  "workspace_already_bound",
]);
