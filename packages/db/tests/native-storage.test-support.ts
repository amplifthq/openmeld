/* biome-ignore-all lint/suspicious/noMisplacedAssertion: Called and awaited by seven native storage contract tests. */
import { afterAll, beforeAll, expect } from "vitest";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";

let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
beforeAll(async () => {
  harness = await createPostgresHarness();
});
afterAll(async () => {
  await harness?.close();
});

/** Exercise immutable native migrations, independently of Drizzle's model text. */
export async function assertNativeStorageContract(input: {
  table: string;
  uniqueKey: string[];
  epochColumns: string[];
  record: Record<string, unknown>;
  distinctRecord: Record<string, unknown>;
}) {
  const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const insert = (record: Record<string, unknown>) => {
    const fields = Object.keys(record);
    return harness.db.query({
      text: `INSERT INTO "openmeld".${identifier(input.table)} (${fields.map(identifier).join(", ")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(", ")})`,
      values: fields.map((field) => record[field]),
    });
  };
  const columns = await harness.queryAll<{
    column_name: string;
    data_type: string;
  }>({
    text: "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'openmeld' AND table_name = $1",
    values: [input.table],
  });
  for (const column of input.epochColumns) {
    expect(columns.find((row) => row.column_name === column)?.data_type).toBe(
      "bigint"
    );
  }
  const indexes = await harness.queryAll<{ columns: string[] }>({
    text: `SELECT array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
        FROM pg_index AS index
        JOIN pg_class AS relation ON relation.oid = index.indrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        CROSS JOIN LATERAL unnest(index.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid AND attribute.attnum = key.attnum
        WHERE namespace.nspname = 'openmeld' AND relation.relname = $1
          AND index.indisunique AND index.indpred IS NULL
        GROUP BY index.indexrelid`,
    values: [input.table],
  });
  expect(indexes.map((index) => index.columns)).toContainEqual(input.uniqueKey);
  if (typeof input.record.organization_id === "string") {
    for (const id of new Set([
      input.record.organization_id,
      input.distinctRecord.organization_id,
    ])) {
      await harness.query({
        text: "INSERT INTO openmeld.organizations (id, name, slug, created_at) VALUES ($1, $1, $1, 1700000000000)",
        values: [id],
      });
    }
  }
  await insert(input.record);
  const duplicate = { ...input.record };
  for (const field of [
    "impact_id",
    "evidence_id",
    "openmeld_service_runtime_id",
  ]) {
    if (
      typeof duplicate[field] === "string" &&
      !input.uniqueKey.includes(field)
    ) {
      duplicate[field] = `${duplicate[field]}-duplicate`;
    }
  }
  await expect(insert(duplicate)).rejects.toMatchObject({ code: "23505" });
  await insert(input.distinctRecord);
  const stored = await harness.queryAll<Record<string, unknown>>({
    text: `SELECT * FROM "openmeld".${identifier(input.table)}`,
  });
  expect(stored).toHaveLength(2);
  expect(stored).toEqual(
    expect.arrayContaining([
      expect.objectContaining(input.record),
      expect.objectContaining(input.distinctRecord),
    ])
  );
}
