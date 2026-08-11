import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonForgottenDevices = sqliteTable(
  "openMeldDaemon_forgotten_devices",
  {
    ownerUserId: text("owner_user_id").notNull(),
    deviceId: text("device_id").notNull(),
    forgottenAtMs: integer("forgotten_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_forgotten_devices_owner_device_unique").on(
      table.ownerUserId,
      table.deviceId
    ),
  ]
);
