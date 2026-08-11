import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openMeldDaemonPreHeadFailurePublicationOutbox } from "../src/core";
import { schema } from "../src/schema";

const migrationDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle"
);

const applySharedMigrations = (database: DatabaseSync): void => {
  const statements = fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) =>
      fs.readFileSync(path.join(migrationDirectoryPath, entry), "utf8")
    )
    .join("\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    database.exec(statement);
  }
};

const insertPendingPublication = (
  database: DatabaseSync,
  input: { createdAtMs: number; dispatchId: string }
): void => {
  database
    .prepare(
      `
        INSERT INTO openMeldDaemon_pre_head_failure_publication_outbox (
          dispatch_id,
          idempotency_key,
          attempt_id,
          created_at_ms,
          model_version,
          failure_context,
          final_status,
          error_code,
          error_message,
          record_profile_not_found_observation,
          publication_command_json,
          redrive_message_json,
          status,
          attempt_count,
          next_attempt_at_ms,
          claim_id,
          claim_expires_at_ms,
          state_version,
          completed_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, 'preflight_terminal', 'failed_terminal', ?, NULL, 0, '{}', '{}', 'pending', 0, ?, NULL, NULL, 0, NULL, ?)
      `
    )
    .run(
      input.dispatchId,
      `idempotency:${input.dispatchId}`,
      `attempt:${input.dispatchId}`,
      input.createdAtMs,
      "openmeld.dispatch.pre_head_failure_publication_intent.v2",
      "agent_profile_binding.profile_owner_invalid",
      input.createdAtMs,
      input.createdAtMs
    );
};

describe("pre-head failure publication outbox storage", () => {
  it("exports one Core-owned operational outbox through the shared schema", () => {
    expect(openMeldDaemonPreHeadFailurePublicationOutbox).toBeDefined();
    expect(schema.openMeldDaemonPreHeadFailurePublicationOutbox).toBe(
      openMeldDaemonPreHeadFailurePublicationOutbox
    );
  });

  it("keeps pending recovery commands outside time-decaying Wake evidence", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      const olderThanWakeEvidenceRetentionMs = Date.parse(
        "2026-01-01T00:00:00.000Z"
      );
      insertPendingPublication(database, {
        createdAtMs: olderThanWakeEvidenceRetentionMs,
        dispatchId: "dispatch-old-pending",
      });
      database
        .prepare(
          `
            INSERT INTO openMeldDaemon_ops_decisions (
              id,
              decision_code,
              decision_payload_json,
              decided_by,
              decided_at_ms,
              expected_recovery_criteria,
              source,
              correlation_id
            )
            VALUES ('decision-old', 'audit.only', '{}', 'test', ?, NULL, 'test', 'dispatch-old-pending')
          `
        )
        .run(olderThanWakeEvidenceRetentionMs);

      database
        .prepare(
          "DELETE FROM openMeldDaemon_ops_decisions WHERE decided_at_ms < ?"
        )
        .run(Date.parse("2026-07-01T00:00:00.000Z"));

      expect(
        database
          .prepare(
            "SELECT status, next_attempt_at_ms AS nextAttemptAtMs FROM openMeldDaemon_pre_head_failure_publication_outbox WHERE dispatch_id = ?"
          )
          .get("dispatch-old-pending")
      ).toEqual({
        nextAttemptAtMs: olderThanWakeEvidenceRetentionMs,
        status: "pending",
      });
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM openMeldDaemon_ops_decisions")
          .get()
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("fences claims and completion with a monotonically increasing state version", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      insertPendingPublication(database, {
        createdAtMs: 1000,
        dispatchId: "dispatch-cas",
      });

      const firstClaim = database
        .prepare(
          `
            UPDATE openMeldDaemon_pre_head_failure_publication_outbox
            SET claim_id = 'claim-1', claim_expires_at_ms = 2000, state_version = 1
            WHERE dispatch_id = 'dispatch-cas' AND status = 'pending' AND state_version = 0
          `
        )
        .run();
      const competingClaim = database
        .prepare(
          `
            UPDATE openMeldDaemon_pre_head_failure_publication_outbox
            SET claim_id = 'claim-2', claim_expires_at_ms = 2000, state_version = 1
            WHERE dispatch_id = 'dispatch-cas' AND status = 'pending' AND state_version = 0
          `
        )
        .run();
      expect(firstClaim.changes).toBe(1);
      expect(competingClaim.changes).toBe(0);

      const staleCompletion = database
        .prepare(
          `
            UPDATE openMeldDaemon_pre_head_failure_publication_outbox
            SET status = 'completed', claim_id = NULL, claim_expires_at_ms = NULL, completed_at_ms = 3000, state_version = 2
            WHERE dispatch_id = 'dispatch-cas' AND status = 'pending' AND state_version = 0 AND claim_id = 'claim-1'
          `
        )
        .run();
      const fencedCompletion = database
        .prepare(
          `
            UPDATE openMeldDaemon_pre_head_failure_publication_outbox
            SET status = 'completed', claim_id = NULL, claim_expires_at_ms = NULL, completed_at_ms = 3000, state_version = 2
            WHERE dispatch_id = 'dispatch-cas' AND status = 'pending' AND state_version = 1 AND claim_id = 'claim-1'
          `
        )
        .run();
      expect(staleCompletion.changes).toBe(0);
      expect(fencedCompletion.changes).toBe(1);
      expect(
        database
          .prepare(
            "SELECT status, state_version AS stateVersion FROM openMeldDaemon_pre_head_failure_publication_outbox WHERE dispatch_id = 'dispatch-cas'"
          )
          .get()
      ).toEqual({ stateVersion: 2, status: "completed" });
    } finally {
      database.close();
    }
  });
});
