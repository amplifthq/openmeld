import {
  type PostgreSQLBinding,
  PostgresDatabase,
} from "@openmeld/db/postgresql";
import { onTestFinished, vi } from "vitest";

const WORKER_TEMPLATE_PATTERN = /^openmeld_pg_worker_template_[a-f0-9]{32}$/u;

/** Only fixture DDL/fault setup uses the owner; application requests use Hyperdrive's runtime role. */
export function postgresFixtureOperator(env: {
  TEST_POSTGRESQL_OWNER: PostgreSQLBinding;
}): PostgresDatabase {
  const url = new URL(env.TEST_POSTGRESQL_OWNER.connectionString);
  if (
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/openmeld_pg_local" ||
    url.username !== "openmeld_pg_owner" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Fixture DDL requires the fresh isolated pg:local owner.");
  }
  return new PostgresDatabase(env.TEST_POSTGRESQL_OWNER);
}

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Runtime writes encounter a real PostgreSQL trigger; fixture DDL stays with the isolated owner. */
export async function installWorkerPostgresWriteFailure(input: {
  env: { TEST_POSTGRESQL_OWNER: PostgreSQLBinding };
  table: string;
  operation: "INSERT" | "UPDATE";
  columns?: string[];
  condition: string;
  message?: string;
}) {
  const operator = postgresFixtureOperator(input.env);
  const name = `fixture_failure_${crypto.randomUUID().replaceAll("-", "")}`;
  const operation =
    input.operation +
    (input.columns?.length
      ? ` OF ${input.columns.map(identifier).join(", ")}`
      : "");
  await operator.query(`
    CREATE FUNCTION public.${identifier(name)}() RETURNS trigger LANGUAGE plpgsql AS $fixture$
    BEGIN RAISE EXCEPTION '${(input.message ?? "forced native fixture write failure").replaceAll("'", "''")}'; END $fixture$;
    CREATE TRIGGER ${identifier(name)} BEFORE ${operation} ON "openmeld".${identifier(input.table)}
      FOR EACH ROW WHEN (${input.condition}) EXECUTE FUNCTION public.${identifier(name)}();
  `);
  return async () => {
    await operator.query(`DROP TRIGGER ${identifier(name)} ON "openmeld".${identifier(input.table)};
      DROP FUNCTION public.${identifier(name)}();`);
  };
}

/** Private fixture database cloned from the complete immutable native journal. */
export async function createWorkerPostgresFixture(
  env: {
    TEST_POSTGRESQL_OWNER: PostgreSQLBinding;
    TEST_POSTGRESQL_TEMPLATE: string;
    TEST_POSTGRESQL_PRE_GUARD_TEMPLATE?: string;
    OPENMELD_POSTGRESQL: PostgreSQLBinding;
  },
  options: { beforeOwnerGuards?: boolean } = {}
) {
  const admin = postgresFixtureOperator(env);
  const templateName = options.beforeOwnerGuards
    ? env.TEST_POSTGRESQL_PRE_GUARD_TEMPLATE
    : env.TEST_POSTGRESQL_TEMPLATE;
  if (!templateName) {
    throw new Error("The historical owner fixture template is required");
  }
  if (!WORKER_TEMPLATE_PATTERN.test(templateName)) {
    throw new Error("A fresh isolated PostgreSQL template is required");
  }
  const name = `openmeld_pg_worker_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.query(
    `CREATE DATABASE ${identifier(name)} TEMPLATE ${identifier(templateName)}`
  );
  const connection = (binding: PostgreSQLBinding) => {
    const url = new URL(binding.connectionString);
    url.pathname = `/${name}`;
    return { connectionString: url.toString() };
  };
  const binding = connection(env.OPENMELD_POSTGRESQL);
  const db = new PostgresDatabase(binding);
  const operator = new PostgresDatabase(connection(env.TEST_POSTGRESQL_OWNER));
  const pendingQueries = new Set<Promise<unknown>>();
  function track<Result>(task: Promise<Result>): Promise<Result> {
    pendingQueries.add(task);
    task.then(
      () => pendingQueries.delete(task),
      () => pendingQueries.delete(task)
    );
    return task;
  }
  const nativeQuery = db.query.bind(db);
  const nativeTransaction = db.transaction.bind(db);
  vi.spyOn(db, "query").mockImplementation((query, values) =>
    track(nativeQuery(query, values))
  );
  vi.spyOn(db, "transaction").mockImplementation((callback) =>
    track(nativeTransaction(callback))
  );
  onTestFinished(async () => {
    // Promise.all can reject while a sibling native read is still using the database.
    while (pendingQueries.size) {
      await Promise.allSettled([...pendingQueries]);
    }
    await admin.query(`DROP DATABASE ${identifier(name)} WITH (FORCE)`);
  });
  async function writeRow(
    table: string,
    row: Record<string, unknown>,
    keys: string[]
  ) {
    const fields = Object.keys(row);
    const updates = fields.filter((field) => !keys.includes(field));
    await operator.query({
      text: `INSERT INTO "openmeld".${identifier(table)} (${fields.map(identifier).join(", ")})
      VALUES (${fields.map((_, index) => `$${index + 1}`).join(", ")})
      ON CONFLICT (${keys.map(identifier).join(", ")}) ${updates.length ? `DO UPDATE SET ${updates.map((field) => `${identifier(field)} = EXCLUDED.${identifier(field)}`).join(", ")}` : "DO NOTHING"}`,
      values: fields.map((field) => row[field]),
    });
  }
  function rows(table: string, keys: string[]) {
    const where = keys
      .map((field, index) => `${identifier(field)} = $${index + 1}`)
      .join(" AND ");
    const keyValues = (key: string) =>
      keys.length === 1 ? [key] : key.split("::");
    return {
      async get(key: string): Promise<Record<string, unknown> | undefined> {
        return (
          await operator.query({
            text: `SELECT * FROM "openmeld".${identifier(table)} WHERE ${where}`,
            values: keyValues(key),
          })
        ).rows[0];
      },
      async set(_key: string, row: Record<string, unknown>) {
        await writeRow(table, row, keys);
      },
      async has(key: string) {
        return Boolean(await this.get(key));
      },
      async delete(key: string) {
        await operator.query({
          text: `DELETE FROM "openmeld".${identifier(table)} WHERE ${where}`,
          values: keyValues(key),
        });
      },
      async values() {
        return (
          await operator.query(`SELECT * FROM "openmeld".${identifier(table)}`)
        ).rows;
      },
      async size() {
        const row = (
          await operator.query<{ count: number }>(
            `SELECT count(*)::bigint AS count FROM "openmeld".${identifier(table)}`
          )
        ).rows[0];
        if (!row) {
          throw new Error("Native fixture count returned no row");
        }
        return row.count;
      },
      async clear() {
        await operator.query(`DELETE FROM "openmeld".${identifier(table)}`);
      },
    };
  }
  return { binding, db, operator, writeRow, rows };
}
export type NativeFixtureRows = ReturnType<
  Awaited<ReturnType<typeof createWorkerPostgresFixture>>["rows"]
>;
