import * as z from "../../lazy-zod";
import { agentProfileWorkRecoveryActionKindSchema } from "../agent-profile-work-recovery";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { agentProfileIdSchema, uuidProfileIdSchema } from "../protocol/profile";
import { getAgentExecutionReadinessResponseSchema } from "./agent-execution-readiness";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";
import { authProfileManagedRoleSchema } from "./profiles";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);

export const organizationDirectoryAgentProfileWorkLocationSchema =
  z.strictObject({
    spaceId: z.string().trim().min(1).max(512),
    spaceName: trimmedNonEmptyStringSchema,
  });

export const organizationDirectoryAgentProfileOperationalContextSchema =
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("checking") }),
    z.strictObject({
      status: z.literal("idle"),
      waitingCount: z.literal(0),
    }),
    z.strictObject({
      currentWorkLocation:
        organizationDirectoryAgentProfileWorkLocationSchema.optional(),
      queuedWorkLocations: z
        .array(organizationDirectoryAgentProfileWorkLocationSchema)
        .max(50)
        .optional(),
      status: z.literal("working"),
      waitingCount: z.number().int().min(0).max(50),
    }),
    z.strictObject({
      currentWorkLocation:
        organizationDirectoryAgentProfileWorkLocationSchema.optional(),
      queuedWorkLocations: z
        .array(organizationDirectoryAgentProfileWorkLocationSchema)
        .max(50)
        .optional(),
      recoveryAction: agentProfileWorkRecoveryActionKindSchema.optional(),
      recoveryTargetWakeLifecycleId: trimmedNonEmptyStringSchema.optional(),
      status: z.literal("paused"),
      waitingCount: z.number().int().min(0).max(50),
    }),
  ]);

export const organizationDirectoryHumanProfileSchema = z.strictObject({
  lastUsedAt: z.union([ISO_DATE_TIME_SCHEMA, z.null()]).optional(),
  profileId: uuidProfileIdSchema,
  profileName: trimmedNonEmptyStringSchema,
  profileHandle: trimmedNonEmptyStringSchema,
  status: z.enum(["active", "disabled"]),
});

export const organizationDirectoryMemberSchema = z.strictObject({
  lastActiveAt: z.union([ISO_DATE_TIME_SCHEMA, z.null()]).optional(),
  memberId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  userId: trimmedNonEmptyStringSchema,
  role: trimmedNonEmptyStringSchema,
  joinedAt: ISO_DATE_TIME_SCHEMA,
  user: z.strictObject({
    id: trimmedNonEmptyStringSchema,
    name: trimmedNonEmptyStringSchema,
    email: trimmedNonEmptyStringSchema,
    image: nullableTrimmedStringSchema,
  }),
  humanProfile: organizationDirectoryHumanProfileSchema.nullable(),
});

export const organizationDirectoryAgentProfileIdentitySchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  profileId: agentProfileIdSchema,
  profileName: trimmedNonEmptyStringSchema,
  profileHandle: trimmedNonEmptyStringSchema,
  profileKind: z.literal("agent"),
  isDefault: z.literal(false),
  status: z.enum(["active", "disabled"]),
  ownerUserId: trimmedNonEmptyStringSchema,
  ownerName: trimmedNonEmptyStringSchema.optional(),
  avatarUrl: trimmedNonEmptyStringSchema.optional(),
  source: trimmedNonEmptyStringSchema,
  managedRole: z.union([authProfileManagedRoleSchema, z.null()]),
  createdByUserId: nullableTrimmedStringSchema,
  creatorProfileId: nullableTrimmedStringSchema,
  lastUsedAt: z.union([ISO_DATE_TIME_SCHEMA, z.null()]),
  createdAt: ISO_DATE_TIME_SCHEMA,
  updatedAt: ISO_DATE_TIME_SCHEMA,
});

export const organizationDirectoryAgentProfileSchema =
  organizationDirectoryAgentProfileIdentitySchema.extend({
    isCenterAgent: z.boolean().optional(),
    operationalContext:
      organizationDirectoryAgentProfileOperationalContextSchema.optional(),
    readiness: getAgentExecutionReadinessResponseSchema,
  });

export const organizationDirectoryResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  members: z.array(organizationDirectoryMemberSchema),
  agentProfiles: z.array(organizationDirectoryAgentProfileSchema),
});

export const organizationMemberWebActivityResponseSchema = z.strictObject({
  lastActiveAt: ISO_DATE_TIME_SCHEMA,
  organizationId: trimmedNonEmptyStringSchema,
  userId: trimmedNonEmptyStringSchema,
});

export const CENTER_AGENT_ORGANIZATION_MEMBERS_LIST_DEFAULT_LIMIT = 20;
export const CENTER_AGENT_ORGANIZATION_MEMBERS_LIST_MAX_LIMIT = 100;

export const centerAgentListOrganizationMembersBodySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(1024).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(CENTER_AGENT_ORGANIZATION_MEMBERS_LIST_MAX_LIMIT)
    .optional(),
});

export const centerAgentListOrganizationMembersToolRpcInputSchema =
  centerAgentListOrganizationMembersBodySchema.extend({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentToolSpeakerSchema.optional(),
  });

/**
 * Bounded, member-only Organization read projection for Center Agent tools.
 * It intentionally never resolves or returns Agent Profiles or their readiness;
 * the broad `organizationDirectoryResponseSchema` remains the authority for
 * callers that need Agent Profile identity and readiness.
 */
export const centerAgentListOrganizationMembersResponseSchema = z.strictObject({
  generatedAt: ISO_DATE_TIME_SCHEMA,
  members: z.array(organizationDirectoryMemberSchema),
  nextCursor: z.string().trim().min(1).max(1024).nullable(),
  organizationId: trimmedNonEmptyStringSchema,
  totalMembers: z.number().int().nonnegative(),
});
