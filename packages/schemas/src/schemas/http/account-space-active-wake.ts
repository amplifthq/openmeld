import { z } from "zod/v4";
import { profileSpaceHistoryGatewayHostSchema } from "./profile-space-history";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
export const ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS = 45_000;

export const accountSpaceActiveWakeSummaryQuerySchema = z.strictObject({
  gatewayHost: profileSpaceHistoryGatewayHostSchema.optional(),
  selectedProfileId: trimmedNonEmptyStringSchema,
});

export const accountSpaceActiveWakeSummaryRpcInputSchema = z.strictObject({
  gatewayHost: profileSpaceHistoryGatewayHostSchema.optional(),
  ownerUserId: trimmedNonEmptyStringSchema,
  selectedProfileId: trimmedNonEmptyStringSchema,
});

// Ambient per-Space "agent is working" evidence for account-level list surfaces
// (e.g. the Spaces sidebar). Spaces with no in-flight Wake are omitted, so items
// only ever carry counts >= 1.
export const accountSpaceActiveWakeSummaryItemSchema = z.strictObject({
  activeWakeCount: z.number().int().min(1),
  spaceId: trimmedNonEmptyStringSchema,
});

export const accountSpaceActiveWakeSummaryResponseSchema = z.strictObject({
  generatedAtMs: z.number().int().min(0),
  items: z.array(accountSpaceActiveWakeSummaryItemSchema),
});
