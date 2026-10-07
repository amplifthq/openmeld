import { describe, expect, it, vi } from "vitest";
import { listRecentOpenMeldDaemonOpsDecisions } from "../src/dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const OR_FILTER_PATTERN = /\sOR\s/iu;
const CORRELATION_UNIQUE_INDEX_PATTERN =
  /(?:uq_openMeldDaemon_ops_decisions_correlation_code|idx_openMeldDaemon_ops_decisions_correlation_code_time)/;
const CORRELATION_TIME_INDEX_PATTERN =
  /idx_openMeldDaemon_ops_decisions_correlation_(?:code_)?time/;
const NULL_PARAMETER_FILTER_PATTERN = /\$\d+\s+IS\s+NULL/iu;

describe("dispatch ops decisions PostgreSQL query plan", () => {
  it.each([
    {
      name: "correlation and decision",
      input: {
        correlationId: "dispatch-1",
        decisionCode: "controller.binding.lookup_failed",
      },
      expectedIndex: CORRELATION_UNIQUE_INDEX_PATTERN,
    },
    {
      name: "correlation only",
      input: { correlationId: "dispatch-1" },
      expectedIndex: CORRELATION_TIME_INDEX_PATTERN,
    },
    {
      name: "decision only",
      input: { decisionCode: "controller.binding.lookup_failed" },
      expectedIndex: "idx_openMeldDaemon_ops_decisions_code_time",
    },
    {
      name: "latest decisions",
      input: {},
      expectedIndex: "idx_openMeldDaemon_ops_decisions_time",
    },
  ])("uses an indexed shape for $name", async (testCase) => {
    const harness = await createPostgresHarness();
    try {
      // A representative population lets PostgreSQL choose a real plan; a
      // two-row table legitimately favors a sequential scan.
      await harness.query(`INSERT INTO "openmeld"."openMeldDaemon_ops_decisions"
        (id, decision_code, decision_payload_json, decided_by, decided_at_ms, source, correlation_id)
        SELECT 'decision-' || n, CASE WHEN n % 100 = 1 THEN 'controller.binding.lookup_failed' ELSE 'other-' || (n % 100) END,
          '{}', 'core.dispatch_queue.preflight', n, 'dispatch_queue_consumer', 'dispatch-' || n
        FROM generate_series(1, 20000) AS fixture(n)`);
      await harness.query(`ANALYZE "openmeld"."openMeldDaemon_ops_decisions"`);
      const querySpy = vi.spyOn(harness.db, "query");
      await listRecentOpenMeldDaemonOpsDecisions({
        db: harness.db,
        limit: 10,
        ...testCase.input,
      });
      expect(querySpy).toHaveBeenCalledTimes(1);
      const query = querySpy.mock.calls[0]?.[0];
      querySpy.mockRestore();
      if (!query || typeof query === "string") {
        throw new Error("Native decision query was not captured");
      }
      expect(query.text).not.toMatch(NULL_PARAMETER_FILTER_PATTERN);
      expect(query.text).not.toMatch(OR_FILTER_PATTERN);
      const plan = await harness.queryAll({
        text: `EXPLAIN (FORMAT JSON) ${query.text}`,
        values: query.values,
      });
      const serializedPlan = JSON.stringify(plan);
      if (typeof testCase.expectedIndex === "string") {
        expect(serializedPlan).toContain(testCase.expectedIndex);
      } else {
        expect(serializedPlan).toMatch(testCase.expectedIndex);
      }
      expect(serializedPlan).not.toContain('"Node Type":"Sort"');
    } finally {
      await harness.close();
    }
  });
});
