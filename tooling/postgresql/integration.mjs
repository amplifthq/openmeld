// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone operational acceptance uses node:assert and fails the command on contract violations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAuthDatabase } from "../../packages/db/src/auth/index.ts";
import {
  getPostgresDatabase,
  PostgresDatabase,
  withPostgresRequest,
} from "../../packages/db/src/postgresql.ts";
import { acceptRuntime } from "./acceptance.mjs";
import { verifyNativeTargetWithMigrations } from "./d1-import.mjs";
import {
  connect,
  connectionOptions,
  grantRuntime,
  migrate,
  migrationDirectory,
  migrationLock,
  readMigrations,
  withSpaceMembershipBackfillScope,
} from "./database.mjs";

const NESTED_TRANSACTION_PATTERN = /Nested PostgreSQL/u;
const ROLLBACK_ERROR_PATTERN = /expected rollback/u;
const TRANSACTION_CLIENT_ERROR_PATTERN = /explicit transaction client/u;

if (process.env.OPENMELD_PG_ISOLATED !== "1") {
  throw new Error("Run only through pg:local check");
}
const ownerUrl = process.env.POSTGRESQL_OPENMELD_MIGRATION_URL;
const owner = await connect(ownerUrl, true);
const runtime = await connect(
  process.env.POSTGRESQL_OPENMELD_RUNTIME_URL,
  true
);
const other = await connect(
  ownerUrl.replace(/\/openmeld_pg_local$/u, "/openmeld_pg_other"),
  true
);
const restore = await connect(
  ownerUrl.replace(/\/openmeld_pg_local$/u, "/openmeld_pg_restore"),
  true
);
const temp = await mkdtemp(path.join(os.tmpdir(), "openmeld-pg-check-"));
function pass(message) {
  console.log(`PASS ${message}`);
}
try {
  assert.throws(
    () => connectionOptions(`${ownerUrl}?host=unrelated.example`, true),
    /without query overrides/u
  );
  assert.throws(
    () => connectionOptions(`${ownerUrl}?sslmode=disable`, true),
    /without query overrides/u
  );
  assert.equal(
    (
      await owner.query("SHOW server_version_num")
    ).rows[0].server_version_num.startsWith("18"),
    true
  );
  const baselineCount = (await readMigrations()).length;
  assert.equal((await migrate(owner)).applied.length, baselineCount);
  assert.equal((await migrate(owner)).applied.length, 0);
  pass("empty database baseline and repeat migration");
  await owner.query("CREATE DATABASE openmeld_pg_membership_backfill");
  const historical = await connect(
    ownerUrl.replace(
      /\/openmeld_pg_local$/u,
      "/openmeld_pg_membership_backfill"
    ),
    true
  );
  try {
    const prefix = path.join(temp, "membership-prefix");
    await cp(migrationDirectory, prefix, { recursive: true });
    const prefixJournalPath = path.join(prefix, "meta/_journal.json");
    const prefixJournal = JSON.parse(await readFile(prefixJournalPath, "utf8"));
    prefixJournal.entries = prefixJournal.entries.slice(0, 31);
    await writeFile(prefixJournalPath, JSON.stringify(prefixJournal));
    await migrate(historical, prefix);
    const verifiedPrefix = await readMigrations(prefix);
    await historical.query("BEGIN READ ONLY");
    await verifyNativeTargetWithMigrations(historical, verifiedPrefix);
    await historical.query("COMMIT");
    await historical.query(
      "INSERT INTO openmeld.users(id,name,email,email_verified,created_at,updated_at) VALUES('synthetic-member','Synthetic member','synthetic-member@example.com',1,1,1)"
    );
    await historical.query(
      "INSERT INTO openmeld.organizations(id,name,slug,created_at,created_by_user_id) VALUES('synthetic-live-org','Synthetic organization','synthetic-live-org',1,'synthetic-member')"
    );
    for (const [space, organization] of [
      ["synthetic-live-space", "synthetic-live-org"],
      ["synthetic-stale-space", "synthetic-missing-org"],
    ]) {
      await historical.query(
        "INSERT INTO openmeld.space_index_spaces(space_id,organization_id,organization_visibility,status,space_name,source_updated_at_ms,projected_at_ms,projection_event_id) VALUES($1,$2,'private','active','Synthetic Space',1,1,$1)",
        [space, organization]
      );
      await historical.query(
        "INSERT INTO openmeld.space_index_memberships(space_id,profile_id,profile_kind_snapshot,profile_name_snapshot,owner_user_id_snapshot,status,member_source,added_at_ms,source_updated_at_ms,projected_at_ms,projection_event_id) VALUES($1,'synthetic-profile','human','Synthetic member','synthetic-member','active','manual',1,1,1,$1)",
        [space]
      );
    }
    assert.equal((await migrate(historical)).total, baselineCount);
    await historical.query("BEGIN READ ONLY");
    await assert.rejects(
      verifyNativeTargetWithMigrations(historical, verifiedPrefix),
      /journal mismatch/u
    );
    await historical.query("ROLLBACK");
    assert.deepEqual(
      (
        await historical.query(
          "SELECT source_target_json::jsonb ->> 'spaceId' AS space,read_at_ms=occurred_at_ms AS read FROM openmeld.inbox_items WHERE kind='space_joined'"
        )
      ).rows,
      [{ space: "synthetic-live-space", read: true }]
    );
    assert.equal(
      (
        await historical.query(
          "SELECT count(*)::int AS count FROM openmeld.space_index_spaces WHERE status='active'"
        )
      ).rows[0].count,
      2
    );
    assert.equal(
      (
        await historical.query(
          "SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='openmeld_membership_backfill_scope'"
        )
      ).rows[0].count,
      0
    );
    await historical.query("BEGIN");
    await assert.rejects(
      withSpaceMembershipBackfillScope(historical, () =>
        historical.query("SELECT 1/0")
      ),
      { code: "22012" }
    );
    await historical.query("ROLLBACK");
    assert.equal(
      (
        await historical.query(
          "SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='openmeld_membership_backfill_scope'"
        )
      ).rows[0].count,
      0
    );
    assert.equal((await migrate(historical)).applied.length, 0);
    pass(
      "historical membership backfill preserves orphaned snapshots and skips unavailable organizations"
    );
  } finally {
    await historical.end();
  }
  const contender = await connect(ownerUrl, true);
  try {
    await owner.query("SELECT pg_advisory_lock($1)", [migrationLock]);
    await assert.rejects(migrate(contender), /Another PostgreSQL migration/u);
    await owner.query("SELECT pg_advisory_unlock($1)", [migrationLock]);
    assert.equal((await migrate(contender)).applied.length, 0);
  } finally {
    await contender.end();
  }
  pass(
    "concurrent migration rejected while lock is held; succeeds after release"
  );
  const copied = path.join(temp, "migrations");
  await cp(migrationDirectory, copied, { recursive: true });
  const journalPath = path.join(copied, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  async function appendMigration(tag, sql) {
    const last = journal.entries.at(-1);
    journal.entries.push({
      idx: journal.entries.length,
      version: "7",
      when: last.when + 1,
      tag,
      breakpoints: true,
    });
    await writeFile(journalPath, JSON.stringify(journal));
    await writeFile(path.join(copied, `${tag}.sql`), sql);
  }
  await appendMigration(
    "0002_upgrade",
    "CREATE TABLE openmeld.upgrade_fixture(id text PRIMARY KEY, value jsonb NOT NULL); INSERT INTO openmeld.upgrade_fixture VALUES ('preserved', '{\"count\":1}');"
  );
  assert.deepEqual((await migrate(owner, copied)).applied, [
    "0002_upgrade.sql",
  ]);
  assert.equal(
    (
      await owner.query(
        "SELECT value->>'count' AS count FROM openmeld.upgrade_fixture WHERE id='preserved'"
      )
    ).rows[0].count,
    "1"
  );
  const original = await readFile(
    path.join(copied, "0001_foundation.sql"),
    "utf8"
  );
  await writeFile(
    path.join(copied, "0001_foundation.sql"),
    `${original}\n-- tampered`
  );
  await assert.rejects(migrate(owner, copied), /Applied migration drift/u);
  await writeFile(path.join(copied, "0001_foundation.sql"), original);
  await appendMigration(
    "0003_failure",
    "CREATE TABLE openmeld.must_rollback(id int); SELECT 1/0;"
  );
  await assert.rejects(migrate(owner, copied), (error) => {
    assert.equal(error.cause?.code, "22012");
    return true;
  });
  assert.equal(
    (await owner.query("SELECT to_regclass('openmeld.must_rollback') AS name"))
      .rows[0].name,
    null
  );
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"
      )
    ).rows[0].count,
    baselineCount + 1
  );
  pass(
    "upgrade preserves rows; checksum drift rejected; failed DDL rolls back with ledger"
  );
  await grantRuntime(owner, "openmeld_pg_runtime");
  await owner.query(
    "CREATE TABLE openmeld.runtime_contract_fixture(id text PRIMARY KEY)"
  );
  const binding = {
    connectionString: process.env.POSTGRESQL_OPENMELD_RUNTIME_URL,
  };
  const businessDb = new PostgresDatabase(binding);
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  await withPostgresRequest(binding, async () => {
    const requestDatabase = getPostgresDatabase({
      OPENMELD_POSTGRESQL: binding,
    });
    assert.equal(
      getPostgresDatabase({ OPENMELD_POSTGRESQL: binding }),
      requestDatabase
    );
    await withPostgresRequest(binding, () => {
      assert.equal(
        getPostgresDatabase({ OPENMELD_POSTGRESQL: binding }),
        requestDatabase
      );
    });
    await withPostgresRequest(
      binding,
      () => {
        assert.notEqual(
          getPostgresDatabase({ OPENMELD_POSTGRESQL: binding }),
          requestDatabase
        );
      },
      { reuseConnection: false }
    );
    assert.equal(
      getPostgresDatabase({ OPENMELD_POSTGRESQL: binding }),
      requestDatabase
    );
    const startedB = deferred();
    const releaseB = deferred();
    const a = businessDb.transaction(async (client) => {
      await client.query(
        "INSERT INTO openmeld.runtime_contract_fixture VALUES ('committed')"
      );
      await startedB.promise;
    });
    const b = businessDb.transaction(async (client) => {
      await client.query(
        "INSERT INTO openmeld.runtime_contract_fixture VALUES ('rolled-back')"
      );
      startedB.resolve();
      await releaseB.promise;
      throw new Error("expected rollback");
    });
    const rejectedB = assert.rejects(b, ROLLBACK_ERROR_PATTERN);
    await a;
    assert.deepEqual(
      (
        await businessDb.query(
          "SELECT id FROM openmeld.runtime_contract_fixture ORDER BY id"
        )
      ).rows,
      [{ id: "committed" }]
    );
    releaseB.resolve();
    await rejectedB;
    await businessDb.transaction(() => {
      assert.throws(
        () => businessDb.transaction(() => Promise.resolve()),
        NESTED_TRANSACTION_PATTERN
      );
      assert.throws(
        () => businessDb.query("SELECT 1"),
        TRANSACTION_CLIENT_ERROR_PATTERN
      );
      return Promise.resolve();
    });
    const authDb = createAuthDatabase();
    const now = new Date();
    await authDb
      .insert((await import("../../packages/db/src/auth/auth.schema.ts")).users)
      .values({
        id: "pg-runtime-auth-fixture",
        name: "PostgreSQL fixture",
        email: "pg-fixture@example.invalid",
        createdAt: now,
        updatedAt: now,
      });
    const user = await authDb.query.users.findFirst();
    assert.equal(user.emailVerified, false);
    assert.equal(user.createdAt.getTime(), now.getTime());
  });
  assert.deepEqual(
    (
      await businessDb.query(
        "SELECT id FROM openmeld.runtime_contract_fixture ORDER BY id"
      )
    ).rows,
    [{ id: "committed" }]
  );
  const releaseBackground = deferred();
  let background;
  await withPostgresRequest(binding, () => {
    background = releaseBackground.promise.then(() =>
      businessDb.query("SELECT 1 AS value")
    );
  });
  releaseBackground.resolve();
  assert.equal((await background).rows[0].value, 1);
  pass(
    "independent concurrent transactions and sibling reads stay isolated; nested misuse rejected; background queries own their lifetime; native auth epoch/boolean schema round-trips"
  );
  await owner.query(
    "CREATE SCHEMA openmeld_probe; REVOKE ALL ON SCHEMA openmeld_probe FROM PUBLIC; CREATE TABLE openmeld_probe.records(id uuid PRIMARY KEY, payload jsonb NOT NULL); GRANT USAGE ON SCHEMA openmeld_probe TO openmeld_pg_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON openmeld_probe.records TO openmeld_pg_runtime"
  );
  await acceptRuntime(runtime);
  pass(
    "runtime read/write, transaction rollback, immediate fresh reads, DDL/ledger/TRUNCATE denied"
  );
  await assert.rejects(other.query("SELECT * FROM openmeld.upgrade_fixture"), {
    code: "42P01",
  });
  pass("independent database cannot see fixture tables");
  const url = new URL(ownerUrl);
  const pgEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: "openmeld_pg_local",
  };
  function binary(name, args, env = pgEnv) {
    const executable = process.env.OPENMELD_PG_BIN
      ? path.join(process.env.OPENMELD_PG_BIN, name)
      : name;
    const result = spawnSync(executable, args, { env, encoding: "utf8" });
    assert.equal(result.status, 0, `${name} failed: ${result.stderr}`);
  }
  const dump = path.join(temp, "synthetic.dump");
  binary("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file",
    dump,
  ]);
  binary("pg_restore", [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    "--dbname",
    "openmeld_pg_restore",
    dump,
  ]);
  assert.deepEqual(
    (await restore.query("SELECT * FROM openmeld.upgrade_fixture")).rows,
    (await owner.query("SELECT * FROM openmeld.upgrade_fixture")).rows
  );
  assert.deepEqual(
    (
      await restore.query(
        "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"
      )
    ).rows,
    (
      await owner.query(
        "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"
      )
    ).rows
  );
  await grantRuntime(restore, "openmeld_pg_runtime");
  const restoredRuntime = await connect(
    process.env.POSTGRESQL_OPENMELD_RUNTIME_URL.replace(
      /\/openmeld_pg_local$/u,
      "/openmeld_pg_restore"
    ),
    true
  );
  try {
    assert.equal(
      (
        await restoredRuntime.query(
          "SELECT count(*)::int AS count FROM openmeld.upgrade_fixture"
        )
      ).rows[0].count,
      1
    );
  } finally {
    await restoredRuntime.end();
  }
  pass(
    "real pg_dump/pg_restore into separate empty database preserves data and migration history; explicit permissions reapplied"
  );
  const cli = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "cli.mjs"), "migrate", "production"],
    { encoding: "utf8" }
  );
  assert.notEqual(cli.status, 0);
  pass("production migration target rejected");
} finally {
  await Promise.all([owner.end(), runtime.end(), other.end(), restore.end()]);
  await rm(temp, { recursive: true });
}
