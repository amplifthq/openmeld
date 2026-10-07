import { bigint, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

// TODO(2026-05-15): Rename or replace this storage-only legacy table after
// Local Runtime registry schema is extracted. Public read models must use Local
// Runtime schemas; do not re-export this as an API contract.
export const openMeldDaemonOwnedDevices = applicationTable(
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
    firstSeenAtMs: bigint("first_seen_at_ms", { mode: "number" }).notNull(),
    lastObservedAtMs: bigint("last_observed_at_ms", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
