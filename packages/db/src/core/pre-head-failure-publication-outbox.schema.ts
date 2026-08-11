import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Core-owned operational recovery state for terminal failures discovered before
 * RuntimeCoordinator accepts a Wake. This table is intentionally outside the
 * time-decaying Wake evidence domain: pending publication commands must survive
 * observability retention until their visible Space receipt is durable.
 */
export const openMeldDaemonPreHeadFailurePublicationOutbox = sqliteTable(
  "openMeldDaemon_pre_head_failure_publication_outbox",
  {
    dispatchId: text("dispatch_id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptId: text("attempt_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    modelVersion: text("model_version").notNull(),
    failureContext: text("failure_context").notNull(),
    finalStatus: text("final_status").notNull(),
    errorCode: text("error_code").notNull(),
    errorMessage: text("error_message"),
    recordProfileNotFoundObservation: integer(
      "record_profile_not_found_observation",
      { mode: "boolean" }
    )
      .notNull()
      .default(false),
    publicationCommandJson: text("publication_command_json").notNull(),
    redriveMessageJson: text("redrive_message_json").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    nextAttemptAtMs: integer("next_attempt_at_ms").notNull(),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    stateVersion: integer("state_version").notNull(),
    completedAtMs: integer("completed_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    check(
      "openMeldDaemon_pre_head_failure_publication_outbox_status_check",
      sql`${table.status} IN ('pending', 'completed')`
    ),
    check(
      "openMeldDaemon_pre_head_failure_publication_outbox_failure_context_check",
      sql`${table.failureContext} = 'preflight_terminal'`
    ),
    check(
      "openMeldDaemon_pre_head_failure_publication_outbox_final_status_check",
      sql`${table.finalStatus} IN ('blocked', 'failed_terminal')`
    ),
    check(
      "openMeldDaemon_pre_head_failure_publication_outbox_counters_check",
      sql`${table.attemptCount} >= 0 AND ${table.stateVersion} >= 0`
    ),
    check(
      "openMeldDaemon_pre_head_failure_publication_outbox_claim_check",
      sql`(${table.claimId} IS NULL AND ${table.claimExpiresAtMs} IS NULL) OR (${table.claimId} IS NOT NULL AND ${table.claimExpiresAtMs} IS NOT NULL)`
    ),
    check(
      "openMeldDaemon_pre_head_failure_publication_outbox_completion_check",
      sql`(${table.status} = 'pending' AND ${table.completedAtMs} IS NULL) OR (${table.status} = 'completed' AND ${table.completedAtMs} IS NOT NULL AND ${table.claimId} IS NULL AND ${table.claimExpiresAtMs} IS NULL)`
    ),
    index("openMeldDaemon_pre_head_failure_publication_outbox_due_idx").on(
      table.status,
      table.nextAttemptAtMs,
      table.claimExpiresAtMs
    ),
    index("openMeldDaemon_pre_head_failure_publication_outbox_updated_idx").on(
      table.updatedAtMs
    ),
  ]
);
