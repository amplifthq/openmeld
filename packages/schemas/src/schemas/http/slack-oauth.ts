import * as z from "zod/v4";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const timestampMsSchema = z.number().int().nonnegative();

export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "bookmarks:read",
  "bookmarks:write",
  "canvases:read",
  "canvases:write",
  "channels:history",
  "channels:join",
  "channels:read",
  "chat:write",
  "commands",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "groups:write",
  "im:history",
  "im:read",
  "im:write",
  "links:read",
  "links:write",
  "pins:read",
  "pins:write",
  "reactions:read",
  "reactions:write",
  "search:read.files",
  "search:read.public",
  "usergroups:read",
  "users:read",
  "users:read.email",
] as const;

export const SLACK_DIRECT_MESSAGE_REQUIRED_BOT_SCOPES = [
  "im:history",
  "im:read",
  "im:write",
] as const;

export const slackOAuthPurposeSchema = z.enum([
  "organization_install",
  "member_identity",
]);

export const slackOAuthStateSchema = z
  .string()
  .regex(/^slack(?:oauth|identity)_[0-9a-f]{64}$/u);

export const slackOAuthStateCreateResponseSchema = z.strictObject({
  expiresAtMs: timestampMsSchema,
  purpose: slackOAuthPurposeSchema,
  slackTeamId: trimmedNonEmptyStringSchema.max(256).nullable(),
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
      purpose: slackOAuthPurposeSchema,
      returnPath: trimmedNonEmptyStringSchema,
      status: z.literal("valid"),
      userId: trimmedNonEmptyStringSchema,
    }),
  ]
);

export const slackOAuthInstallationInputSchema = z.strictObject({
  actorProfileId: trimmedNonEmptyStringSchema,
  botScopes: z
    .array(trimmedNonEmptyStringSchema.max(256))
    .min(1)
    .max(100)
    .optional(),
  botToken: z.string().trim().min(1).max(4096),
  botUserId: trimmedNonEmptyStringSchema.max(256),
  installedByUserId: trimmedNonEmptyStringSchema,
  moveFromOrganizationId: trimmedNonEmptyStringSchema.optional(),
  organizationId: trimmedNonEmptyStringSchema,
  slackInstallerUserId: trimmedNonEmptyStringSchema.max(256).optional(),
  slackTeamId: trimmedNonEmptyStringSchema.max(256),
});

export const slackOAuthIdentityLinkInputSchema = z.strictObject({
  actorProfileId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  slackAccountEmail: z.email().max(320),
  slackTeamId: trimmedNonEmptyStringSchema.max(256),
  slackUserId: trimmedNonEmptyStringSchema.max(256),
  userId: trimmedNonEmptyStringSchema,
});

export const slackOAuthIdentityLinkResultSchema = z.strictObject({
  openMeldProfileId: trimmedNonEmptyStringSchema,
  organizationSlug: trimmedNonEmptyStringSchema,
  token: z.string().regex(/^slacklink_[0-9a-f]{64}$/u),
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
  "identity_exchange_failed",
  "identity_link_failed",
  "identity_workspace_mismatch",
  "invalid_state",
  "missing_code",
  "oauth_exchange_failed",
  "organization_already_bound",
  "organization_required",
  "state_creation_failed",
  "state_validation_failed",
  "workspace_already_bound",
]);
