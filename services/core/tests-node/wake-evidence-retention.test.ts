import { describe, expect, it } from "vitest";
import {
  runWakeEvidenceRetention,
  sweepWakeEvidenceRetention,
  WAKE_EVIDENCE_RETENTION_MS,
} from "../src/dispatch/infrastructure/d1/wake-evidence-retention";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const nowMs = WAKE_EVIDENCE_RETENTION_MS * 3;
const old = 1000;

function fixture() {
  const f = createSqliteD1Harness();
  applyDrizzleMigrationsForTables(f, [
    "openMeldDaemon_runtime_coordinator_executions",
    "openMeldDaemon_runtime_coordinator_execution_events",
    "openMeldDaemon_runtime_coordinator_creation_diagnostics",
    "openMeldDaemon_dispatch_result_inbox",
  ]);
  const execution = (id: string, status = "reply_published", updated = old) => {
    f.run({
      sql: `INSERT INTO openMeldDaemon_runtime_coordinator_executions
      (runtime_coordinator_execution_id, model_version, space_id, dispatch_id, target_profile_id,
       openmeld_service_runtime_id_source, openmeld_service_runtime_id, binding_id, agent_controller_ref,
       status, created_at_ms, updated_at_ms) VALUES (?, 'v1', 'space', ?, 'agent', 'runtime', 'runtime', 'binding', 'codex', ?, ?, ?)`,
      params: [id, id, status, old, updated],
    });
  };
  const result = (id: string, executionId: string, state = "reply_published") =>
    f.run({
      sql: `INSERT INTO openMeldDaemon_dispatch_result_inbox
      (result_key, dispatch_id, attempt_id, task_id, target_profile_id, daemon_session_id, lease_epoch,
       submitted_connection_generation, runtime_coordinator_execution_id, result_payload_json, accepted_at_ms, publish_state, updated_at_ms)
      VALUES (?, ?, 'attempt', 'task', 'agent', 'session', 1, 1, ?, '{}', ?, ?, ?)`,
      params: [id, executionId, executionId, old, state, old],
    });
  const event = (
    id: string,
    executionId: string,
    type = "lifecycle_running",
    observed = old
  ) =>
    f.run({
      sql: `INSERT INTO openMeldDaemon_runtime_coordinator_execution_events
      (event_id, runtime_coordinator_execution_id, event_type, observed_at_ms, idempotency_key, payload_json)
      VALUES (?, ?, ?, ?, ?, '{}')`,
      params: [id, executionId, type, observed, id],
    });
  return { ...f, execution, result, event };
}

describe("Wake evidence retention", () => {
  it("continues bounded deletion while preserving current work, recovery and stop/replay fences", async () => {
    const f = fixture();
    try {
      for (const [id, status, updated] of [
        ["done", "reply_published", old],
        ["running", "running", old],
        ["failed", "failed_terminal", old],
        ["recent", "reply_published", nowMs],
        ["recover", "reply_published", old],
        ["no-result", "reply_published", old],
      ] as const) {
        f.execution(id, status, updated);
        if (id !== "no-result") {
          f.result(id, id);
        }
        f.event(id, id);
      }
      f.result("late", "recover", "late_result_available");
      f.event("orphan", "missing");
      f.event("stop", "done", "cancellation_requested");
      f.event("token", "done", "execution_token_revoked");
      f.event("new-type", "done", "future_event");
      f.event("fresh", "done", "lifecycle_running", nowMs);
      f.event("done-2", "done");
      f.event("done-3", "done");
      const input = { db: f.db, nowMs, batchSize: 2, maxBatchesPerTable: 1 };
      expect((await sweepWakeEvidenceRetention(input))[0]).toMatchObject({
        deleted: 2,
        budgetExhausted: true,
      });
      expect((await sweepWakeEvidenceRetention(input))[0]).toMatchObject({
        deleted: 1,
        budgetExhausted: false,
      });
      expect((await sweepWakeEvidenceRetention(input))[0]?.deleted).toBe(0);
      expect(
        f
          .queryAll<{ event_id: string }>({
            sql: "SELECT event_id FROM openMeldDaemon_runtime_coordinator_execution_events ORDER BY event_id",
          })
          .map((row) => row.event_id)
      ).toEqual([
        "failed",
        "fresh",
        "new-type",
        "no-result",
        "orphan",
        "recent",
        "recover",
        "running",
        "stop",
        "token",
      ]);
      expect(
        f.queryFirst({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_dispatch_result_inbox",
        })
      ).toEqual({ count: 6 });
      expect(
        f.queryFirst({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_runtime_coordinator_executions",
        })
      ).toEqual({ count: 6 });
      // Replayed results retain their canonical fence after diagnostic cleanup.
      expect(() => f.result("done", "done")).toThrow();
      f.run({
        sql: "UPDATE openMeldDaemon_dispatch_result_inbox SET publish_state = 'reply_published' WHERE result_key = 'late'",
      });
      expect((await sweepWakeEvidenceRetention(input))[0]?.deleted).toBe(1);
    } finally {
      f.close();
    }
  });

  it("runs against the current single database and expires only old creation diagnostics", async () => {
    const f = fixture();
    try {
      for (const [id, observed] of [
        ["old", old],
        ["fresh", nowMs],
      ] as const) {
        f.run({
          sql: `INSERT INTO openMeldDaemon_runtime_coordinator_creation_diagnostics
          (diagnostic_id, model_version, space_id, dispatch_id, target_profile_id, creation_status, reason_code, observed_at_ms)
          VALUES (?, 'v1', 'space', 'dispatch', 'agent', 'rejected', 'reason', ?)`,
          params: [id, observed],
        });
      }
      const result = await runWakeEvidenceRetention({
        env: { OPENMELD_DB: f.db },
        nowMs,
        cron: "test",
      });
      expect(result.ran).toBe(true);
      expect(result.results[1]?.deleted).toBe(1);
      expect(
        f.queryFirst({
          sql: "SELECT diagnostic_id FROM openMeldDaemon_runtime_coordinator_creation_diagnostics",
        })
      ).toEqual({ diagnostic_id: "fresh" });
      await expect(
        runWakeEvidenceRetention({ env: {}, nowMs, cron: "test" })
      ).rejects.toThrow("unavailable");
    } finally {
      f.close();
    }
  });
});
