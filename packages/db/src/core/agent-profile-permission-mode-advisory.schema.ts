import { sql } from "drizzle-orm";
import { bigint, check, index, text } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

/**
 * Permission-mode advisor state, one row per Agent Profile. The waiting
 * approval count itself is derived from existing RuntimeCoordinator and Agent
 * Task records; this row only remembers the last suggestion (for the
 * one-per-week limit) and its owner-only card.
 */
export const agentProfilePermissionModeAdvisories = applicationTable(
  "agent_profile_permission_mode_advisories",
  {
    agentProfileId: text("agent_profile_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    suggestionId: text("suggestion_id").notNull(),
    lastSuggestedAtMs: bigint("last_suggested_at_ms", {
      mode: "number",
    }).notNull(),
    suggestedDispatchId: text("suggested_dispatch_id").notNull(),
    advisoryJson: text("advisory_json").notNull(),
    currentPermissionMode: text("current_permission_mode").notNull(),
    suggestedPermissionMode: text("suggested_permission_mode").notNull(),
    waitingApprovalCount: bigint("waiting_approval_count", {
      mode: "number",
    }).notNull(),
    cardStatus: text("card_status"),
    cardSpaceId: text("card_space_id"),
    cardOfferedAtMs: bigint("card_offered_at_ms", { mode: "number" }),
    cardResolvedAtMs: bigint("card_resolved_at_ms", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    index("agent_profile_permission_mode_advisories_owner_card_idx").on(
      table.ownerUserId,
      table.cardStatus,
      table.cardSpaceId
    ),
    check(
      "agent_profile_permission_mode_advisories_identity_check",
      sql`length(trim("agent_profile_id")) > 0 and length(trim("organization_id")) > 0 and length(trim("owner_user_id")) > 0 and length(trim("suggestion_id")) > 0 and length(trim("suggested_dispatch_id")) > 0`
    ),
    check(
      "agent_profile_permission_mode_advisories_count_check",
      sql`"waiting_approval_count" > 0`
    ),
    check(
      "agent_profile_permission_mode_advisories_card_check",
      sql`("card_status" is null and "card_space_id" is null and "card_offered_at_ms" is null and "card_resolved_at_ms" is null)
        or ("card_status" = 'pending' and "card_space_id" is not null and "card_offered_at_ms" is not null and "card_resolved_at_ms" is null)
        or ("card_status" in ('applied', 'dismissed') and "card_space_id" is not null and "card_offered_at_ms" is not null and "card_resolved_at_ms" is not null)`
    ),
  ]
);
