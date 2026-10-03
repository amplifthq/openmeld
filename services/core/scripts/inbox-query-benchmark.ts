import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  type PoolClient,
  PostgresDatabase,
  type QueryConfig,
  type QueryResult,
  type QueryResultRow,
} from "@openmeld/db/postgresql";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";
import { createInboxFeedService } from "../src/inbox/application/inbox-feed-service";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import { observeInboxNotifications } from "../src/inbox/application/inbox-notification-observations";
import { createInboxService } from "../src/inbox/application/inbox-service";

const count = Number(process.argv[2] ?? 2000);
const noise = Number(process.argv[4] ?? 0);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  count > 100_000 ||
  !Number.isSafeInteger(noise) ||
  noise < 0 ||
  noise > 100_000
) {
  throw new Error(
    "Item counts must be safe integers between 0 and 100000; recipient count must be positive."
  );
}
const fixture = await createPostgresHarness();
const identity = { organizationId: "org", recipientUserId: "owner" };
const samples: {
  operation: string;
  elapsedMs: number;
  rowCount: number | null;
  sql: string;
  values: unknown[];
  plan?: unknown[];
}[] = [];
let operation = "";
class MeasuredPostgresDatabase extends PostgresDatabase {
  override async query<Row extends QueryResultRow = QueryResultRow>(
    query: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<Row>> {
    const config = typeof query === "string" ? { text: query, values } : query;
    const started = performance.now();
    const result = await super.query<Row>(query, values);
    samples.push({
      operation,
      elapsedMs: performance.now() - started,
      rowCount: result.rowCount,
      sql: config.text,
      values: config.values ?? [],
    });
    return result;
  }
  override transaction<Result>(
    callback: (client: PoolClient) => Promise<Result>
  ): Promise<Result> {
    return super.transaction((client) =>
      callback(
        new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return async (
                query: string | QueryConfig,
                values?: unknown[]
              ) => {
                const config =
                  typeof query === "string" ? { text: query, values } : query;
                const started = performance.now();
                const result = await target.query(query, values);
                samples.push({
                  operation,
                  elapsedMs: performance.now() - started,
                  rowCount: result.rowCount,
                  sql: config.text,
                  values: config.values ?? [],
                });
                return result;
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        })
      )
    );
  }
}
try {
  await fixture.query(`INSERT INTO "openmeld"."organizations" (id,name,slug,created_at)
    VALUES ('org','Design','design',0),('other-org','Other','other',0);
    INSERT INTO "openmeld"."users" (id,name,email)
    VALUES ('owner','Owner','owner@example.test'),('other','Other','other@example.test');
    INSERT INTO "openmeld"."openmeld_profiles"
    (profile_id,profile_name,profile_handle,source,profile_kind,organization_id,owner_user_id)
    VALUES ('agent','Agent','agent','web_create','agent','org','owner');
    INSERT INTO "openmeld"."space_index_spaces"
    (space_id,organization_id,organization_visibility,status,source_updated_at_ms,projected_at_ms,projection_event_id)
    VALUES ('space','org','private','active',0,0,'space'),('other-space','other-org','private','active',0,0,'other-space');
    INSERT INTO "openmeld"."space_index_memberships"
    (space_id,profile_id,profile_kind_snapshot,profile_name_snapshot,owner_user_id_snapshot,status,member_source,added_at_ms,source_updated_at_ms,projected_at_ms,projection_event_id)
    VALUES ('space','owner-space','human','Owner','owner','active','joined_directly',0,0,0,'owner'),
      ('space','agent','agent','Agent','owner','active','joined_directly',0,0,0,'agent');`);
  await ensureInboxItem({
    db: fixture.db,
    nowMs: 10_000,
    candidate: {
      ...identity,
      attention: "update",
      importance: "normal",
      kind: "space_message",
      contextLabel: "Design",
      title: "seed",
      preview: "A source-owned update.",
      occurredAtMs: 1000,
      sourceKind: "space_signal",
      sourceKey: "seed",
      sourceTarget: { kind: "space", spaceId: "space", signalId: "seed" },
      sourceFacts: {
        version: 1,
        recipientReasons: ["agent_owner"],
        agentProfileIds: ["agent"],
        personalAgentProfileIds: ["agent"],
        mentionedAgentProfileIds: ["agent"],
        firstContactAgentProfileIds: ["agent"],
      },
    },
  });
  const columns = (
    await fixture.query<{ column_name: string }>({
      text: `SELECT column_name FROM information_schema.columns WHERE table_schema='openmeld'
      AND table_name='inbox_items' AND is_identity='NO' ORDER BY ordinal_position`,
    })
  ).rows.map((row) => row.column_name);
  for (const [size, unrelated] of [
    [count, false],
    [noise, true],
  ] as const) {
    if (!size) {
      continue;
    }
    const expressions = columns.map((column) => {
      if (column === "id" || column === "source_key") {
        return `($2::text || '-' || i)`;
      }
      if (unrelated && column === "organization_id") {
        return "'other-org'";
      }
      if (unrelated && column === "recipient_user_id") {
        return "'other'";
      }
      if (unrelated && column === "source_facts_json") {
        return "NULL";
      }
      if (unrelated && column === "source_target_json") {
        return `jsonb_build_object('kind','space','spaceId','other-space','signalId','noise-' || i)::text`;
      }
      return `seed."${column}"`;
    });
    await fixture.query({
      text: `INSERT INTO "openmeld"."inbox_items" (${columns.map((c) => `"${c}"`).join(",")})
      SELECT ${expressions.join(",")} FROM "openmeld"."inbox_items" AS seed
      CROSS JOIN generate_series(1,$1::integer) AS n(i) WHERE seed.source_key='seed'`,
      values: [size, unrelated ? "noise" : "item"],
    });
  }
  const measured = new MeasuredPostgresDatabase(fixture.binding);
  const summary = createInboxService({
    db: measured,
    includeAccountItems: true,
  });
  const feed = createInboxFeedService({ db: measured, nowMs: () => 11_000 });
  for (let iteration = 0; iteration < 3; iteration++) {
    operation = `summary-${iteration}`;
    await summary.summary({ ...identity, presentation: "attention" });
    operation = `feed-${iteration}`;
    await feed.list(identity);
    operation = `observation-${iteration}`;
    await observeInboxNotifications({ ...identity, db: measured });
  }
  for (const sample of samples) {
    sample.plan = (
      await fixture.db.query({
        text: `EXPLAIN (FORMAT JSON) ${sample.sql}`,
        values: sample.values,
      })
    ).rows;
  }
  const summaryQuery = samples.find(
    (sample) => sample.operation === "summary-0"
  );
  if (!summaryQuery) {
    throw new Error("Summary was not measured");
  }
  const versions = [{ name: "current", query: summaryQuery }];
  if (process.argv[5]) {
    const baseline = JSON.parse(readFileSync(process.argv[5], "utf8"));
    if (!baseline.runtime?.includes("PostgreSQL 18")) {
      throw new Error(
        "Baseline must come from this native PostgreSQL benchmark."
      );
    }
    versions.push({
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
    rowCounts: (number | null)[];
  }[] = [];
  for (const { name, query } of versions) {
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        fixture.db.query({ text: query.sql, values: query.values })
      )
    );
    concurrency.push({
      name,
      requests: 4,
      elapsedMs: performance.now() - started,
      rowCounts: results.map((result) => result.rowCount),
    });
  }
  const output = {
    runtime: "isolated local PostgreSQL 18; not production capacity",
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
  await fixture.close();
}
