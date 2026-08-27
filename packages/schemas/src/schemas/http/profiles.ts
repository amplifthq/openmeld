import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });

export const ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE =
  "profile.additional_human_profile_creation_disabled";
export const ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE =
  "Creating additional Human Profiles is currently unavailable. Use your default Human Profile, or create an Agent Profile.";
export const AGENT_PROFILE_CREATION_IDEMPOTENCY_CONFLICT_CODE =
  "profile.creation_idempotency_conflict";
export const AGENT_PROFILE_CREATION_IDEMPOTENCY_CONFLICT_MESSAGE =
  "This Agent Profile creation request was already used for a different profile. Close this dialog and try again.";
export const AGENT_PROFILE_CREATION_IDEMPOTENCY_KEY_MAX_LENGTH = 512;

export const profileErrorStatusSchema = z.union([
  z.literal(400),
  z.literal(404),
  z.literal(409),
  z.literal(500),
]);

export const profileErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const profileRpcErrorResponseSchema = profileErrorResponseSchema.extend({
  status: profileErrorStatusSchema,
});

export const additionalHumanProfileCreationDisabledErrorResponseSchema =
  profileErrorResponseSchema.extend({
    code: z.literal(ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE),
    message: z.literal(ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE),
  });

export const additionalHumanProfileCreationDisabledRpcErrorResponseSchema =
  additionalHumanProfileCreationDisabledErrorResponseSchema.extend({
    status: z.literal(409),
  });

export const authProfileKindSchema = z.enum(["human", "agent"]);

export const authProfileStatusSchema = z.enum(["active", "disabled"]);

export const authProfileManagedRoleSchema = z.enum([
  "openmeld_assistant",
  "center_agent",
]);
const authProfileViewManagedRoleSchema = authProfileManagedRoleSchema
  .nullish()
  .transform((value) => value ?? null);

export const authProfileViewSchema = z
  .strictObject({
    openMeldProfileId: z.string().min(1),
    profileName: z.string().min(1),
    profileHandle: z.string().min(1),
    profileKind: authProfileKindSchema,
    isDefault: z.boolean(),
    status: authProfileStatusSchema,
    ownerUserId: z.string().min(1),
    ownerName: z.string().min(1).optional(),
    avatarUrl: z.string().min(1).optional(),
    source: z.string().min(1),
    managedRole: authProfileViewManagedRoleSchema,
    defaultProjectId: z.string().trim().min(1).nullable().optional(),
    createdByUserId: z.string().min(1).nullable(),
    creationActorProfileId: z.string().min(1).nullable().optional(),
    creatorProfileId: z.string().min(1).nullable(),
    lastUsedAt: ISO_DATE_TIME_SCHEMA.nullable(),
    createdAt: ISO_DATE_TIME_SCHEMA,
    updatedAt: ISO_DATE_TIME_SCHEMA,
  })
  .superRefine((profile, context) => {
    if (
      profile.defaultProjectId === undefined ||
      (profile.profileKind === "agent" && profile.managedRole === null)
    ) {
      return;
    }
    context.addIssue({
      code: "custom",
      message: "Default Project is only available for ordinary Agent Profiles.",
      path: ["defaultProjectId"],
    });
  });

export const updateAgentProfileDefaultProjectBodySchema = z.strictObject({
  expectedOrganizationId: z.string().trim().min(1),
  defaultProjectId: z.string().trim().min(1).nullable(),
});

export const updateAgentProfileDefaultProjectRouteParamsSchema = z.strictObject(
  {
    agentProfileId: z.string().trim().min(1),
  }
);

export const updateAgentProfileDefaultProjectRpcInputSchema =
  updateAgentProfileDefaultProjectBodySchema.extend({
    agentProfileId:
      updateAgentProfileDefaultProjectRouteParamsSchema.shape.agentProfileId,
    context: openMeldRequestContextSchema,
  });

export const createHumanProfileBodySchema = z.strictObject({
  profileName: z.string().trim().min(1),
  creatorProfileId: z.string().min(1).optional(),
});

export const createAgentProfileBodySchema = z.strictObject({
  profileName: z.string().trim().min(1),
  creatorProfileId: z.string().min(1).optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(AGENT_PROFILE_CREATION_IDEMPOTENCY_KEY_MAX_LENGTH)
    .optional(),
});

export const ensureManagedAgentProfileBodySchema = z.strictObject({
  profileName: z.string().trim().min(1),
  managedRole: authProfileManagedRoleSchema,
  creatorProfileId: z.string().min(1).optional(),
});

export const listProfilesResponseSchema = z.strictObject({
  ok: z.literal(true),
  profiles: z.array(authProfileViewSchema),
});

export const profileCapabilitiesResponseSchema = z.strictObject({
  ok: z.literal(true),
  additionalHumanProfileCreationEnabled: z.boolean(),
});

export const resolveProfileResponseSchema = z.strictObject({
  ok: z.literal(true),
  profile: authProfileViewSchema,
});

export const createHumanProfileResponseSchema = z.strictObject({
  ok: z.literal(true),
  profile: authProfileViewSchema,
});

export const createAgentProfileResponseSchema = z.strictObject({
  ok: z.literal(true),
  profile: authProfileViewSchema,
});

export const ensureManagedAgentProfileResponseSchema = z.strictObject({
  ok: z.literal(true),
  profile: authProfileViewSchema,
});

export const updateProfileResponseSchema = z.strictObject({
  ok: z.literal(true),
  profile: authProfileViewSchema,
});

export const updateAgentProfileDefaultProjectResponseSchema =
  updateProfileResponseSchema;

export const deleteProfileResponseSchema = z.strictObject({
  ok: z.literal(true),
  profile: authProfileViewSchema,
});
