import { desc } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Owner-scoped operational evidence, never connection or execution authority.
export const serviceConnectionIncidents = sqliteTable(
  "openmeld_service_connection_incidents",
  {
    ownerUserId: text("owner_user_id").notNull(),
    incidentId: text("incident_id").notNull(),
    deviceId: text("device_id").notNull(),
    runtimeLane: text("runtime_lane").notNull(),
    startedAtMs: integer("started_at_ms").notNull(),
    endedAtMs: integer("ended_at_ms").notNull(),
    receivedAtMs: integer("received_at_ms").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUserId, table.incidentId] }),
    index("idx_service_connection_incidents_owner_device").on(
      table.ownerUserId,
      table.deviceId,
      table.runtimeLane,
      desc(table.endedAtMs)
    ),
    index("idx_service_connection_incidents_retention").on(table.receivedAtMs),
  ]
);
