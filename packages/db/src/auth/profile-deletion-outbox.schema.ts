import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const openMeldProfileDeletionOutbox = sqliteTable(
  "openmeld_profile_deletion_outbox",
  {
    profileId: text("profile_id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    profileKind: text("profile_kind").$type<"agent" | "human">().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAtMs: integer("next_attempt_at_ms")
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    lastAttemptAtMs: integer("last_attempt_at_ms"),
    lastError: text("last_error"),
    createdAtMs: integer("created_at_ms")
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAtMs: integer("updated_at_ms")
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("openmeld_profile_deletion_outbox_due_idx").on(
      table.nextAttemptAtMs,
      table.createdAtMs
    ),
    check(
      "openmeld_profile_deletion_outbox_profile_kind_check",
      sql`"profile_kind" in ('agent', 'human')`
    ),
    check(
      "openmeld_profile_deletion_outbox_attempt_count_check",
      sql`"attempt_count" >= 0`
    ),
    check(
      "openmeld_profile_deletion_outbox_last_error_check",
      sql`"last_error" is null or length("last_error") <= 500`
    ),
    check(
      "openmeld_profile_deletion_outbox_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
