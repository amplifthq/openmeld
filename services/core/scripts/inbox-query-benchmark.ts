import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { createInboxFeedService } from "../src/inbox/application/inbox-feed-service";
import { observeInboxNotifications } from "../src/inbox/application/inbox-notification-observations";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { createInboxFeedFixture } from "../tests-node/helpers/inbox-feed.test-support";

// Run with tsx. This uses disposable local workerd D1, never a remote binding.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const count = Number(process.argv[2] ?? 2000);
if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) {
  throw new Error("Item count must be between 1 and 100000");
}
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "benchmark",
    modules: true,
    script: "export default { fetch() { return new Response('benchmark'); } }",
    compatibilityDate: "2026-09-01",
    d1Databases: { DB: "inbox-benchmark" },
  })
);
const fixture = createInboxFeedFixture();
try {
  fixture.agent("agent");
  await fixture.item("seed", {
    sourceFacts: {
      version: 1,
      recipientReasons: ["agent_owner"],
      agentProfileIds: ["agent"],
      personalAgentProfileIds: ["agent"],
      mentionedAgentProfileIds: ["agent"],
      firstContactAgentProfileIds: ["agent"],
    },
  });
  const db: D1Database = await mf.getD1Database("DB");
  const schema = fixture.queryAll<{ name: string; type: string; sql: string }>({
    sql: "SELECT name, type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'index'",
  });
  for (const entry of schema) {
    await db.prepare(entry.sql).run();
    if (entry.type !== "table") {
      continue;
    }
    const rows = fixture.queryAll<Record<string, string | number | null>>({
      sql: `SELECT * FROM "${entry.name}"`,
    });
    for (const row of rows) {
      const keys = Object.keys(row);
      await db
        .prepare(
          `INSERT INTO "${entry.name}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`
        )
        .bind(...Object.values(row))
        .run();
    }
  }
  const columns = fixture
    .queryAll<{ name: string }>({ sql: "PRAGMA table_info(inbox_items)" })
    .map((row) => row.name);
  await db
    .prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO inbox_items (${columns.join(",")}) SELECT ${columns.map((column) => (column === "id" || column === "source_key" ? "'item-' || i" : column)).join(",")} FROM inbox_items, n WHERE source_key = 'seed'`)
    .bind(count)
    .run();
  const noise = Number(process.argv[4] ?? 0);
  if (!Number.isSafeInteger(noise) || noise < 0 || noise > 100_000) {
    throw new Error("Invalid unrelated item count");
  }
  if (noise) {
    await db
      .prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO inbox_items (${columns.join(",")}) SELECT ${columns
      .map((column) => {
        if (column === "id" || column === "source_key") {
          return "'noise-' || i";
        }
        if (column === "organization_id") {
          return "'other-org'";
        }
        if (column === "recipient_user_id") {
          return "'other'";
        }
        if (column === "source_facts_json") {
          return "NULL";
        }
        if (column === "source_target_json") {
          return `json_object('kind', 'space', 'spaceId', 'other-space', 'signalId', 'noise-' || i)`;
        }
        return column;
      })
      .join(",")} FROM inbox_items, n WHERE source_key = 'seed'`)
      .bind(noise)
      .run();
  }
  const samples: {
    operation: string;
    elapsedMs: number;
    meta: D1Meta;
    plan: unknown[];
    sql: string;
    values: unknown[];
  }[] = [];
  let operation = "";
  const delegates = new WeakMap<object, D1PreparedStatement>();
  const details = new WeakMap<object, { sql: string; values: unknown[] }>();
  const record = async (
    sql: string,
    values: unknown[],
    result: D1Result,
    elapsedMs: number
  ) => {
    const plan = await db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...values)
      .all();
    samples.push({
      operation,
      elapsedMs,
      meta: result.meta,
      plan: plan.results,
      sql,
      values,
    });
  };
  const wrap = (sql: string, values: unknown[] = []): D1PreparedStatement => {
    const delegate = db.prepare(sql).bind(...values);
    const all = async () => {
      const started = performance.now();
      const result = await delegate.all();
      await record(sql, values, result, performance.now() - started);
      return result;
    };
    const statement = {
      bind: (...next: unknown[]) => wrap(sql, next),
      all,
      first: async (column?: string) => {
        const row = (await all()).results[0];
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      run: async () => {
        const started = performance.now();
        const result = await delegate.run();
        await record(sql, values, result, performance.now() - started);
        return result;
      },
    } as D1PreparedStatement;
    delegates.set(statement, delegate);
    details.set(statement, { sql, values });
    return statement;
  };
  const measured = {
    prepare: wrap,
    batch: async (statements: D1PreparedStatement[]) => {
      const started = performance.now();
      const results = await db.batch(
        statements.map((statement) => {
          const delegate = delegates.get(statement);
          if (!delegate) {
            throw new Error("Unmeasured statement");
          }
          return delegate;
        })
      );
      const elapsed = performance.now() - started;
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const result = results[i];
        const detail = statement ? details.get(statement) : undefined;
        if (!(detail && result)) {
          throw new Error("Missing statement details");
        }
        await record(detail.sql, detail.values, result, elapsed);
      }
      return results;
    },
  } as D1Database;
  const summary = createInboxService({
    db: measured,
    includeAccountItems: true,
  });
  const feed = createInboxFeedService({ db: measured, nowMs: () => 11_000 });
  for (let iteration = 0; iteration < 3; iteration++) {
    operation = `summary-${iteration}`;
    await summary.summary({ ...fixture.identity, presentation: "attention" });
    operation = `feed-${iteration}`;
    await feed.list(fixture.identity);
    operation = `observation-${iteration}`;
    await observeInboxNotifications({ ...fixture.identity, db: measured });
  }
  const summaryQuery = samples.find(
    (sample) => sample.operation === "summary-0"
  );
  if (!summaryQuery) {
    throw new Error("Summary was not measured");
  }
  const queryVersions = [{ name: "current", query: summaryQuery }];
  if (process.argv[5]) {
    const baseline = JSON.parse(readFileSync(process.argv[5], "utf8"));
    queryVersions.push({
      name: "baseline-sql-current-schema",
      query: baseline.samples.find(
        (sample: { operation: string }) => sample.operation === "summary-0"
      ),
    });
  }
  const concurrency: {
    name: string;
    requests: number;
    elapsedMs: number;
    meta: D1Meta[];
  }[] = [];
  for (const { name, query } of queryVersions) {
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        db
          .prepare(query.sql)
          .bind(...query.values)
          .all()
      )
    );
    concurrency.push({
      name,
      requests: 4,
      elapsedMs: performance.now() - started,
      meta: results.map((result) => result.meta),
    });
  }
  const output = {
    runtime: "local Miniflare/workerd D1; not production capacity",
    count,
    unrelatedItems: noise,
    concurrency,
    samples,
  };
  if (process.argv[3]) {
    writeFileSync(process.argv[3], JSON.stringify(output, null, 2));
  }
  console.log(
    JSON.stringify({ count, queries: samples.length, output: process.argv[3] })
  );
} finally {
  fixture.close();
  await mf.dispose();
}
