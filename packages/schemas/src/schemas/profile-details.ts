import * as z from "zod/v4";
import { agentProfileWorkRecoveryActionKindSchema } from "./agent-profile-work-recovery";
import { authProfileKindSchema } from "./http/profiles";

export const profileDetailsViewerScopeSchema = z.enum([
  "owner_self",
  "observer",
]);

export const profileDetailsContextSchema = z.enum(["account", "space"]);

export const profileDetailsSectionIdSchema = z.enum([
  "profile",
  "activity",
  "space_membership",
  "connection",
  "agent_controller_permission_mode",
  "wake_availability",
  "advanced",
]);

export const profileDetailsFieldSourceSchema = z.enum([
  "profile_identity",
  "agent_profile_work_coordinator",
  "space_membership",
  "binding",
  "readiness",
  "local_runtime",
  "agent_controller",
]);

export const profileDetailsFieldValueKindSchema = z.enum([
  "text",
  "identifier",
  "path",
  "status",
]);

export const profileDetailsFieldVisibilitySchema = z.enum([
  "all_viewers",
  "owner_self",
]);

export const profileDetailsRecoveryActionKindSchema =
  agentProfileWorkRecoveryActionKindSchema;

export const profileDetailsRecoveryActionSchema = z.strictObject({
  expectedInterruptedTargetWakeLifecycleId: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional(),
  kind: profileDetailsRecoveryActionKindSchema,
  visibility: z.literal("owner_self"),
});

export const profileDetailsCopyActionSchema = z.strictObject({
  label: z.string().min(1),
  successMessage: z.string().min(1),
});

export const profileDetailsFieldSchema = z.strictObject({
  copy: z.union([profileDetailsCopyActionSchema, z.null()]),
  id: z.string().min(1),
  label: z.string().min(1),
  source: profileDetailsFieldSourceSchema,
  value: z.string().min(1),
  valueKind: profileDetailsFieldValueKindSchema,
  visibility: profileDetailsFieldVisibilitySchema,
});

const profileDetailsSectionFields = {
  rows: z.array(profileDetailsFieldSchema).min(1),
  title: z.string().min(1),
};

export const profileDetailsSectionSchema = z.discriminatedUnion("id", [
  z.strictObject({
    id: z.literal("activity"),
    recoveryAction: z.union([profileDetailsRecoveryActionSchema, z.null()]),
    ...profileDetailsSectionFields,
  }),
  z.strictObject({
    id: profileDetailsSectionIdSchema.exclude(["activity"]),
    recoveryAction: z.null(),
    ...profileDetailsSectionFields,
  }),
]);

export const profileDetailsSnapshotSchema = z
  .strictObject({
    context: profileDetailsContextSchema,
    profileId: z.string().min(1),
    profileKind: authProfileKindSchema,
    profileName: z.string().min(1),
    sections: z.array(profileDetailsSectionSchema),
    viewerScope: profileDetailsViewerScopeSchema,
  })
  .superRefine((snapshot, refinementContext) => {
    if (
      snapshot.viewerScope === "observer" &&
      snapshot.sections.some((section) => section.recoveryAction !== null)
    ) {
      refinementContext.addIssue({
        code: "custom",
        message: "Recovery actions are visible only to the profile owner.",
        path: ["sections"],
      });
    }
  });
