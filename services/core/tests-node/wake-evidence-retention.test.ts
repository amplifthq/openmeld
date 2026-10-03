import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runWakeEvidenceRetention,
  sweepWakeEvidenceRetention,
} from "../src/dispatch/infrastructure/postgresql/wake-evidence-retention";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const nowMs = 40 * 24 * 60 * 60 * 1000;
let harness: Awaited<ReturnType<typeof createPostgresHarness>>;

beforeEach(async () => {
  harness = await createPostgresHarness();
});
afterEach(async () => {
  await harness.close();
});

describe("Wake evidence retention", () => {
  it("keeps old running evidence, recent settled evidence, and an unfinished dispatch without a head", async () => {
    await seedHead("running", "running", 1000);
    await seedHead("recent", "reply_published", nowMs - 1);
    await seedDispatch("running", "dispatching");
    await seedDispatch("recent", "succeeded");
    await seedDispatch("missing-head", "queued");
    for (const id of ["running", "recent", "missing-head"]) {
      await seedAttempt(id);
    }
    await seedEvent("running");
    await seedEvent("recent");
    await seedDecision("running", "running");
    await seedDecision("recent-execution", "recent");
    await seedDecision("missing-head", "missing-head");

    const result = await sweepWakeEvidenceRetention({ db: harness.db, nowMs });

    expect(result.every((table) => table.deleted === 0)).toBe(true);
    expect(await ids("openMeldDaemon_dispatch_ledger", "dispatch_id")).toEqual([
      "missing-head",
      "recent",
      "running",
    ]);
    expect(await ids("openMeldDaemon_dispatch_attempts", "attempt_id")).toEqual(
      ["missing-head", "recent", "running"]
    );
    expect(
      await ids(
        "openMeldDaemon_runtime_coordinator_executions",
        "runtime_coordinator_execution_id"
      )
    ).toEqual(["recent", "running"]);
    expect(
      await ids(
        "openMeldDaemon_runtime_coordinator_execution_events",
        "event_id"
      )
    ).toEqual(["recent", "running"]);
  });

  it("deletes old settled evidence in bounded batches and leaves unprocessed rows for the next sweep", async () => {
    for (const id of ["settled-a", "settled-b"]) {
      await seedHead(id, "failed_terminal", 1000);
      await seedDispatch(id, "failed_terminal");
      await seedAttempt(id);
      await seedEvent(id);
      await seedDecision(id, id);
    }
    await seedDecision("uncorrelated", null);
    const first = await sweepWakeEvidenceRetention({
      db: harness.db,
      nowMs,
      batchSize: 1,
      maxBatchesPerTable: 1,
    });
    expect(
      first.find((table) => table.table === "openMeldDaemon_dispatch_ledger")
        ?.deleted
    ).toBe(1);
    expect(await ids("openMeldDaemon_dispatch_ledger", "dispatch_id")).toEqual([
      "settled-b",
    ]);
    await sweepWakeEvidenceRetention({ db: harness.db, nowMs, batchSize: 1 });
    expect(await ids("openMeldDaemon_dispatch_ledger", "dispatch_id")).toEqual(
      []
    );
    expect(
      await ids(
        "openMeldDaemon_runtime_coordinator_executions",
        "runtime_coordinator_execution_id"
      )
    ).toEqual([]);
    expect(
      await ids(
        "openMeldDaemon_runtime_coordinator_execution_events",
        "event_id"
      )
    ).toEqual([]);
    expect(await ids("openMeldDaemon_ops_decisions", "id")).toEqual([]);
  });

  it("protects a recent dispatch update even when its execution head is old and settled", async () => {
    await seedHead("dispatch-updated", "reply_published", 1000);
    await seedDispatch("dispatch-updated", "succeeded", nowMs - 1);
    await seedEvent("dispatch-updated");
    await seedAttempt("dispatch-updated");
    expect(
      (await sweepWakeEvidenceRetention({ db: harness.db, nowMs })).every(
        (table) => table.deleted === 0
      )
    ).toBe(true);
  });

  it("fails closed without a runtime binding and rejects unsafe sweep bounds", async () => {
    await expect(
      runWakeEvidenceRetention({ env: {}, cron: "0 4 * * *", nowMs })
    ).rejects.toThrow();
    await expect(
      sweepWakeEvidenceRetention({ db: harness.db, nowMs, batchSize: 0 })
    ).rejects.toThrow("safe integer bounds");
  });
});

async function seedHead(id: string, status: string, updatedAtMs: number) {
  await harness.db.query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions"
    (runtime_coordinator_execution_id, model_version, space_id, dispatch_id, target_profile_id,
     openmeld_service_runtime_id_source, openmeld_service_runtime_id, binding_id, agent_controller_ref,
     status, created_at_ms, updated_at_ms)
    VALUES ($1, 'openmeld.runtime_coordinator.execution.v1', 'space', $1, 'agent', 'binding', 'runtime', 'binding', 'builtin:codex', $2, 1000, $3)`,
    values: [id, status, updatedAtMs],
  });
}
async function seedDispatch(
  id: string,
  status: string,
  lastAttemptAtMs = 1000
) {
  await harness.db.query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger"
    (idempotency_key, dispatch_id, space_id, source_event_id, target_profile_id, status, first_seen_at_ms, last_attempt_at_ms, attempt_count)
    VALUES ($1, $1, 'space', $1, 'agent', $2, 1000, $3, 1)`,
    values: [id, status, lastAttemptAtMs],
  });
}
async function seedAttempt(id: string) {
  await harness.db.query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_attempts"
    (attempt_id, dispatch_id, idempotency_key, attempt_no, status, created_at_ms)
    VALUES ($1, $1, $1, 1, 'waiting_result', 1000)`,
    values: [id],
  });
}
async function seedEvent(id: string) {
  await harness.db.query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"
    (event_id, runtime_coordinator_execution_id, event_type, observed_at_ms, idempotency_key, payload_json)
    VALUES ($1, $1, 'created', 1000, $1, '{}')`,
    values: [id],
  });
}
async function seedDecision(id: string, correlation: string | null) {
  await harness.db.query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_ops_decisions"
    (id, decision_code, decision_payload_json, decided_by, decided_at_ms, source, correlation_id)
    VALUES ($1, 'diagnostic', '{}', 'core', 1000, 'core', $2)`,
    values: [id, correlation],
  });
}
async function ids(table: string, key: string) {
  return (
    await harness.queryAll<{ id: string }>({
      text: `SELECT "${key}" AS id FROM "openmeld"."${table}" ORDER BY "${key}"`,
    })
  ).map((row) => row.id);
}
