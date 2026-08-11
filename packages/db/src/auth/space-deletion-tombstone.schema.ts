import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { OpenMeldProfileSpaceCreatorKind } from "./profile-space-history.schema.ts";

export const openMeldSpaceDeletionTombstones = sqliteTable(
  "openmeld_space_deletion_tombstones",
  {
    gatewayHost: text("gateway_host").notNull(),
    spaceId: text("space_id").notNull(),
    spaceName: text("space_name"),
    creatorProfileId: text("creator_profile_id"),
    creatorKind: text("creator_kind").$type<OpenMeldProfileSpaceCreatorKind>(),
    deletedByProfileId: text("deleted_by_profile_id"),
    deletedByProfileName: text("deleted_by_profile_name"),
    deletedByOwnerUserId: text("deleted_by_owner_user_id"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("openmeld_space_deletion_tombstones_gateway_space_uq_idx").on(
      table.gatewayHost,
      table.spaceId
    ),
    index("openmeld_space_deletion_tombstones_gateway_deleted_idx").on(
      table.gatewayHost,
      table.deletedAt
    ),
    check(
      "openmeld_space_deletion_tombstones_creator_kind_check",
      sql`"creator_kind" is null or "creator_kind" in ('human', 'agent', 'system')`
    ),
  ]
);
