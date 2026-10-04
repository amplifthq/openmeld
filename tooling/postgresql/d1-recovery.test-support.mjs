// biome-ignore-all lint/suspicious/noMisplacedAssertion: Called by the native D1 rehearsal's node:test recovery case; assertions inspect real isolated storage.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readD1ImportCompletion, reconcileD1Snapshot } from "./d1-import.mjs";
import { fileSha256 } from "./d1-snapshot.mjs";
import {
  connect,
  grantRuntime,
  migrationDirectory,
  quoteIdentifier as quote,
} from "./database.mjs";
import { startDevelopmentPostgres } from "./development.mjs";

const invalidReceiptError = /receipt does not match/u;
const changedTargetError = /Imported (value mismatch|identity differs)/u;
const killedImportError = /import-d1 failed \(SIGKILL\)/u;
const completionBindingError = /completion (binding|journal).*mismatch/u;
const invalidCompletionError = /Invalid D1 import completion record/u;
const populatedTargetError = /Import target is not empty/u;
const incompleteJournalError = /completion journal is incomplete/u;
const appliedDriftError = /Applied migration drift/u;
const nativeLayoutError = /Native table inventory mismatch/u;

function snapshotCommand(snapshot, connectionString, command = "reconcile-d1") {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./cli.mjs", import.meta.url)),
      command,
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
  const completion = (
    await client.query(
      "SELECT record FROM openmeld_migration.d1_import_completion"
    )
  ).rows;
  return { hashes, identities, journal, completion };
}

async function interruptCommittedImport(state, options, root) {
  // Interrupt the real import CLI at its output boundary, after the owner has
  // committed. No application hook and no pre-existing receipt to restore.
  const preload = path.join(root, "interrupt-import-output.mjs");
  await writeFile(
    preload,
    `
if (process.argv[2] === "import-d1") {
  process.stdout.write = (chunk) => {
    if (JSON.parse(String(chunk)).status === "committed_and_reconciled") {
      process.kill(process.pid, "SIGKILL");
    }
    throw new Error("Unexpected import output");
  };
}
`,
    { mode: 0o600, flag: "wx" }
  );
  const prior = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = `${prior ?? ""} --import=${JSON.stringify(preload)}`;
    await assert.rejects(
      startDevelopmentPostgres(state, options),
      killedImportError
    );
  } finally {
    if (prior === undefined) {
      Reflect.deleteProperty(process.env, "NODE_OPTIONS");
    } else {
      process.env.NODE_OPTIONS = prior;
    }
  }
}

