import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const spaceIndexSpaces = sqliteTable(
  "space_index_spaces",
  {
    spaceId: text("space_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    organizationVisibility: text("organization_visibility").notNull(),
    status: text("status").notNull(),
    spaceName: text("space_name"),
    messagePreviewJson: text("message_preview_json"),
    messagePreviewRevision: integer("message_preview_revision"),
    messagePreviewAttemptedAtMs: integer("message_preview_attempted_at_ms"),
    spacePurpose: text("space_purpose"),
    directMessagePairKey: text("direct_message_pair_key"),
    directMessageConvertedAtMs: integer("direct_message_converted_at_ms"),
    activeMemberCount: integer("active_member_count"),
    activeHumanCount: integer("active_human_count"),
    activeAgentCount: integer("active_agent_count"),
    creatorProfileId: text("creator_profile_id"),
    creatorKind: text("creator_kind"),
    creatorOwnerUserId: text("creator_owner_user_id"),
    creatorProfileName: text("creator_profile_name"),
    spaceCreatedAtMs: integer("space_created_at_ms"),
    spaceUpdatedAtMs: integer("space_updated_at_ms"),
    deletedAtMs: integer("deleted_at_ms"),
    deletedByProfileId: text("deleted_by_profile_id"),
    deletedByOwnerUserId: text("deleted_by_owner_user_id"),
    deletedByProfileName: text("deleted_by_profile_name"),
    sourceUpdatedAtMs: integer("source_updated_at_ms").notNull(),
    projectedAtMs: integer("projected_at_ms").notNull(),
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

export const spaceIndexMemberships = sqliteTable(
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
    addedAtMs: integer("added_at_ms").notNull(),
    removedAtMs: integer("removed_at_ms"),
    addedByProfileId: text("added_by_profile_id"),
    addedByOwnerUserId: text("added_by_owner_user_id"),
    addedByDisplayNameSnapshot: text("added_by_display_name_snapshot"),
    removedByProfileId: text("removed_by_profile_id"),
    removedByOwnerUserId: text("removed_by_owner_user_id"),
    removalReason: text("removal_reason"),
    firstEnteredAtMs: integer("first_entered_at_ms"),
    lastEnteredAtMs: integer("last_entered_at_ms"),
    // Profile-history overlay projected from openmeld_profile_space_history so the
    // account/profile space lists never JOIN across the Profile domain
    // (physical-db-split.md P0.3). Values are raw ms/ts numbers scoped to one
    // gateway host; reads must treat a host mismatch as "no overlay". The
    // overlay is projection data: rebuildable, may lag its Profile source.
    overlayGatewayHost: text("overlay_gateway_host"),
    overlayPinnedAtMs: integer("overlay_pinned_at_ms"),
    overlayLastJoinedAtMs: integer("overlay_last_joined_at_ms"),
    overlayLastSeenTs: integer("overlay_last_seen_ts"),
    overlayUpdatedAtMs: integer("overlay_updated_at_ms"),
    sourceUpdatedAtMs: integer("source_updated_at_ms").notNull(),
    projectedAtMs: integer("projected_at_ms").notNull(),
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

export const spaceIndexProjectionEvents = sqliteTable(
  "space_index_projection_events",
  {
    projectionEventId: text("projection_event_id").primaryKey(),
    spaceId: text("space_id").notNull(),
    eventType: text("event_type").notNull(),
    sourceUpdatedAtMs: integer("source_updated_at_ms").notNull(),
    projectedAtMs: integer("projected_at_ms").notNull(),
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
