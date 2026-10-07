import {
  type PostgreSQLBinding,
  PostgresDatabase,
  type QueryConfig,
  type QueryResultRow,
} from "@openmeld/db/postgresql";
import {
  connect,
  grantRuntime,
  migrate,
  quoteIdentifier,
} from "./database.mjs";

// biome-ignore lint/performance/noBarrelFile: Fixture races use the real vendor Pool contract.
export { Pool } from "pg";

const bindingByDatabase = new WeakMap<PostgresDatabase, PostgreSQLBinding>();
let template: Promise<string> | undefined;

function isolatedUrls(): { owner: URL; runtime: URL } {
  if (process.env.OPENMELD_PG_ISOLATED !== "1") {
    throw new Error(
      "PostgreSQL tests require pg:local; no shared or production database is accepted."
    );
  }
  const owner = new URL(process.env.POSTGRESQL_OPENMELD_MIGRATION_URL ?? "");
  const runtime = new URL(process.env.POSTGRESQL_OPENMELD_RUNTIME_URL ?? "");
  for (const url of [owner, runtime]) {
    if (
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/openmeld_pg_local" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Tests require the fresh isolated loopback cluster.");
    }
  }
  return { owner, runtime };
}

async function createTemplate(): Promise<string> {
  const { owner } = isolatedUrls();
  const name = `openmeld_pg_template_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = await connect(owner.toString(), true);
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  owner.pathname = `/${name}`;
  const client = await connect(owner.toString(), true);
  try {
    await migrate(client);
    await grantRuntime(client, "openmeld_pg_runtime");
  } finally {
    await client.end();
  }
  return name;
}

/** Prepare the immutable fixture journal before behavior-test timing begins. */
export function preparePostgresTestTemplate(): Promise<string> {
  isolatedUrls();
  template ??= createTemplate();
  return template;
}

/** Each test owns a real database cloned from the complete immutable journal. */
export async function createPostgresHarness() {
  const { owner, runtime } = isolatedUrls();
  const templateName = await preparePostgresTestTemplate();
  const name = `openmeld_pg_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = await connect(owner.toString(), true);
  try {
    await admin.query(
      `CREATE DATABASE ${quoteIdentifier(name)} TEMPLATE ${quoteIdentifier(templateName)}`
    );
  } finally {
    await admin.end();
  }
  owner.pathname = `/${name}`;
  runtime.pathname = `/${name}`;
  const operator = await connect(owner.toString(), true);
  const binding = { connectionString: runtime.toString() };
  const db = new PostgresDatabase(binding);
  bindingByDatabase.set(db, binding);
  return {
    binding,
    db,
    query: operator.query.bind(operator),
    async queryAll<Row extends QueryResultRow>(
      query: QueryConfig
    ): Promise<Row[]> {
      return (await db.query<Row>(query)).rows;
    },
    async queryFirst<Row extends QueryResultRow>(
      query: QueryConfig
    ): Promise<Row | null> {
      return (await db.query<Row>(query)).rows[0] ?? null;
    },
    async close(): Promise<void> {
      await operator.end();
      const cleanup = await connect(isolatedUrls().owner.toString(), true);
      try {
        await cleanup.query(
          `DROP DATABASE ${quoteIdentifier(name)} WITH (FORCE)`
        );
      } finally {
        await cleanup.end();
      }
    },
  };
}

export function postgresTestBinding(db: PostgresDatabase): PostgreSQLBinding {
  const binding = bindingByDatabase.get(db);
  if (!binding) {
    throw new Error(
      "Only an isolated PostgreSQL test database can become a Worker binding."
    );
  }
  return binding;
}

export type PostgresHarness = Awaited<ReturnType<typeof createPostgresHarness>>;
export function registerTestDatabaseBinding(
  db: PostgresDatabase,
  binding: PostgreSQLBinding
) {
  bindingByDatabase.set(db, binding);
}

/** Native trigger faults exercise rollback/checkpoint behavior at the real database boundary. */
export async function installPostgresWriteFailure(input: {
  harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  table: string;
  operation: "INSERT" | "UPDATE";
  columns?: string[];
  condition?: string;
  message: string;
}): Promise<() => Promise<void>> {
  const name = `fixture_failure_${crypto.randomUUID().replaceAll("-", "")}`;
  const operation =
    input.operation +
    (input.columns?.length
      ? ` OF ${input.columns.map(quoteIdentifier).join(", ")}`
      : "");
  await input.harness.query({
    text: `CREATE FUNCTION public.${quoteIdentifier(name)}() RETURNS trigger LANGUAGE plpgsql AS $fixture$
    BEGIN RAISE EXCEPTION '${input.message.replaceAll("'", "''")}'; END $fixture$;
    CREATE TRIGGER ${quoteIdentifier(name)} BEFORE ${operation} ON "openmeld".${quoteIdentifier(input.table)}
      FOR EACH ROW ${input.condition ? `WHEN (${input.condition})` : ""} EXECUTE FUNCTION public.${quoteIdentifier(name)}();`,
  });
  return async () => {
    await input.harness.query({
      text: `DROP TRIGGER ${quoteIdentifier(name)} ON "openmeld".${quoteIdentifier(input.table)}; DROP FUNCTION public.${quoteIdentifier(name)}();`,
    });
  };
}
