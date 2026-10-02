// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone operational acceptance uses node:assert and fails the command on contract violations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acceptRuntime } from "./acceptance.mjs";
import {
  connect,
  connectionOptions,
  grantRuntime,
  migrate,
  migrationDirectory,
  migrationLock,
} from "./database.mjs";

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
  assert.equal((await migrate(owner)).applied.length, 1);
  assert.equal((await migrate(owner)).applied.length, 0);
  pass("empty database baseline and repeat migration");
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
  await writeFile(
    path.join(copied, "0002_upgrade.sql"),
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
  await writeFile(
    path.join(copied, "0003_failure.sql"),
    "CREATE TABLE openmeld.must_rollback(id int); SELECT 1/0;"
  );
  await assert.rejects(migrate(owner, copied), { code: "22012" });
  assert.equal(
    (await owner.query("SELECT to_regclass('openmeld.must_rollback') AS name"))
      .rows[0].name,
    null
  );
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::int AS count FROM openmeld_meta.migrations"
      )
    ).rows[0].count,
    2
  );
  pass(
    "upgrade preserves rows; checksum drift rejected; failed DDL rolls back with ledger"
  );
  await grantRuntime(owner, "openmeld_pg_runtime");
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
        "SELECT name, checksum FROM openmeld_meta.migrations ORDER BY name"
      )
    ).rows,
    (
      await owner.query(
        "SELECT name, checksum FROM openmeld_meta.migrations ORDER BY name"
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
