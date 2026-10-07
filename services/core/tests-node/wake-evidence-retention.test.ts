import { describe, expect, it } from "vitest";
import {
  runWakeEvidenceRetention,
  sweepWakeEvidenceRetention,
  WAKE_EVIDENCE_RETENTION_MS,
} from "../src/dispatch/infrastructure/postgresql/wake-evidence-retention";
import {
  createBeforeMatchingPostgresTransaction,
  createPostgresHarness,
} from "./helpers/postgresql-harness.test-support";

const nowMs = WAKE_EVIDENCE_RETENTION_MS * 3;
const old = 1000;

async function fixture() {
  const f = await createPostgresHarness();
  const execution = (id: string, status = "reply_published", updated = old) => {
    return f.query({
      text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions"
      (runtime_coordinator_execution_id, model_version, space_id, dispatch_id, target_profile_id,
       openmeld_service_runtime_id_source, openmeld_service_runtime_id, binding_id, agent_controller_ref,
       status, created_at_ms, updated_at_ms) VALUES ($1, 'v1', 'space', $2, 'agent', 'runtime', 'runtime', 'binding', 'codex', $3, $4, $5)`,
      values: [id, id, status, old, updated],
    });
  };
  const result = (id: string, executionId: string, state = "reply_published") =>
    f.query({
      text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_result_inbox"
      (result_key, dispatch_id, attempt_id, task_id, target_profile_id, daemon_session_id, lease_epoch,
       submitted_connection_generation, runtime_coordinator_execution_id, result_payload_json, accepted_at_ms, publish_state, updated_at_ms)
      VALUES ($1, $2, 'attempt', 'task', 'agent', 'session', 1, 1, $3, '{}', $4, $5, $6)`,
      values: [id, executionId, executionId, old, state, old],
    });
  const event = (
    id: string,
    executionId: string,
    type = "lifecycle_running",
    observed = old
  ) =>
    f.query({
      text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"
      (event_id, runtime_coordinator_execution_id, event_type, observed_at_ms, idempotency_key, payload_json)
      VALUES ($1, $2, $3, $4, $5, '{}')`,
      values: [id, executionId, type, observed, id],
    });
  return { ...f, execution, result, event };
}

describe("Wake evidence retention", () => {
  it("continues bounded deletion while preserving current work, recovery and stop/replay fences", async () => {
    const f = await fixture();
    try {
      for (const [id, status, updated] of [
        ["done", "reply_published", old],
        ["running", "running", old],
        ["failed", "failed_terminal", old],
        ["recent", "reply_published", nowMs],
        ["recover", "reply_published", old],
        ["no-result", "reply_published", old],
      ] as const) {
        await f.execution(id, status, updated);
        if (id !== "no-result") {
          await f.result(id, id);
        }
        await f.event(id, id);
      }
      await f.result("late", "recover", "late_result_available");
      await f.event("orphan", "missing");
      await f.event("stop", "done", "cancellation_requested");
      await f.event("token", "done", "execution_token_revoked");
      await f.event("new-type", "done", "future_event");
      await f.event("fresh", "done", "lifecycle_running", nowMs);
      await f.event("done-2", "done");
      await f.event("done-3", "done");
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
        (
          await f.queryAll<{ event_id: string }>({
            text: `SELECT event_id FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" ORDER BY event_id`,
          })
        ).map((row) => row.event_id)
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
        await f.queryFirst({
          text: `SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_dispatch_result_inbox"`,
        })
      ).toEqual({ count: 6 });
      expect(
        await f.queryFirst({
          text: `SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions"`,
        })
      ).toEqual({ count: 6 });
      // Replayed results retain their canonical fence after diagnostic cleanup.
      await expect(f.result("done", "done")).rejects.toThrow();
      await f.query({
        text: `UPDATE "openmeld"."openMeldDaemon_dispatch_result_inbox" SET publish_state = 'reply_published' WHERE result_key = 'late'`,
      });
      expect((await sweepWakeEvidenceRetention(input))[0]?.deleted).toBe(1);
    } finally {
      await f.close();
    }
  });

  it("runs against the current single database and expires only old creation diagnostics", async () => {
    const f = await fixture();
    try {
      for (const [id, observed] of [
        ["old", old],
        ["fresh", nowMs],
      ] as const) {
        await f.query({
          text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_creation_diagnostics"
          (diagnostic_id, model_version, space_id, dispatch_id, target_profile_id, creation_status, reason_code, observed_at_ms)
          VALUES ($1, 'v1', 'space', 'dispatch', 'agent', 'rejected', 'reason', $2)`,
          values: [id, observed],
        });
      }
      const result = await runWakeEvidenceRetention({
        env: { OPENMELD_POSTGRESQL: f.binding },
        nowMs,
        cron: "test",
      });
      expect(result.ran).toBe(true);
      expect(result.results[1]?.deleted).toBe(1);
      expect(
        await f.queryFirst({
          text: `SELECT diagnostic_id FROM "openmeld"."openMeldDaemon_runtime_coordinator_creation_diagnostics"`,
        })
      ).toEqual({ diagnostic_id: "fresh" });
      await expect(
        runWakeEvidenceRetention({ env: {}, nowMs, cron: "test" })
      ).rejects.toThrow("Hyperdrive binding is required");
    } finally {
      await f.close();
    }
  });
  it("rechecks result recovery eligibility when the deletion starts and preserves recent receipts", async () => {
    const f = await fixture();
    try {
      await f.execution("done");
      await f.result("done", "done");
      await f.event("done", "done");
      const db = createBeforeMatchingPostgresTransaction({
        db: f.db,
        matches: (sql) =>
          sql.includes(
            'DELETE FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"'
          ),
        beforeTransaction: () =>
          f
            .query(`UPDATE "openmeld"."openMeldDaemon_dispatch_result_inbox"
          SET publish_state='late_result_available' WHERE result_key='done'`)
            .then(() => undefined),
      });
      expect(
        (await sweepWakeEvidenceRetention({ db, nowMs }))[0]?.deleted
      ).toBe(0);
      await f.query({
        text: `UPDATE "openmeld"."openMeldDaemon_dispatch_result_inbox"
        SET publish_state='reply_published', updated_at_ms=$1 WHERE result_key='done'`,
        values: [nowMs],
      });
      expect(
        (await sweepWakeEvidenceRetention({ db: f.db, nowMs }))[0]?.deleted
      ).toBe(0);
      await f.query({
        text: `UPDATE "openmeld"."openMeldDaemon_dispatch_result_inbox"
        SET updated_at_ms=$1 WHERE result_key='done'`,
        values: [old],
      });
      expect(
        (await sweepWakeEvidenceRetention({ db: f.db, nowMs }))[0]?.deleted
      ).toBe(1);
      for (const budget of [0, -1, 1.5]) {
        await expect(
          sweepWakeEvidenceRetention({
            db: f.db,
            nowMs,
            maxBatchesPerTable: budget,
          })
        ).rejects.toThrow("positive integer");
      }
    } finally {
      await f.close();
    }
  });
});
