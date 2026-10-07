import { sql } from "drizzle-orm";
import { bigint, integer, primaryKey, text } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";
import { integerBoolean } from "../postgresql/schema-types.ts";

export const firstWorkExperiences = applicationTable(
  "first_work_experiences",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    spaceId: text("space_id").notNull(),
    runId: text("run_id").notNull().default(sql`gen_random_uuid()::text`),
    revision: integer("revision").notNull().default(0),
    iteration: integer("iteration").notNull().default(1),
    step: text("step").notNull().default("create-space"),
    paused: integerBoolean("paused").notNull().default(sql`0`),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })]
);
