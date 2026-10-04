import { desc, sql } from "drizzle-orm";
import { bigint, check, index, primaryKey, text } from "drizzle-orm/pg-core";
import { members } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

// A restrictive reference protects organization/account removal while the
// owning Space still assigns management to this organization member.
export const spaceOwnerMemberReferences = applicationTable(
  "space_owner_member_references",
  {
    spaceId: text("space_id").notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.memberId] }),
    index("idx_space_owner_member_references_member").on(table.memberId),
  ]
);

export const spaceIndexSpaces = applicationTable(
  "space_index_spaces",
  {
    spaceId: text("space_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    organizationVisibility: text("organization_visibility").notNull(),
    status: text("status").notNull(),
    spaceName: text("space_name"),
    messagePreviewJson: text("message_preview_json"),
    messagePreviewRevision: bigint("message_preview_revision", {
      mode: "number",
    }),
    messagePreviewAttemptedAtMs: bigint("message_preview_attempted_at_ms", {
      mode: "number",
    }),
    spacePurpose: text("space_purpose"),
    directMessagePairKey: text("direct_message_pair_key"),
    directMessageConvertedAtMs: bigint("direct_message_converted_at_ms", {
      mode: "number",
    }),
    activeMemberCount: bigint("active_member_count", { mode: "number" }),
    activeHumanCount: bigint("active_human_count", { mode: "number" }),
    activeAgentCount: bigint("active_agent_count", { mode: "number" }),
    creatorProfileId: text("creator_profile_id"),
    creatorKind: text("creator_kind"),
    creatorOwnerUserId: text("creator_owner_user_id"),
    creatorProfileName: text("creator_profile_name"),
    spaceCreatedAtMs: bigint("space_created_at_ms", { mode: "number" }),
    spaceUpdatedAtMs: bigint("space_updated_at_ms", { mode: "number" }),
    deletedAtMs: bigint("deleted_at_ms", { mode: "number" }),
    deletedByProfileId: text("deleted_by_profile_id"),
    deletedByOwnerUserId: text("deleted_by_owner_user_id"),
    deletedByProfileName: text("deleted_by_profile_name"),
    sourceUpdatedAtMs: bigint("source_updated_at_ms", {
      mode: "number",
    }).notNull(),
    projectedAtMs: bigint("projected_at_ms", { mode: "number" }).notNull(),
    projectionEventId: text("projection_event_id").notNull(),
  },
  (table) => [
    index("idx_space_index_spaces_status_updated").on(
      table.status,
      desc(table.sourceUpdatedAtMs)
    ),
    index("idx_space_index_spaces_org_visibility_updated").on(
      table.organizationId,
      table.organizationVisibility,
      table.status,
      desc(table.sourceUpdatedAtMs)
    ),
    index("idx_space_index_spaces_creator_owner").on(
      table.creatorOwnerUserId,
      table.status,
      desc(table.sourceUpdatedAtMs)
    ),
    index("idx_space_index_spaces_projection_event").on(
      table.projectionEventId
    ),
    index("idx_space_index_spaces_org_dm_pair").on(
      table.organizationId,
      table.directMessagePairKey,
      table.status
    ),
    check(
      "space_index_spaces_organization_visibility_check",
      sql`"organization_visibility" in ('public', 'private')`
    ),
    check(
      "space_index_spaces_organization_id_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
  ]
);

export const spaceIndexMemberships = applicationTable(
  "space_index_memberships",
  {
    spaceId: text("space_id").notNull(),
    profileId: text("profile_id").notNull(),
    profileKindSnapshot: text("profile_kind_snapshot").notNull(),
    profileNameSnapshot: text("profile_name_snapshot").notNull(),
    ownerUserIdSnapshot: text("owner_user_id_snapshot"),
    ownerNameSnapshot: text("owner_name_snapshot"),
    controllerRefSnapshot: text("controller_ref_snapshot"),
    status: text("status").notNull(),
    memberSource: text("member_source").notNull(),
    addedAtMs: bigint("added_at_ms", { mode: "number" }).notNull(),
    removedAtMs: bigint("removed_at_ms", { mode: "number" }),
    addedByProfileId: text("added_by_profile_id"),
    addedByOwnerUserId: text("added_by_owner_user_id"),
    addedByDisplayNameSnapshot: text("added_by_display_name_snapshot"),
    removedByProfileId: text("removed_by_profile_id"),
    removedByOwnerUserId: text("removed_by_owner_user_id"),
    removalReason: text("removal_reason"),
    firstEnteredAtMs: bigint("first_entered_at_ms", { mode: "number" }),
    lastEnteredAtMs: bigint("last_entered_at_ms", { mode: "number" }),
    // Profile-history overlay projected from openmeld_profile_space_history so the
    // account/profile space lists never JOIN across the Profile domain
    // (physical-db-split.md P0.3). Values are raw ms/ts numbers scoped to one
    // gateway host; reads must treat a host mismatch as "no overlay". The
    // overlay is projection data: rebuildable, may lag its Profile source.
    overlayGatewayHost: text("overlay_gateway_host"),
    overlayPinnedAtMs: bigint("overlay_pinned_at_ms", { mode: "number" }),
    overlayLastJoinedAtMs: bigint("overlay_last_joined_at_ms", {
      mode: "number",
    }),
    overlayLastSeenTs: bigint("overlay_last_seen_ts", { mode: "number" }),
    overlayUpdatedAtMs: bigint("overlay_updated_at_ms", { mode: "number" }),
    sourceUpdatedAtMs: bigint("source_updated_at_ms", {
      mode: "number",
    }).notNull(),
    projectedAtMs: bigint("projected_at_ms", { mode: "number" }).notNull(),
    projectionEventId: text("projection_event_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.profileId] }),
    index("idx_space_index_memberships_profile_status_updated").on(
      table.profileId,
      table.status,
      desc(table.sourceUpdatedAtMs)
    ),
    index("idx_space_index_memberships_owner_status_updated").on(
      table.ownerUserIdSnapshot,
      table.status,
      desc(table.sourceUpdatedAtMs)
    ),
    index("idx_space_index_memberships_space_status").on(
      table.spaceId,
      table.status
    ),
    index("idx_space_index_memberships_projection_event").on(
      table.projectionEventId
    ),
  ]
);

export const spaceIndexProjectionEvents = applicationTable(
  "space_index_projection_events",
  {
    projectionEventId: text("projection_event_id").primaryKey(),
    spaceId: text("space_id").notNull(),
    eventType: text("event_type").notNull(),
    sourceUpdatedAtMs: bigint("source_updated_at_ms", {
      mode: "number",
    }).notNull(),
    projectedAtMs: bigint("projected_at_ms", { mode: "number" }).notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    index("idx_space_index_projection_events_space_source").on(
      table.spaceId,
      desc(table.sourceUpdatedAtMs)
    ),
    index("idx_space_index_projection_events_type_source").on(
      table.eventType,
      desc(table.sourceUpdatedAtMs)
    ),
  ]
);
