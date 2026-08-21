import { z } from "zod/v4";
import { agentProfileIdSchema, uuidProfileIdSchema } from "../protocol/profile";
import { getAgentExecutionReadinessResponseSchema } from "./agent-execution-readiness";
import { authProfileManagedRoleSchema } from "./profiles";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
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
    readiness: getAgentExecutionReadinessResponseSchema,
  });

export const organizationDirectoryResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  generatedAt: ISO_DATE_TIME_SCHEMA,
  members: z.array(organizationDirectoryMemberSchema),
  agentProfiles: z.array(organizationDirectoryAgentProfileSchema),
});
