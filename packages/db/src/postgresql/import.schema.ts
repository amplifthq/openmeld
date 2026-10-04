import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgSchema } from "drizzle-orm/pg-core";

// Migration-owner metadata. Never include this in the application schema or
// runtime grants: only the importer can establish committed import evidence.
export const migrationSchema = pgSchema("openmeld_migration");
export const d1ImportCompletion = migrationSchema.table(
  "d1_import_completion",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    record: jsonb("record").notNull(),
  },
  (table) => [check("single_import", sql`${table.singleton}`)]
);
