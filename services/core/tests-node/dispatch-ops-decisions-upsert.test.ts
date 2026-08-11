import { afterEach, describe, expect, it } from "vitest";
import { writeOpenMeldDaemonOpsDecision } from "../src/dispatch/infrastructure/d1/dispatch-ledger-d1";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

// Deterministic proof of the D4 ops-decisions upsert contract
// (physical-db-split.md): per (correlation_id, decision_code) keep the latest
// row; uncorrelated decisions always append. Runs against real SQLite with the
// real migration 0054 (unique index uq_openMeldDaemon_ops_decisions_correlation_code)
// applied via applyDrizzleMigrationForTable. This is the behavior the deployed
// production write path relies on, so the test asserts it cannot regress into a
// throw (which would propagate into the un-caught dispatch call sites) or into
// silent duplicate rows.

type OpsDecisionRow = {
  id: string;
  decision_code: string;
  decision_payload_json: string;
  decided_at_ms: number;
  correlation_id: string | null;
};

const harnesses: ReturnType<typeof createSqliteD1Harness>[] = [];

function createMigratedHarness(): ReturnType<typeof createSqliteD1Harness> {
  const harness = createSqliteD1Harness();
  harnesses.push(harness);
  applyDrizzleMigrationForTable(harness, "openMeldDaemon_ops_decisions");
  return harness;
}

function readRows(
  harness: ReturnType<typeof createSqliteD1Harness>,
  correlationId: string | null
): OpsDecisionRow[] {
  if (correlationId === null) {
    return harness.queryAll<OpsDecisionRow>({
      sql: "SELECT id, decision_code, decision_payload_json, decided_at_ms, correlation_id FROM openMeldDaemon_ops_decisions WHERE correlation_id IS NULL ORDER BY decided_at_ms, id",
    });
  }
  return harness.queryAll<OpsDecisionRow>({
    params: [correlationId],
    sql: "SELECT id, decision_code, decision_payload_json, decided_at_ms, correlation_id FROM openMeldDaemon_ops_decisions WHERE correlation_id = ? ORDER BY decision_code, decided_at_ms",
  });
}

function firstRowOf(rows: OpsDecisionRow[]): OpsDecisionRow {
  const [row] = rows;
  if (!row) {
    throw new Error("expected at least one ops decision row");
  }
  return row;
}

function write(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    decisionCode: string;
    decidedAtMs: number;
    correlationId: string | null;
    payload: unknown;
  }
): Promise<void> {
  return writeOpenMeldDaemonOpsDecision({
    db: harness.db,
    decisionCode: input.decisionCode,
    decisionPayload: input.payload,
    decidedBy: "test",
    decidedAtMs: input.decidedAtMs,
    source: "test",
    correlationId: input.correlationId,
  });
}

describe("openMeldDaemon_ops_decisions upsert contract (D4)", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
  });

  it("inserts a new (correlation_id, decision_code) row", async () => {
    const harness = createMigratedHarness();
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 1000,
      decisionCode: "dispatch.streaming.telemetry",
      payload: { step: 1 },
    });
    const rows = readRows(harness, "dispatch-1");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(firstRowOf(rows).decision_payload_json)).toEqual({
      step: 1,
    });
  });

  it("keeps exactly one row and the newer payload when the same key is rewritten with a newer timestamp", async () => {
    const harness = createMigratedHarness();
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 1000,
      decisionCode: "dispatch.streaming.telemetry",
      payload: { step: 1 },
    });
    const firstId = firstRowOf(readRows(harness, "dispatch-1")).id;
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 2000,
      decisionCode: "dispatch.streaming.telemetry",
      payload: { step: 2 },
    });
    const rows = readRows(harness, "dispatch-1");
    expect(rows).toHaveLength(1);
    expect(firstRowOf(rows).decided_at_ms).toBe(2000);
    expect(JSON.parse(firstRowOf(rows).decision_payload_json)).toEqual({
      step: 2,
    });
    // On conflict the original row id is retained, not the freshly minted one.
    expect(firstRowOf(rows).id).toBe(firstId);
  });

  it("does NOT throw and keeps the newer row when a stale (older) write arrives late", async () => {
    const harness = createMigratedHarness();
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 2000,
      decisionCode: "dispatch.runtime.telemetry",
      payload: { latest: true },
    });
    // Late-arriving older write: the ON CONFLICT WHERE guard makes this a
    // silent no-op. It must not throw (callers do not .catch on the hot path).
    await expect(
      write(harness, {
        correlationId: "dispatch-1",
        decidedAtMs: 500,
        decisionCode: "dispatch.runtime.telemetry",
        payload: { latest: false },
      })
    ).resolves.toBeUndefined();
    const rows = readRows(harness, "dispatch-1");
    expect(rows).toHaveLength(1);
    expect(firstRowOf(rows).decided_at_ms).toBe(2000);
    expect(JSON.parse(firstRowOf(rows).decision_payload_json)).toEqual({
      latest: true,
    });
  });

  it("updates in place when the rewrite has an equal timestamp (>= guard)", async () => {
    const harness = createMigratedHarness();
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 1000,
      decisionCode: "dispatch.execution.lifecycle",
      payload: { phase: "started" },
    });
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 1000,
      decisionCode: "dispatch.execution.lifecycle",
      payload: { phase: "finished" },
    });
    const rows = readRows(harness, "dispatch-1");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(firstRowOf(rows).decision_payload_json)).toEqual({
      phase: "finished",
    });
  });

  it("appends (never updates) when correlation_id is null, since NULLs are distinct in the unique index", async () => {
    const harness = createMigratedHarness();
    await write(harness, {
      correlationId: null,
      decidedAtMs: 1000,
      decisionCode: "dispatch.ops.unknown",
      payload: { n: 1 },
    });
    await write(harness, {
      correlationId: null,
      decidedAtMs: 2000,
      decisionCode: "dispatch.ops.unknown",
      payload: { n: 2 },
    });
    const rows = readRows(harness, null);
    expect(rows).toHaveLength(2);
  });

  it("keeps distinct decision codes for the same correlation_id side by side", async () => {
    const harness = createMigratedHarness();
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 1000,
      decisionCode: "dispatch.streaming.telemetry",
      payload: {},
    });
    await write(harness, {
      correlationId: "dispatch-1",
      decidedAtMs: 1000,
      decisionCode: "dispatch.runtime.telemetry",
      payload: {},
    });
    const rows = readRows(harness, "dispatch-1");
    expect(rows.map((row) => row.decision_code)).toEqual([
      "dispatch.runtime.telemetry",
      "dispatch.streaming.telemetry",
    ]);
  });

  it("never produces duplicate rows under repeated rewrites of the same key (real telemetry pattern)", async () => {
    const harness = createMigratedHarness();
    for (let i = 0; i < 50; i += 1) {
      await write(harness, {
        correlationId: "dispatch-hot",
        decidedAtMs: 1000 + i,
        decisionCode: "dispatch.streaming.telemetry",
        payload: { tick: i },
      });
    }
    const rows = readRows(harness, "dispatch-hot");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(firstRowOf(rows).decision_payload_json)).toEqual({
      tick: 49,
    });
  });
});
