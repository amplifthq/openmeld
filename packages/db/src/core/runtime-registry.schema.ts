import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonRuntimeRegistryRecords = sqliteTable(
  "openMeldDaemon_runtime_registry_records",
  {
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").primaryKey(),
    ownerKind: text("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),
    deviceId: text("device_id").notNull(),
    lane: text("lane").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    lastRegisteredAtMs: integer("last_registered_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldDaemon_runtime_registry_records_owner_device_lane_unique"
    ).on(table.ownerKind, table.ownerId, table.deviceId, table.lane),
    check(
      "openMeldDaemon_runtime_registry_records_owner_kind_check",
      sql`"owner_kind" in ('owner_account')`
    ),
    check(
      "openMeldDaemon_runtime_registry_records_openmeld_service_runtime_id_non_empty_check",
      sql`length(trim("openmeld_service_runtime_id")) > 0`
    ),
    check(
      "openMeldDaemon_runtime_registry_records_owner_id_non_empty_check",
      sql`length(trim("owner_id")) > 0`
    ),
    check(
      "openMeldDaemon_runtime_registry_records_device_id_non_empty_check",
      sql`length(trim("device_id")) > 0`
    ),
    check(
      "openMeldDaemon_runtime_registry_records_lane_non_empty_check",
      sql`length(trim("lane")) > 0`
    ),
  ]
);
