import { bigint, text } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

export const openMeldDaemonCurrentDeviceTargets = applicationTable(
  "openMeldDaemon_current_device_targets",
  {
    ownerUserId: text("owner_user_id").primaryKey(),
    deviceId: text("device_id").notNull(),
    runtimeLane: text("runtime_lane"),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  }
);
