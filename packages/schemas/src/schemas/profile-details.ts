import { z } from "zod/v4";
import { authProfileKindSchema } from "./http/profiles";

export const profileDetailsViewerScopeSchema = z.enum([
  "owner_self",
  "observer",
]);

export const profileDetailsContextSchema = z.enum(["account", "space"]);

export const profileDetailsSectionIdSchema = z.enum([
  "profile",
  "space_membership",
  "connection",
  "agent_controller_permission_mode",
  "wake_availability",
  "advanced",
]);

export const profileDetailsFieldSourceSchema = z.enum([
  "profile_identity",
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

export const profileDetailsSectionSchema = z.strictObject({
  id: profileDetailsSectionIdSchema,
  rows: z.array(profileDetailsFieldSchema).min(1),
  title: z.string().min(1),
});

export const profileDetailsSnapshotSchema = z.strictObject({
  context: profileDetailsContextSchema,
  profileId: z.string().min(1),
  profileKind: authProfileKindSchema,
  profileName: z.string().min(1),
  sections: z.array(profileDetailsSectionSchema),
  viewerScope: profileDetailsViewerScopeSchema,
});
