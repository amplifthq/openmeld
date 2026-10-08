import { bigint, index, text } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

/** Auth owns acceptance; scheduled cleanup retries cross-service erasure. */
export const accountDeletionRequests = applicationTable(
  "account_deletion_requests",
  {
    userId: text("user_id").primaryKey(),
    planJson: text("plan_json").notNull(),
    pendingConnectionsJson: text("pending_connections_json")
      .notNull()
      .default("[]"),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    completedAtMs: bigint("completed_at_ms", { mode: "number" }),
    nextAttemptAtMs: bigint("next_attempt_at_ms", { mode: "number" }).notNull(),
    attemptCount: bigint("attempt_count", { mode: "number" })
      .notNull()
      .default(0),
    privateRootIndex: bigint("private_root_index", { mode: "number" })
      .notNull()
      .default(0),
    lastError: text("last_error"),
  },
  (table) => [
    index("account_deletion_requests_due_idx").on(
      table.completedAtMs,
      table.nextAttemptAtMs
    ),
  ]
);
