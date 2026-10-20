import * as z from "zod/v4";

// The closed set of blocking reasons Organization members may see on another
// member's Agent Profile (developing/product/agent-profiles.md, Agent Profile
// Operational Context). Each reason is projected only from current
// owner-side evidence; with no exact evidence the reason is absent and the
// public four-state Wakeability stays generic. Quota numbers, subscription
// tier, account identity, Computer names, paths, and diagnostics never enter
// this object.
export const PUBLIC_WAKEABILITY_REASON_CODES = [
  "not_signed_in",
  "no_subscription",
  "org_disabled",
  "version_too_old",
  "computer_offline",
  "usage_exhausted",
  "harness_turned_off",
  "no_working_folder",
] as const;

export const publicWakeabilityReasonCodeSchema = z.enum(
  PUBLIC_WAKEABILITY_REASON_CODES
);
export type PublicWakeabilityReasonCode = z.infer<
  typeof publicWakeabilityReasonCodeSchema
>;

export const publicWakeabilityReasonSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("not_signed_in") }),
  z.strictObject({ code: z.literal("no_subscription") }),
  z.strictObject({ code: z.literal("org_disabled") }),
  z.strictObject({
    code: z.literal("version_too_old"),
    // The model the installed Harness version cannot run.
    modelId: z.string().trim().min(1).max(256),
  }),
  z.strictObject({ code: z.literal("computer_offline") }),
  // The owner turned this harness off on its Computer.
  z.strictObject({ code: z.literal("harness_turned_off") }),
  // The Profile has no usable working folder on its Computer.
  z.strictObject({ code: z.literal("no_working_folder") }),
  z.strictObject({
    code: z.literal("usage_exhausted"),
    // When the earliest exhausted Usage Limit resets, if a current report
    // says so.
    resetAt: z.iso.datetime({ offset: true }).nullable(),
  }),
]);
export type PublicWakeabilityReason = z.infer<
  typeof publicWakeabilityReasonSchema
>;
