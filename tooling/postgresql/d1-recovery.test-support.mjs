// biome-ignore-all lint/suspicious/noMisplacedAssertion: Called by the native D1 rehearsal's node:test recovery case; assertions inspect real isolated storage.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileSha256 } from "./d1-snapshot.mjs";
import {
  connect,
  grantRuntime,
  quoteIdentifier as quote,
} from "./database.mjs";
import { startDevelopmentPostgres } from "./development.mjs";

const missingReceiptError = /Import target is not empty/u;
const invalidReceiptError = /receipt does not match/u;
const changedTargetError = /Imported (value mismatch|identity differs)/u;

function reconcile(snapshot, connectionString) {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./cli.mjs", import.meta.url)),
      "reconcile-d1",
      "local",
      snapshot,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENMELD_PG_ISOLATED: "1",
        POSTGRESQL_OPENMELD_MIGRATION_URL: connectionString,
      },
    }
  );
  return result;
}

function binary(name, args, connectionString) {
  const url = new URL(connectionString);
  const result = spawnSync(path.join(process.env.OPENMELD_PG_BIN, name), args, {
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1),
    },
  });
  assert.equal(
    result.status,
    0,
    `${name} failed; credential-bearing diagnostics suppressed`
  );
}

async function databaseEvidence(client, tables) {
  const hashes = [];
  for (const { name } of tables) {
    const result = await client.query(
      `SELECT count(*)::text AS rows,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM openmeld.${quote(name)} t`
    );
    hashes.push({ table: name, ...result.rows[0] });
  }
  const identities = (
    await client.query(
      "SELECT c.relname AS name,pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) AS sequence FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='openmeld' AND a.attidentity<>'' ORDER BY c.relname,a.attname"
    )
  ).rows;
  for (const identity of identities) {
    Object.assign(
      identity,
      (
        await client.query(
          `SELECT last_value::text,is_called FROM ${identity.sequence}`
        )
      ).rows[0]
    );
  }
  const journal = (
    await client.query(
      "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id"
    )
  ).rows;
  return { hashes, identities, journal };
}

export async function rehearseD1Recovery({ snapshot, root, manifest }) {
  const state = path.join(root, "development-recovery");
  const receiptPath = path.join(
    state,
    "postgresql-d1-rehearsal",
    `openmeld-pg-${manifest.snapshotSha256}`,
    "d1-import.json"
  );
  let cluster;
  let owner;
  let restored;
  const evidence = {
    sourceSnapshotSha256: manifest.snapshotSha256,
    productAdmission: "not_started",
    workstationDrain: "not_exercised",
    retainedDoR2Effects: "not_restored_or_certified",
    cases: [],
  };
  const stop = async () => {
    await owner?.end();
    owner = undefined;
    await cluster?.stop();
    cluster = undefined;
  };
  const start = async () => {
    cluster = await startDevelopmentPostgres(state, { snapshot });
    owner = await connect(cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL, true);
  };
  try {
    await start();
    const receipt = await readFile(receiptPath, "utf8");
    const beforeInspection = await databaseEvidence(owner, manifest.tables);
    await rename(receiptPath, `${receiptPath}.preserved`);
    const inspection = reconcile(
      snapshot,
      cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL
    );
    assert.equal(inspection.status, 0, inspection.stderr);
    evidence.inspection = JSON.parse(inspection.stdout);
    assert.equal(evidence.inspection.status, "snapshot_reconciled");
    assert.equal(evidence.inspection.inspectionOnly, true);
    assert.equal(evidence.inspection.promotionAllowed, false);
    assert.equal(evidence.inspection.businessWriteHistory, "not_proven");
    assert.deepEqual(
      await databaseEvidence(owner, manifest.tables),
      beforeInspection
    );
    await stop();
    await assert.rejects(
      startDevelopmentPostgres(state, { snapshot }),
      missingReceiptError
    );
    // A read-only observation is not an import commit receipt.
    await writeFile(receiptPath, `${JSON.stringify(evidence.inspection)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await assert.rejects(
      startDevelopmentPostgres(state, { snapshot }),
      invalidReceiptError
    );
    // Restore the preserved original receipt, never synthesize one from equality.
    await rename(`${receiptPath}.preserved`, receiptPath);
    await start();
    assert.equal(await readFile(receiptPath, "utf8"), receipt);
    assert.deepEqual(
      await databaseEvidence(owner, manifest.tables),
      beforeInspection
    );
    evidence.cases.push(
      "lost_commit_receipt_preserved_and_startup_closed",
      "inspection_cannot_replace_commit_receipt",
      "pre_write_restart_preserves_exact_import"
    );

    // Non-transactional identity advancement is observable even with unchanged rows.
    await owner.query(
      "SELECT nextval(pg_get_serial_sequence('openmeld.agent_activity_events','accepted_sequence'))"
    );
    const changedSequence = reconcile(
      snapshot,
      cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL
    );
    assert.equal(changedSequence.status, 1);
    assert.match(changedSequence.stderr, changedTargetError);
    const updated = await owner.query(
      "UPDATE openmeld.users SET name='Post-import recovery write' WHERE id='page-000' RETURNING id"
    );
    assert.equal(updated.rowCount, 1);
    const changedRows = reconcile(
      snapshot,
      cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL
    );
    assert.equal(changedRows.status, 1);
    assert.match(changedRows.stderr, changedTargetError);
    const afterWrite = await databaseEvidence(owner, manifest.tables);
    assert.notDeepEqual(afterWrite, beforeInspection);
    const dump = path.join(root, "post-import-recovery.dump");
    binary(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", "--file", dump],
      cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL
    );
    await chmod(dump, 0o600);
    await owner.query(
      "CREATE DATABASE openmeld_pg_recovery TEMPLATE template0"
    );
    const restoredUrl = new URL(cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL);
    restoredUrl.pathname = "/openmeld_pg_recovery";
    binary(
      "pg_restore",
      [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-acl",
        "--dbname",
        "openmeld_pg_recovery",
        dump,
      ],
      restoredUrl.toString()
    );
    restored = await connect(restoredUrl.toString(), true);
    assert.deepEqual(
      await databaseEvidence(restored, manifest.tables),
      afterWrite
    );
    await grantRuntime(restored, "openmeld_pg_runtime");
    await restored.end();
    restored = undefined;
    const runtime = await connect(
      restoredUrl
        .toString()
        .replace("openmeld_pg_owner:", "openmeld_pg_runtime:"),
      true
    );
    try {
      assert.equal(
        (
          await runtime.query(
            "SELECT name FROM openmeld.users WHERE id='page-000'"
          )
        ).rows[0].name,
        "Post-import recovery write"
      );
      await assert.rejects(
        runtime.query("SELECT * FROM drizzle.__drizzle_migrations"),
        { code: "42501" }
      );
    } finally {
      await runtime.end();
    }
    evidence.backupSha256 = await fileSha256(dump);
    evidence.restoredDatabase = "openmeld_pg_recovery";
    evidence.restoredTables = afterWrite.hashes.length;
    await stop();
    await start();
    assert.deepEqual(
      await databaseEvidence(owner, manifest.tables),
      afterWrite
    );
    assert.equal(await readFile(receiptPath, "utf8"), receipt);
    assert.equal(await fileSha256(snapshot), manifest.snapshotSha256);
    evidence.cases.push(
      "new_pg_rows_and_sequences_reject_old_snapshot",
      "native_backup_restores_new_writes_and_grants",
      "post_write_restart_keeps_pg_authority"
    );
    return evidence;
  } finally {
    await restored?.end();
    await stop();
  }
}
