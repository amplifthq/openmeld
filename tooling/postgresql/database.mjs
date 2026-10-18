import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as migrateDrizzle } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const migrationDirectory = process.env.OPENMELD_RELEASE_SOURCE_ROOT
  ? path.join(
      process.env.OPENMELD_RELEASE_SOURCE_ROOT,
      "packages/db/postgresql/migrations"
    )
  : fileURLToPath(
      new URL("../../packages/db/postgresql/migrations/", import.meta.url)
    );
export const migrationLock = 640_021_017;
const EXACT_SOURCE_SHA = /^[0-9a-f]{40}$/u;
const MIGRATION_TAG = /^\d{4}_[a-z0-9_-]+$/u;

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

// PlanetScale can send a TLS close error after all queries have completed.
// Listen only during explicit shutdown: live query/transaction failures retain
// their normal fatal boundary, and every other shutdown error still rejects.
export async function closeMigrationClient(client, warn = console.warn) {
  const errors = [];
  const onError = (error) => errors.push(error);
  client.on("error", onError);
  try {
    await client.end();
  } finally {
    client.removeListener("error", onError);
  }
  const unexpected = errors.filter(
    (error) => error.code !== "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC"
  );
  if (unexpected.length) {
    throw new AggregateError(
      unexpected,
      "PostgreSQL connection shutdown failed"
    );
  }
  if (errors.length) {
    warn(
      "PostgreSQL TLS peer reported ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC during explicit connection shutdown."
    );
  }
}

export async function readMigrations(directory = migrationDirectory) {
  const journal = JSON.parse(
    await readFile(`${directory}/meta/_journal.json`, "utf8")
  );
  const migrations = readMigrationFiles({ migrationsFolder: directory });
  if (
    !migrations.length ||
    journal.entries.some(
      (entry, index) =>
        entry.idx !== index ||
        (index > 0 && entry.when <= journal.entries[index - 1].when)
    )
  ) {
    throw new Error(
      "Drizzle migration journal must be nonempty and strictly ordered"
    );
  }
  return migrations.map((entry, index) => ({
    ...entry,
    name: `${journal.entries[index].tag}.sql`,
    checksum: entry.hash,
  }));
}

// Read the immutable journal from the exact previously verified release. No
// checkout, migration, or credential changes are required by this proof.
export function readMigrationsAtSource(sourceSha, cwd) {
  if (!EXACT_SOURCE_SHA.test(sourceSha)) {
    throw new Error("PostgreSQL retry baseline requires an exact source SHA");
  }
  const read = (path) =>
    execFileSync(
      "git",
      ["show", `${sourceSha}:packages/db/postgresql/migrations/${path}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  const journal = JSON.parse(read("meta/_journal.json"));
  if (
    !(Array.isArray(journal.entries) && journal.entries.length) ||
    journal.entries.some(
      (entry, index) =>
        entry.idx !== index ||
        !MIGRATION_TAG.test(entry.tag) ||
        !Number.isSafeInteger(entry.when) ||
        (index > 0 && entry.when <= journal.entries[index - 1].when)
    )
  ) {
    throw new Error("PostgreSQL retry baseline journal is invalid");
  }
  return journal.entries.map((entry) => {
    const name = `${entry.tag}.sql`;
    const hash = createHash("sha256").update(read(name)).digest("hex");
    return { name, hash, checksum: hash, folderMillis: entry.when };
  });
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
    const tables = (
      await client.query(
        "SELECT to_regclass('openmeld_meta.migrations') AS legacy, to_regclass('drizzle.__drizzle_migrations') AS current"
      )
    ).rows[0];
    if (tables.legacy) {
      throw new Error(
        "Legacy foundation ledger exists; reconcile it explicitly before adopting Drizzle migrations"
      );
    }
    const applied = tables.current
      ? (
          await client.query(
            "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id"
          )
        ).rows
      : [];
    for (const [index, entry] of applied.entries()) {
      if (
        migrations[index]?.checksum !== entry.hash ||
        migrations[index]?.folderMillis !== Number(entry.created_at)
      ) {
        throw new Error(`Applied migration drift at position ${index}`);
      }
    }
    // 0033 is already immutable on shared Staging. Its historical backfill
    // predates orphaned Space-index snapshots. Filter only these derived Inbox
    // inserts while executing that migration; retain all historical source rows.
    const needsMembershipGuard =
      applied.length > 0 &&
      migrations
        .slice(applied.length)
        .some((entry) => entry.name === "0033_space_joined_inbox.sql");
    const applyMigrations = () =>
      migrateDrizzle(drizzle(client), { migrationsFolder: directory });
    if (needsMembershipGuard) {
      await withSpaceMembershipBackfillScope(client, applyMigrations);
    } else {
      await applyMigrations();
    }
    await client.query("REVOKE ALL ON SCHEMA drizzle FROM PUBLIC");
    const added = migrations
      .slice(applied.length)
      .map((migration) => migration.name);
    return { applied: added, total: migrations.length };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLock]);
  }
}

// Both pending 0033 upgrades and frozen D1 imports execute the same immutable
// baseline SQL. Only new derived notices for unavailable organizations are skipped.
export async function withSpaceMembershipBackfillScope(client, operation) {
  await client.query(`CREATE FUNCTION pg_temp.openmeld_membership_backfill_scope()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM openmeld.organizations WHERE id = NEW.organization_id) THEN
        RETURN NULL;
      END IF;
      RETURN NEW;
    END; $$`);
  await client.query(`CREATE TRIGGER openmeld_membership_backfill_scope
    BEFORE INSERT ON openmeld.inbox_items FOR EACH ROW
    WHEN (NEW.kind = 'space_joined' AND NEW.source_kind = 'system_attention_event')
    EXECUTE FUNCTION pg_temp.openmeld_membership_backfill_scope()`);
  const removeGuard = async () => {
    await client.query(
      "DROP TRIGGER openmeld_membership_backfill_scope ON openmeld.inbox_items"
    );
    await client.query(
      "DROP FUNCTION pg_temp.openmeld_membership_backfill_scope()"
    );
  };
  let result;
  try {
    result = await operation();
  } catch (error) {
    try {
      await removeGuard();
    } catch {
      // A failed import transaction must roll back before its guard can be
      // removed. Preserve that original failure; its outer owner rolls back.
    }
    throw error;
  }
  await removeGuard();
  return result;
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
