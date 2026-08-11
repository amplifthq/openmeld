import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// TODO(2026-05-15): Rename or replace this storage-only legacy table after
// Local Runtime registry schema is extracted. Public read models must use Local
// Runtime schemas; do not re-export this as an API contract.
export const openMeldDaemonOwnedDevices = sqliteTable(
  "openMeldDaemon_owned_devices",
  {
    ownerUserId: text("owner_user_id").notNull(),
    deviceId: text("device_id").notNull(),
    connectedComputerId: text("connected_computer_id"),
    observedDisplayName: text("observed_display_name"),
    userDisplayName: text("user_display_name"),
    platformFamily: text("platform_family"),
    osVersion: text("os_version"),
    deviceType: text("device_type"),
    firstSeenAtMs: integer("first_seen_at_ms").notNull(),
    lastObservedAtMs: integer("last_observed_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_owned_devices_owner_device_unique").on(
      table.ownerUserId,
      table.deviceId
    ),
    index("idx_openMeldDaemon_owned_devices_owner_connected_computer").on(
      table.ownerUserId,
      table.connectedComputerId
    ),
  ]
);
