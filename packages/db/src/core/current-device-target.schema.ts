import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const openMeldDaemonCurrentDeviceTargets = sqliteTable(
  "openMeldDaemon_current_device_targets",
  {
    ownerUserId: text("owner_user_id").primaryKey(),
    deviceId: text("device_id").notNull(),
    runtimeLane: text("runtime_lane"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  }
);
