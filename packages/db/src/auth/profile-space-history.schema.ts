import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { openMeldProfiles } from "./openmeld-profile.schema.ts";

export const OPENMELD_PROFILE_SPACE_HISTORY_STATUSES = [
  "active",
  "removed",
  "inaccessible",
] as const;
export type OpenMeldProfileSpaceHistoryStatus =
  (typeof OPENMELD_PROFILE_SPACE_HISTORY_STATUSES)[number];

export const OPENMELD_PROFILE_SPACE_CREATOR_KINDS = [
  "human",
  "agent",
  "system",
] as const;
export type OpenMeldProfileSpaceCreatorKind =
  (typeof OPENMELD_PROFILE_SPACE_CREATOR_KINDS)[number];

export const openMeldProfileSpaceHistory = sqliteTable(
  "openmeld_profile_space_history",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    gatewayHost: text("gateway_host").notNull(),
    spaceId: text("space_id").notNull(),
    spaceName: text("space_name"),
    creatorProfileId: text("creator_profile_id"),
    creatorKind: text("creator_kind").$type<OpenMeldProfileSpaceCreatorKind>(),
    spaceCreatedAt: integer("space_created_at", { mode: "timestamp_ms" }),
    spaceUpdatedAt: integer("space_updated_at", { mode: "timestamp_ms" }),
    lastJoinedAt: integer("last_joined_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenTs: integer("last_seen_ts"),
    pinnedAt: integer("pinned_at", { mode: "timestamp_ms" }),
    status: text("status")
      .$type<OpenMeldProfileSpaceHistoryStatus>()
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "openmeld_profile_space_history_profile_gateway_space_uq_idx"
    ).on(table.profileId, table.gatewayHost, table.spaceId),
    index(
      "openmeld_profile_space_history_profile_gateway_status_joined_idx"
    ).on(table.profileId, table.gatewayHost, table.status, table.lastJoinedAt),
    index(
      "openmeld_profile_space_history_profile_gateway_status_pinned_idx"
    ).on(table.profileId, table.gatewayHost, table.status, table.pinnedAt),
    index("openmeld_profile_space_history_profile_gateway_updated_idx").on(
      table.profileId,
      table.gatewayHost,
      table.updatedAt
    ),
    check(
      "openmeld_profile_space_history_status_check",
      sql`"status" in ('active', 'removed', 'inaccessible')`
    ),
    check(
      "openmeld_profile_space_history_creator_kind_check",
      sql`"creator_kind" is null or "creator_kind" in ('human', 'agent', 'system')`
    ),
    check(
      "openmeld_profile_space_history_last_seen_ts_check",
      sql`"last_seen_ts" is null or "last_seen_ts" >= 0`
    ),
  ]
);

export const openMeldProfileSpaceHistoryRelations = relations(
  openMeldProfileSpaceHistory,
  ({ one }) => ({
    profile: one(openMeldProfiles, {
      fields: [openMeldProfileSpaceHistory.profileId],
      references: [openMeldProfiles.profileId],
    }),
  })
);
