import * as z from "zod/v4";
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
export const accountSpaceActiveWakeTargetSchema = z.strictObject({
  activeWakeCount: z.number().int().min(1),
  profileId: trimmedNonEmptyStringSchema,
  // Identity reads can be temporarily unavailable without making the owning
  // RuntimeCoordinator evidence untrue. Clients then use honest generic copy.
  profileName: trimmedNonEmptyStringSchema.nullable(),
});

export const accountSpaceActiveWakeSummaryItemSchema = z
  .strictObject({
    activeWakeCount: z.number().int().min(1),
    // Optional during the Core/Web rollout so an older Core still produces a
    // usable count. New Core responses always include this attribution.
    activeTargets: z.array(accountSpaceActiveWakeTargetSchema).optional(),
    spaceId: trimmedNonEmptyStringSchema,
  })
  .superRefine((item, context) => {
    if (!item.activeTargets) {
      return;
    }
    const uniqueProfileIds = new Set(
      item.activeTargets.map((target) => target.profileId)
    );
    if (uniqueProfileIds.size !== item.activeTargets.length) {
      context.addIssue({
        code: "custom",
        message: "active Wake targets must be unique by profileId",
        path: ["activeTargets"],
      });
    }
    const attributedWakeCount = item.activeTargets.reduce(
      (total, target) => total + target.activeWakeCount,
      0
    );
    if (attributedWakeCount !== item.activeWakeCount) {
      context.addIssue({
        code: "custom",
        message: "active Wake target counts must equal activeWakeCount",
        path: ["activeTargets"],
      });
    }
  });

export const accountSpaceActiveWakeSummaryResponseSchema = z.strictObject({
  generatedAtMs: z.number().int().min(0),
  items: z.array(accountSpaceActiveWakeSummaryItemSchema),
});
