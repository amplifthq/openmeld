import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const migrationDirectory = fileURLToPath(
  new URL("../../packages/db/postgresql/migrations/", import.meta.url)
);
export const migrationLock = 640_021_017;

export function connectionOptions(connectionString, local = false) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Expected a PostgreSQL URL");
  }
  if (local) {
    if (
      url.hostname !== "127.0.0.1" ||
      !url.pathname.startsWith("/openmeld_pg_")
    ) {
      throw new Error(
        "Local operations require the isolated loopback database"
      );
    }
  } else if (!url.hostname.endsWith(".pg.psdb.cloud") || url.port !== "5432") {
    throw new Error(
      "Migration and backup require the direct PlanetScale endpoint on port 5432"
    );
  }
  // pg parses query parameters as connection overrides, including host and SSL.
  // Only the validated authority/path may select the destination or transport.
  if (url.search || url.hash) {
    throw new Error(
      "Use a canonical database URL without query overrides or fragments"
    );
  }
  return {
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    application_name: "openmeld-postgresql-migration",
  };
}

export async function connect(connectionString, local = false) {
  const client = new pg.Client(connectionOptions(connectionString, local));
  await client.connect();
  return client;
}

export async function readMigrations(directory = migrationDirectory) {
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (
    !files.length ||
    files.some(
      (file, i) => !file.startsWith(`${String(i + 1).padStart(4, "0")}_`)
    )
  ) {
    throw new Error("Migrations must be consecutively numbered from 0001");
  }
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(`${directory}/${name}`, "utf8");
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    })
  );
}

export async function migrate(client, directory = migrationDirectory) {
  const migrations = await readMigrations(directory);
  // Session lock is deliberately on a direct connection, never Hyperdrive/PgBouncer.
  const { rows } = await client.query(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [migrationLock]
  );
  if (!rows[0].acquired) {
    throw new Error(
      "Another PostgreSQL migration owns the lock; no changes applied"
    );
  }
  try {
    await client.query(
      "SET lock_timeout = '5s'; SET statement_timeout = '60s'; SET idle_in_transaction_session_timeout = '30s'"
    );
    await client.query("BEGIN");
    try {
      await client.query(
        "CREATE SCHEMA IF NOT EXISTS openmeld_meta; REVOKE ALL ON SCHEMA openmeld_meta FROM PUBLIC"
      );
      await client.query(
        "CREATE TABLE IF NOT EXISTS openmeld_meta.migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const applied = (
      await client.query(
        "SELECT name, checksum FROM openmeld_meta.migrations ORDER BY name"
      )
    ).rows;
    for (const [index, entry] of applied.entries()) {
      if (
        migrations[index]?.name !== entry.name ||
        migrations[index]?.checksum !== entry.checksum
      ) {
        throw new Error(`Applied migration drift: ${entry.name}`);
      }
    }
    const added = [];
    for (const migration of migrations.slice(applied.length)) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO openmeld_meta.migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum]
        );
        await client.query("COMMIT");
        added.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied: added, total: migrations.length };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLock]);
  }
}

export function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function grantRuntime(client, role) {
  const name = quoteIdentifier(role);
  const flags = (
    await client.query(
      "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=$1",
      [role]
    )
  ).rows[0];
  if (!flags || Object.values(flags).some(Boolean)) {
    throw new Error("Runtime role must have no administrative attributes");
  }
  const inherited = (
    await client.query(
      "SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member WHERE child.rolname=$1",
      [role]
    )
  ).rows;
  if (inherited.length) {
    throw new Error("Runtime role must not inherit broad managed roles");
  }
  await client.query(`GRANT USAGE ON SCHEMA openmeld TO ${name}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA openmeld TO ${name}`
  );
  await client.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA openmeld TO ${name}`
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA openmeld GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${name}`
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA openmeld GRANT USAGE, SELECT ON SEQUENCES TO ${name}`
  );
}
