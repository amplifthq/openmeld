import * as z from "../../lazy-zod";
import { resolvedOpenMeldProfileSchema } from "../daemon/profile-identity";
import { agentProfileIdSchema, profileKindSchema } from "../protocol/profile";
import {
  organizationDirectoryAgentProfileIdentitySchema,
  organizationDirectoryMemberSchema,
} from "./organization-directory";
import { agentAvatarOptionsSchema, agentAvatarStyleSchema } from "./profiles";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);

export const authRpcUpdateAgentProfileDefaultProjectInputSchema =
  z.strictObject({
    defaultProjectId: trimmedNonEmptyStringSchema.max(256).nullable(),
    onlyIfUnmodified: z.boolean().optional(),
    organizationId: trimmedNonEmptyStringSchema.max(256),
    ownerUserId: trimmedNonEmptyStringSchema.max(256),
    profileId: agentProfileIdSchema,
  });

export const openMeldRequestedOrganizationSelectorSchema = z.union([
  z.strictObject({
    organizationId: trimmedNonEmptyStringSchema.max(256),
  }),
  z.strictObject({
    organizationSlug: trimmedNonEmptyStringSchema.max(256),
  }),
]);

export const authOrganizationContextSourceSchema = z.enum([
  "request",
  "session",
]);

export const authRpcMethodSchema = z.enum(["session", "api_key", "none"]);

// Mirrors requestCredentialKindSchema (http/sensitive-operations.ts). Absent
// means the caller cannot prove an interactive session.
export const authRpcCredentialKindSchema = z.enum([
  "interactive_session",
  "cli_credential",
]);

export const authRpcClaimsSchema = z.strictObject({
  activeOrganizationId: trimmedNonEmptyStringSchema.optional(),
  authenticated: z.boolean(),
  authMethod: authRpcMethodSchema,
  callerPrincipalId: trimmedNonEmptyStringSchema.optional(),
  credentialKind: authRpcCredentialKindSchema.optional(),
  organizationContextSource: authOrganizationContextSourceSchema.optional(),
  ownerIds: z.array(trimmedNonEmptyStringSchema),
  profileId: trimmedNonEmptyStringSchema.optional(),
  profileKind: profileKindSchema.optional(),
  requestId: trimmedNonEmptyStringSchema,
});

export const authRpcResolveRequestAuthInputSchema = z.strictObject({
  headers: z.record(z.string(), z.string()).optional(),
  requestId: trimmedNonEmptyStringSchema.optional(),
  requestedOrganization: openMeldRequestedOrganizationSelectorSchema.optional(),
});

const authRpcResolveRequestAuthSuccessSchema = z.strictObject({
  claims: authRpcClaimsSchema,
  ok: z.literal(true),
});

const authRpcResolveRequestAuthFailureSchema = z.strictObject({
  code: trimmedNonEmptyStringSchema,
  message: trimmedNonEmptyStringSchema,
  ok: z.literal(false),
});

// Internal Auth facts, not a grant of access or a readiness decision.
export const AUTH_PROFILE_FACT_BATCH_SIZE = 64;
export const authRpcProfileFactSchema = z.strictObject({
  profileId: trimmedNonEmptyStringSchema.max(256),
  profileName: z.string(),
  profileHandle: z.string(),
  profileKind: profileKindSchema,
  status: z.enum(["active", "disabled"]),
  ownerUserId: z.string().nullable(),
  organizationId: z.string().nullable().optional(),
  managedRole: z.string().nullable().optional(),
  defaultProjectId: z.string().nullable().optional(),
  avatarStyle: agentAvatarStyleSchema.nullable().optional(),
  avatarOptions: agentAvatarOptionsSchema.nullable().optional(),
});

export const authRpcResolveProfileByIdResultSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({ ok: z.literal(true), profile: authRpcProfileFactSchema }),
    authRpcResolveRequestAuthFailureSchema,
  ]
);

export const authRpcResolveProfilesByIdsInputSchema = z.strictObject({
  includeAvatarStyle: z.boolean().optional(),
  profileIds: z
    .array(trimmedNonEmptyStringSchema.max(256))
    .min(1)
    .max(AUTH_PROFILE_FACT_BATCH_SIZE),
});

export const authRpcResolveProfilesByIdsResultSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      ok: z.literal(true),
      // Every requested ID must have an entry. Only an explicit null means
      // absent; an incomplete response or failed read is unavailable.
      profiles: z.record(
        z.string().min(1).max(256),
        authRpcProfileFactSchema.nullable()
      ),
    }),
    authRpcResolveRequestAuthFailureSchema,
  ]
);

export const authRpcResolveRequestAuthResultSchema = z.discriminatedUnion(
  "ok",
  [
    authRpcResolveRequestAuthSuccessSchema,
    authRpcResolveRequestAuthFailureSchema,
  ]
);

export const authRpcResolveProfileResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    resolvedProfile: resolvedOpenMeldProfileSchema,
  }),
  authRpcResolveRequestAuthFailureSchema,
]);

export const authRpcResolveProfileInputSchema =
  authRpcResolveRequestAuthInputSchema.extend({
    profileKind: profileKindSchema.optional(),
    openMeldProfileId: trimmedNonEmptyStringSchema.optional(),
  });

export const authRpcResolveUserDisplayNameInputSchema = z.strictObject({
  userId: trimmedNonEmptyStringSchema.max(256),
});

export const authRpcResolveUserDisplayNameResultSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      displayName: trimmedNonEmptyStringSchema.max(256),
      ok: z.literal(true),
      userId: trimmedNonEmptyStringSchema.max(256),
    }),
    authRpcResolveRequestAuthFailureSchema,
  ]
);

export const authRpcSendInboxUrgentEmailInputSchema = z.strictObject({
  purpose: z.literal("invitation_review").optional(),
  invitationRequestId: trimmedNonEmptyStringSchema.max(256).optional(),
  deliveryId: trimmedNonEmptyStringSchema.max(256),
  itemId: trimmedNonEmptyStringSchema.max(256),
  organizationId: trimmedNonEmptyStringSchema.max(256),
  preview: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(160),
  userId: trimmedNonEmptyStringSchema.max(256),
});

export const authRpcSendInboxUrgentEmailResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      deliveryId: trimmedNonEmptyStringSchema.max(256),
      messageId: trimmedNonEmptyStringSchema.max(998),
      status: z.literal("sent"),
    }),
    z.strictObject({
      deliveryId: trimmedNonEmptyStringSchema.max(256),
      reason: z.enum(["recipient_has_no_email", "recipient_not_member"]),
      status: z.literal("suppressed"),
    }),
    z
      .strictObject({
        code: z.enum([
          "email_request_invalid",
          "email_sender_not_verified",
          "email_send_rejected",
          "email_send_transient",
        ]),
        deliveryId: trimmedNonEmptyStringSchema.max(256),
        retryable: z.boolean(),
        status: z.literal("failed"),
      })
      .superRefine((result, context) => {
        const expectedRetryable = result.code === "email_send_transient";
        if (result.retryable !== expectedRetryable) {
          context.addIssue({
            code: "custom",
            message:
              "Inbox email retryability must match the stable error code.",
            path: ["retryable"],
          });
        }
      }),
  ]
);

export const authRpcResolveOrganizationAccountIdentityInputSchema =
  z.strictObject({
    account: z
      .discriminatedUnion("kind", [
        z.strictObject({
          email: z.email().max(320),
          kind: z.literal("email"),
        }),
        z.strictObject({
          kind: z.literal("user_id"),
          userId: trimmedNonEmptyStringSchema.max(256),
        }),
        z.strictObject({
          kind: z.literal("human_profile_id"),
          profileId: trimmedNonEmptyStringSchema.max(256),
        }),
      ])
      .optional(),
    organizationId: trimmedNonEmptyStringSchema.max(256),
  });

const authRpcOrganizationIdentitySchema = z.strictObject({
  id: trimmedNonEmptyStringSchema.max(256),
  memberCount: z.number().int().nonnegative(),
  name: trimmedNonEmptyStringSchema.max(256),
  personal: z.boolean(),
  slug: trimmedNonEmptyStringSchema.max(256),
});

const authRpcOrganizationAccountIdentitySchema = z.strictObject({
  defaultHumanProfile: z
    .strictObject({
      profileId: trimmedNonEmptyStringSchema.max(256),
      profileName: trimmedNonEmptyStringSchema.max(256),
    })
    .nullable(),
  displayName: trimmedNonEmptyStringSchema.max(256),
  email: z.email().max(320),
  membership: z
    .strictObject({
      memberId: trimmedNonEmptyStringSchema.max(256),
      role: z.enum(["admin", "member", "owner"]),
    })
    .nullable(),
  userId: trimmedNonEmptyStringSchema.max(256),
});

export const authRpcResolveOrganizationAccountIdentityResultSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      account: authRpcOrganizationAccountIdentitySchema.nullable(),
      ok: z.literal(true),
      organization: authRpcOrganizationIdentitySchema,
    }),
    authRpcResolveRequestAuthFailureSchema,
  ]);

export const authRpcResolveOrganizationDirectoryMembersInputSchema =
  z.strictObject({
    organizationId: trimmedNonEmptyStringSchema.max(256),
  });

export const authRpcResolveOrganizationDirectoryMembersResultSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      members: z.array(organizationDirectoryMemberSchema),
      ok: z.literal(true),
      organizationId: trimmedNonEmptyStringSchema.max(256),
    }),
    authRpcResolveRequestAuthFailureSchema,
  ]);

export const authRpcResolveOrganizationDirectoryAgentProfilesInputSchema =
  z.strictObject({
    additionalAgentProfileIds: z.array(agentProfileIdSchema),
    includeAvatarStyle: z.boolean().optional(),
    organizationId: trimmedNonEmptyStringSchema.max(256),
  });

export const authRpcResolveOrganizationDirectoryAgentProfilesResultSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      additionalAgentProfiles: z.array(
        organizationDirectoryAgentProfileIdentitySchema
      ),
      ok: z.literal(true),
      organizationAgentProfiles: z.array(
        organizationDirectoryAgentProfileIdentitySchema
      ),
      organizationId: trimmedNonEmptyStringSchema.max(256),
    }),
    authRpcResolveRequestAuthFailureSchema,
  ]);

export const authRpcResolveRequestAuthWithProfileInputSchema =
  authRpcResolveProfileInputSchema;

export const authRpcResolveRequestAuthWithProfileResultSchema =
  z.discriminatedUnion("ok", [
    authRpcResolveRequestAuthSuccessSchema.extend({
      profile: authRpcResolveProfileResultSchema.optional(),
    }),
    authRpcResolveRequestAuthFailureSchema,
  ]);
