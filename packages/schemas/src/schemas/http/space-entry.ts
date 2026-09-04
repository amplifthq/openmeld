import * as z from "zod/v4";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";

const optionalTrimmedStringSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());

export const spaceEntryTargetSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
  signalId: optionalTrimmedStringSchema,
  threadRootSignalId: optionalTrimmedStringSchema,
});

export const getSpaceEntryResolutionInputSchema = spaceEntryTargetSchema;

export const spaceEntryAllowedViewSchema = z.strictObject({
  state: z.literal("allowed"),
  experience: z.enum(["member", "public"]),
});

export const spaceEntryBlockedViewSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("sign_in_required") }),
  z.strictObject({ state: z.literal("password_required") }),
  z.strictObject({ state: z.literal("membership_required") }),
  z.strictObject({ state: z.literal("unavailable") }),
]);

export const spaceEntryViewSchema = z.union([
  spaceEntryAllowedViewSchema,
  spaceEntryBlockedViewSchema,
]);

export const spaceEntryParticipationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("active_member") }),
  z.strictObject({ state: z.literal("self_join_available") }),
  z.strictObject({ state: z.literal("password_required") }),
  z.strictObject({ state: z.literal("owner_add_required") }),
  z.strictObject({ state: z.literal("unavailable") }),
]);

export const spaceEntryOwnerSchema = z.strictObject({
  profileId: openMeldRuntimeProfileIdSchema,
  displayName: optionalTrimmedStringSchema,
});

export const spaceEntrySafeContextSchema = z.strictObject({
  organizationId: optionalTrimmedStringSchema,
  organizationSlug: optionalTrimmedStringSchema,
  spaceName: optionalTrimmedStringSchema,
  owner: spaceEntryOwnerSchema.optional(),
});

export const spaceEntryRecoverySchema = z.union([
  z.strictObject({ kind: z.literal("sign_in") }),
  z.strictObject({ kind: z.literal("provide_password") }),
  z.strictObject({ kind: z.literal("contact_space_owner") }),
]);

export const getSpaceEntryResolutionResponseSchema = z.strictObject({
  target: spaceEntryTargetSchema,
  view: spaceEntryViewSchema,
  participation: spaceEntryParticipationSchema,
  safeContext: spaceEntrySafeContextSchema,
  recovery: spaceEntryRecoverySchema.nullable(),
});
