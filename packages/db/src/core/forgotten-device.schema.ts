import { bigint, text, uniqueIndex } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

export const openMeldDaemonForgottenDevices = applicationTable(
  "openMeldDaemon_forgotten_devices",
  {
    ownerUserId: text("owner_user_id").notNull(),
    deviceId: text("device_id").notNull(),
    forgottenAtMs: bigint("forgotten_at_ms", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_forgotten_devices_owner_device_unique").on(
      table.ownerUserId,
      table.deviceId
    ),
  ]
);
