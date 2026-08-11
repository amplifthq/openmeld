import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runWakeEvidenceRetentionIfSplitActive,
  sweepWakeEvidenceRetention,
} from "../dispatch/infrastructure/d1/wake-evidence-retention";
import type { CoreBindings } from "../lib/bindings";

function createRecordingDb(changesPerCall: number[] = []) {
  const calls: { binds: unknown[]; sql: string }[] = [];
  let index = 0;
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({
        run: () => {
          calls.push({ binds, sql });
          const changes = changesPerCall[index] ?? 0;
          index += 1;
          return Promise.resolve({ meta: { changes } });
        },
      }),
    }),
  } as unknown as D1Database;
  return { calls, db };
}

const NOW_MS = Date.parse("2026-06-14T00:00:00.000Z");
const DELETE_FROM_OPENMELD_DAEMON_REGEX = /DELETE FROM openMeldDaemon_/u;
const DELETE_FROM_TABLE_REGEX = /DELETE FROM (\w+)/u;

describe("sweepWakeEvidenceRetention", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("deletes from all 9 wake-evidence tables using a 30-day cutoff", async () => {
    const { calls, db } = createRecordingDb();

    const results = await sweepWakeEvidenceRetention({
      db,
      nowMs: NOW_MS,
      retentionMs: 1000,
    });

    expect(results).toHaveLength(9);
    expect(calls).toHaveLength(9); // each returns 0 (< batch) → one DELETE/table
    for (const call of calls) {
      expect(call.binds[0]).toBe(NOW_MS - 1000); // cutoffMs
      expect(call.sql).toMatch(DELETE_FROM_OPENMELD_DAEMON_REGEX);
    }
    const tables = calls.map((c) => c.sql.match(DELETE_FROM_TABLE_REGEX)?.[1]);
    expect(tables).toContain("openMeldDaemon_ops_decisions");
    expect(tables).toContain("openMeldDaemon_dispatch_ledger");
    expect(tables).not.toContain(
      "openMeldDaemon_pre_head_failure_publication_outbox"
    );
  });

  it("batches deletes per table until a short batch is returned", async () => {
    // changesPerCall is global across calls: first call returns a full batch (2)
    // so table 0 loops, second call returns 0 so it stops (2 calls); the other 8
    // tables each get one call returning 0.
    const { calls, db } = createRecordingDb([2, 0]);

    const results = await sweepWakeEvidenceRetention({
      db,
      nowMs: NOW_MS,
      batchSize: 2,
      maxBatchesPerTable: 5,
    });

    expect(results.at(0)?.deleted).toBe(2);
    expect(calls).toHaveLength(10); // table 0: 2 calls, tables 1-8: 1 each
  });
});

describe("runWakeEvidenceRetentionIfSplitActive (split-active safety guard)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("does NOT touch the DB when OPENMELD_SPLIT_ACTIVE is unset (cannot run on aliased openmeld-db)", async () => {
    const { calls, db } = createRecordingDb();

    const result = await runWakeEvidenceRetentionIfSplitActive({
      // Bindings present and aliased to openmeld-db (pre-cutover) — must still skip.
      env: {
        OPENMELD_DB: db,
        OPENMELD_WAKE_EVIDENCE_DB: db,
      } as unknown as CoreBindings,
      cron: "0 3 * * *",
      nowMs: NOW_MS,
    });

    expect(result.ran).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("does not run for any non-true flag value", async () => {
    const { calls, db } = createRecordingDb();

    const result = await runWakeEvidenceRetentionIfSplitActive({
      env: {
        OPENMELD_SPLIT_ACTIVE: "false",
        OPENMELD_WAKE_EVIDENCE_DB: db,
      } as unknown as CoreBindings,
      cron: null,
      nowMs: NOW_MS,
    });

    expect(result.ran).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("runs the sweep only when OPENMELD_SPLIT_ACTIVE === 'true'", async () => {
    const { calls, db } = createRecordingDb();

    const result = await runWakeEvidenceRetentionIfSplitActive({
      env: {
        OPENMELD_SPLIT_ACTIVE: "true",
        OPENMELD_WAKE_EVIDENCE_DB: db,
      } as unknown as CoreBindings,
      cron: "0 3 * * *",
      nowMs: NOW_MS,
    });

    expect(result.ran).toBe(true);
    expect(calls).toHaveLength(9); // all wake-evidence tables swept
  });

  it("fails closed when split-active but the wake-evidence binding is absent (no ?? OPENMELD_DB fallback)", async () => {
    const { calls, db } = createRecordingDb();

    // Flag armed, but OPENMELD_WAKE_EVIDENCE_DB missing and only OPENMELD_DB present: the
    // pick omits OPENMELD_DB and the read is direct, so this must NOT delete from the
    // old openmeld-db — it fails closed.
    const result = await runWakeEvidenceRetentionIfSplitActive({
      env: {
        OPENMELD_SPLIT_ACTIVE: "true",
        OPENMELD_DB: db,
      } as unknown as CoreBindings,
      cron: "0 3 * * *",
      nowMs: NOW_MS,
    });

    expect(result.ran).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
