import { afterEach, describe, expect, it } from "vitest";
import {
  listRecentOpenMeldDaemonOpsDecisions,
  writeOpenMeldDaemonOpsDecision,
} from "../src/dispatch/infrastructure/d1/dispatch-ledger-d1";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

type SqliteBindValue = number | string | null;

type CapturedQuery = {
  params: readonly SqliteBindValue[];
  sql: string;
};

const OPTIONAL_FILTER_PATTERN = /\?\s+IS\s+NULL/iu;
const SQL_OR_PATTERN = /\sOR\s/iu;

const harnesses: ReturnType<typeof createSqliteD1Harness>[] = [];

describe("dispatch ops decisions query plan", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
  });

  it.each([
    {
      name: "correlation and decision",
      input: {
        correlationId: "dispatch-1",
        decisionCode: "controller.binding.lookup_failed",
      },
      // The D4 latest-per-code unique index is an exact-equality match for
      // this shape, so SQLite now prefers it over the wider composite index.
      expectedIndex: "uq_openMeldDaemon_ops_decisions_correlation_code",
    },
    {
      name: "correlation only",
      input: {
        correlationId: "dispatch-1",
      },
      expectedIndex: "idx_openMeldDaemon_ops_decisions_correlation_time",
    },
    {
      name: "decision only",
      input: {
        decisionCode: "controller.binding.lookup_failed",
      },
      expectedIndex: "idx_openMeldDaemon_ops_decisions_code_time",
    },
    {
      name: "latest decisions",
      input: {},
      expectedIndex: "idx_openMeldDaemon_ops_decisions_time",
    },
  ])("uses an indexed shape for $name", async (testCase) => {
    const harness = createMigratedHarness();
    await seedOpsDecisions(harness.db);
    const capturedQueries: CapturedQuery[] = [];

    await listRecentOpenMeldDaemonOpsDecisions({
      db: createCapturingD1Database(harness.db, capturedQueries),
      limit: 10,
      ...testCase.input,
    });

    expect(capturedQueries).toHaveLength(1);
    const capturedQuery = capturedQueries[0];
    expect(capturedQuery?.sql).not.toMatch(OPTIONAL_FILTER_PATTERN);
    expect(capturedQuery?.sql).not.toMatch(SQL_OR_PATTERN);

    const plan = explainQueryPlan(harness, capturedQuery);
    expect(plan).toContain(testCase.expectedIndex);
    expect(plan).not.toContain("USE TEMP B-TREE");
  });
});

function createMigratedHarness(): ReturnType<typeof createSqliteD1Harness> {
  const harness = createSqliteD1Harness();
  harnesses.push(harness);
  applyDrizzleMigrationForTable(harness, "openMeldDaemon_ops_decisions");
  return harness;
}

async function seedOpsDecisions(db: D1Database): Promise<void> {
  await writeOpenMeldDaemonOpsDecision({
    db,
    decisionCode: "controller.binding.lookup_failed",
    decisionPayload: { dispatchId: "dispatch-1" },
    decidedBy: "core.dispatch_queue.preflight",
    decidedAtMs: 3000,
    source: "dispatch_queue_consumer",
    correlationId: "dispatch-1",
  });
  await writeOpenMeldDaemonOpsDecision({
    db,
    decisionCode: "dispatch.window.risk",
    decisionPayload: { dispatchId: "dispatch-2" },
    decidedBy: "core.dispatch_queue.risk",
    decidedAtMs: 2000,
    source: "dispatch_queue_consumer",
    correlationId: "dispatch-2",
  });
}

function createCapturingD1Database(
  db: D1Database,
  capturedQueries: CapturedQuery[]
): D1Database {
  return {
    ...db,
    prepare: (sql: string) => {
      const statement = db.prepare(sql);
      return {
        bind: (...params: unknown[]) => {
          capturedQueries.push({
            params: params.map(toSqliteBindValue),
            sql,
          });
          return statement.bind(...params);
        },
        first: statement.first.bind(statement),
        all: statement.all.bind(statement),
        run: statement.run.bind(statement),
      } as D1PreparedStatement;
    },
  } as D1Database;
}

function explainQueryPlan(
  harness: ReturnType<typeof createSqliteD1Harness>,
  query: CapturedQuery | undefined
): string {
  if (!query) {
    throw new Error("ops decision query was not captured");
  }
  const rows = harness.queryAll<{ detail: string }>({
    sql: `EXPLAIN QUERY PLAN ${query.sql}`,
    params: query.params,
  });
  return rows.map((row) => row.detail).join("\n");
}

function toSqliteBindValue(value: unknown): SqliteBindValue {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  throw new Error(`Unsupported SQLite bind value: ${String(value)}`);
}