export async function rehearseD1Recovery({ snapshot, root, manifest }) {
  const state = path.join(root, "development-recovery");
  const migrationsDirectory = path.join(root, "recovery-migrations");
  await cp(migrationDirectory, migrationsDirectory, { recursive: true });
  const options = { snapshot, migrationsDirectory };
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
    cluster = await startDevelopmentPostgres(state, options);
    owner = await connect(cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL, true);
  };
  try {
    await interruptCommittedImport(state, options, root);
    await assert.rejects(readFile(receiptPath), { code: "ENOENT" });
    await start();
    const receipt = await readFile(receiptPath, "utf8");
    assert.deepEqual(
      JSON.parse(receipt),
      await readD1ImportCompletion({
        snapshot,
        connectionString: cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
      })
    );
    const beforeInspection = await databaseEvidence(owner, manifest.tables);
    const inspection = snapshotCommand(
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
    // A read-only observation is not an import commit receipt.
    await writeFile(receiptPath, `${JSON.stringify(evidence.inspection)}\n`, {
      mode: 0o600,
    });
    await assert.rejects(
      startDevelopmentPostgres(state, options),
      invalidReceiptError
    );
    await rm(receiptPath);
    await start();
    assert.equal(await readFile(receiptPath, "utf8"), receipt);
    assert.deepEqual(
      await databaseEvidence(owner, manifest.tables),
      beforeInspection
    );
    evidence.cases.push(
      "commit_before_output_sigkill_recovers_from_atomic_record",
      "inspection_cannot_replace_commit_receipt",
      "pre_write_restart_preserves_exact_import"
    );

    const record = JSON.parse(receipt);
    for (const changed of [
      { ...record, snapshotSha256: "0".repeat(64) },
      { ...record, captureReceiptSha256: "0".repeat(64) },
      { ...record, target: { ...record.target, databaseOid: "0" } },
      { ...record, nativeJournal: record.nativeJournal.slice(1) },
      { ...record, importId: null },
    ]) {
      await owner.query(
        "UPDATE openmeld_migration.d1_import_completion SET record=$1::jsonb",
        [JSON.stringify(changed)]
      );
      // Exercise the exact child command that normal startup must accept before
      // admitting the product; rejection must not repair the intentional fault.
      const result = snapshotCommand(
        snapshot,
        cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
        "read-d1-import"
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        changed.importId ? completionBindingError : invalidCompletionError
      );
      assert.deepEqual(
        (
          await owner.query(
            "SELECT record FROM openmeld_migration.d1_import_completion"
          )
        ).rows[0].record,
        changed
      );
      await owner.query(
        "UPDATE openmeld_migration.d1_import_completion SET record=$1::jsonb",
        [JSON.stringify(record)]
      );
    }
    // Remove the completion migration itself, even after canonical migrations
    // have been appended. Removing only the latest entry leaves a valid prefix.
    const completionMigrationIndex = record.nativeJournal.findIndex(
      ({ name }) => name === "0013_d1_import_completion.sql"
    );
    assert.notEqual(completionMigrationIndex, -1);
    await owner.query(
      "UPDATE openmeld_migration.d1_import_completion SET record=$1::jsonb",
      [
        JSON.stringify({
          ...record,
          nativeJournal: record.nativeJournal.slice(
            0,
            completionMigrationIndex
          ),
        }),
      ]
    );
    await assert.rejects(
      readD1ImportCompletion({
        snapshot,
        connectionString: cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
      }),
      incompleteJournalError
    );
    await owner.query(
      "UPDATE openmeld_migration.d1_import_completion SET record=$1::jsonb",
      [JSON.stringify(record)]
    );
    evidence.cases.push(
      "source_target_journal_and_malformed_record_keep_startup_closed"
    );

    // Non-transactional identity advancement is observable even with unchanged rows.
    await owner.query(
      "SELECT nextval(pg_get_serial_sequence('openmeld.agent_activity_events','accepted_sequence'))"
    );
    const changedSequence = snapshotCommand(
      snapshot,
      cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL
    );
    assert.equal(changedSequence.status, 1);
    assert.match(changedSequence.stderr, changedTargetError);
    const updated = await owner.query(
      "UPDATE openmeld.users SET name='Post-import recovery write' WHERE id='page-000' RETURNING id"
    );
    assert.equal(updated.rowCount, 1);
    const changedRows = snapshotCommand(
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
    await assert.rejects(
      readD1ImportCompletion({
        snapshot,
        connectionString: restoredUrl.toString(),
      }),
      completionBindingError
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
      for (const sql of [
        "SELECT * FROM openmeld_migration.d1_import_completion",
        "UPDATE openmeld_migration.d1_import_completion SET record='{}'::jsonb",
        "DELETE FROM openmeld_migration.d1_import_completion",
        "INSERT INTO openmeld_migration.d1_import_completion(record) VALUES('{}'::jsonb)",
      ]) {
        await assert.rejects(runtime.query(sql), { code: "42501" });
      }
    } finally {
      await runtime.end();
    }
    evidence.backupSha256 = await fileSha256(dump);
    evidence.restoredDatabase = "openmeld_pg_recovery";
    evidence.restoredTables = afterWrite.hashes.length;
    await stop();
    await rm(receiptPath);
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
      "post_write_restart_keeps_pg_authority",
      "backup_clone_cannot_reuse_original_completion_identity",
      "runtime_cannot_read_or_mutate_completion"
    );

    // An ordinary trusted upgrade may add tables/identities without changing
    // the immutable fact that the earlier import committed successfully.
    await stop();
    const journalPath = path.join(migrationsDirectory, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    const previous = journal.entries.at(-1);
    const upgrade = {
      idx: journal.entries.length,
      version: "7",
      when: previous.when + 1,
      tag: `${String(journal.entries.length).padStart(4, "0")}_test_recovery_upgrade`,
      breakpoints: true,
    };
    journal.entries.push(upgrade);
    await writeFile(
      path.join(migrationsDirectory, `${upgrade.tag}.sql`),
      "CREATE TABLE openmeld.recovery_upgrade(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text NOT NULL);\n--> statement-breakpoint\nCREATE INDEX recovery_user_name ON openmeld.users(name);\n"
    );
    await writeFile(journalPath, JSON.stringify(journal));
    await start();
    assert.equal(await readFile(receiptPath, "utf8"), receipt);
    const upgraded = await databaseEvidence(owner, manifest.tables);
    assert.deepEqual(upgraded.hashes, afterWrite.hashes);
    assert.deepEqual(upgraded.completion, afterWrite.completion);
    assert.equal(upgraded.journal.length, afterWrite.journal.length + 1);
    assert.equal(upgraded.identities.length, afterWrite.identities.length + 1);
    await owner.query(
      "INSERT INTO openmeld.recovery_upgrade(label) VALUES('After canonical upgrade')"
    );
    await assert.rejects(
      reconcileD1Snapshot({
        snapshot,
        connectionString: cluster.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
        migrationsDirectory,
      }),
      nativeLayoutError
    );
    await stop();
    await rm(receiptPath);
    await start();
    assert.equal(await readFile(receiptPath, "utf8"), receipt);
    const resumed = await databaseEvidence(owner, manifest.tables);
    assert.deepEqual(resumed.hashes, afterWrite.hashes);
    assert.deepEqual(resumed.completion, afterWrite.completion);
    assert.deepEqual(
      (
        await owner.query(
          "SELECT id::text,label FROM openmeld.recovery_upgrade"
        )
      ).rows,
      [{ id: "1", label: "After canonical upgrade" }]
    );
    await stop();
    // Corrupt only the isolated migration source, never repository history.
    const originalPath = path.join(
      migrationsDirectory,
      `${journal.entries[0].tag}.sql`
    );
    const originalSql = await readFile(originalPath, "utf8");
    await writeFile(
      originalPath,
      `${originalSql}\n-- tampered historical migration\n`
    );
    await assert.rejects(
      startDevelopmentPostgres(state, options),
      appliedDriftError
    );
    await writeFile(originalPath, originalSql);
    await writeFile(
      journalPath,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) })
    );
    await assert.rejects(
      startDevelopmentPostgres(state, options),
      appliedDriftError
    );
    await writeFile(journalPath, JSON.stringify(journal));
    await start();
    assert.equal(await readFile(receiptPath, "utf8"), receipt);
    assert.deepEqual(await databaseEvidence(owner, manifest.tables), resumed);
    evidence.cases.push(
      "canonical_append_preserves_completion_and_new_business_writes",
      "upgraded_lane_recovers_original_json_without_reimport",
      "changed_history_and_unknown_applied_migration_rejected"
    );
    // A privileged deletion is an intentional fault, not an automatic repair
    // route. Neither retained JSON nor populated rows can recreate authority.
    await owner.query("DELETE FROM openmeld_migration.d1_import_completion");
    await stop();
    await assert.rejects(
      startDevelopmentPostgres(state, options),
      invalidReceiptError
    );
    assert.equal(await readFile(receiptPath, "utf8"), receipt);
    await rm(receiptPath);
    await assert.rejects(
      startDevelopmentPostgres(state, options),
      populatedTargetError
    );
    evidence.finalTargetState =
      "stopped_with_intentionally_removed_completion_record";
    evidence.cases.push(
      "missing_database_record_cannot_be_recreated_from_json_or_rows"
    );
    return evidence;
  } finally {
    await restored?.end();
    await stop();
  }
}
