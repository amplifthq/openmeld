import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";

export const ORGANIZATION_JOIN_LINK_WEB_PATH = "/join-organization" as const;
export const ORGANIZATION_JOIN_LINK_TOKEN_PREFIX = "joinlink_" as const;
export const ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITED_ERROR_CODE =
  "organization.join_link.accept.rate_limited" as const;

export const organizationJoinLinkTokenSchema = z
  .string()
  .regex(/^joinlink_[0-9a-f]{64}$/);

export const organizationJoinLinkManagementQuerySchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(255),
  spaceId: z.string().trim().min(1).max(255).optional(),
});

export const organizationJoinLinkSchema = z.strictObject({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  token: organizationJoinLinkTokenSchema,
  url: z.url(),
  role: z.literal("member"),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  spaceId: z.string().min(1).nullable().optional(),
});

export const getOrganizationJoinLinkResponseSchema = z.strictObject({
  ok: z.literal(true),
  joinLink: organizationJoinLinkSchema.nullable(),
});

export const CENTER_AGENT_ORGANIZATION_INVITE_LINK_GENERATION_GUIDANCE = {
  requiredRole: "member",
  settingsLocation: "Settings → Workspace → General",
  settingsSection: "Invite link",
} as const;

export const centerAgentGetOrganizationInviteLinkToolRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
  });

export const centerAgentOrganizationInviteLinkGenerationGuidanceSchema =
  z.strictObject({
    requiredRole: z.literal(
      CENTER_AGENT_ORGANIZATION_INVITE_LINK_GENERATION_GUIDANCE.requiredRole
    ),
    settingsLocation: z.literal(
      CENTER_AGENT_ORGANIZATION_INVITE_LINK_GENERATION_GUIDANCE.settingsLocation
    ),
    settingsSection: z.literal(
      CENTER_AGENT_ORGANIZATION_INVITE_LINK_GENERATION_GUIDANCE.settingsSection
    ),
  });

export const centerAgentGetOrganizationInviteLinkResponseSchema =
  z.discriminatedUnion("active", [
    z.strictObject({
      active: z.literal(true),
      organizationName: z.string().trim().min(1),
      url: z.url(),
    }),
    z.strictObject({
      active: z.literal(false),
      generationGuidance:
        centerAgentOrganizationInviteLinkGenerationGuidanceSchema,
    }),
  ]);

export const organizationJoinLinkEnsureErrorCodeSchema = z.enum([
  "organization.join_link.forbidden",
  "organization.join_link.inactive",
  "organization.join_link.invalid_input",
  "organization.metadata_invalid",
  "organization.personal_no_members",
]);

export const ensureOrganizationJoinLinkOnBehalfOfRpcInputSchema =
  z.strictObject({
    actorUserId: z.string().trim().min(1).max(255),
    organizationId: z.string().trim().min(1).max(255),
  });

export const ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      joinLink: organizationJoinLinkSchema,
      ok: z.literal(true),
      organizationName: z.string().trim().min(1),
    }),
    z.strictObject({
      code: organizationJoinLinkEnsureErrorCodeSchema,
      message: z.string().trim().min(1),
      ok: z.literal(false),
    }),
  ]);

export const centerAgentCreateOrganizationInviteLinkToolRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentToolSpeakerSchema,
  });

export const centerAgentCreateOrganizationInviteLinkResponseSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      ok: z.literal(true),
      organizationName: z.string().trim().min(1),
      url: z.url(),
    }),
    z.strictObject({
      error: z.strictObject({
        code: organizationJoinLinkEnsureErrorCodeSchema,
        message: z.string().trim().min(1),
      }),
      ok: z.literal(false),
    }),
  ]);

export const revokeOrganizationJoinLinkResponseSchema = z.strictObject({
  ok: z.literal(true),
  revoked: z.boolean(),
});

export const previewOrganizationJoinLinkQuerySchema = z.strictObject({
  token: organizationJoinLinkTokenSchema,
});

export const previewOrganizationJoinLinkResponseSchema = z.discriminatedUnion(
  "active",
  [
    z.strictObject({
      ok: z.literal(true),
      active: z.literal(true),
      organizationName: z.string().min(1),
      organizationSlug: z.string().min(1),
      spaceId: z.string().min(1).nullable().optional(),
    }),
    z.strictObject({
      ok: z.literal(true),
      active: z.literal(false),
    }),
  ]
);

export const acceptOrganizationJoinLinkBodySchema = z.strictObject({
  token: organizationJoinLinkTokenSchema,
});

export const acceptOrganizationJoinLinkResponseSchema = z.strictObject({
  ok: z.literal(true),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  organizationSlug: z.string().min(1),
  role: z.enum(["owner", "admin", "member"]),
  alreadyMember: z.boolean(),
});

export const organizationJoinLinkErrorCodeSchema = z.enum([
  "auth.invalid_origin",
  ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITED_ERROR_CODE,
  "organization.join_link.invalid_input",
  "organization.join_link.authentication_required",
  "organization.join_link.approval_required",
  "organization.join_link.forbidden",
  "organization.join_link.email_verification_required",
  "organization.join_link.inactive",
  "organization.personal_no_members",
  "organization.metadata_invalid",
]);

export const organizationJoinLinkErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  code: organizationJoinLinkErrorCodeSchema,
  message: z.string().min(1),
});
