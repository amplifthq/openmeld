import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { verifyPassword } from "better-auth/crypto";
import { importD1Snapshot } from "./d1-import.mjs";
import { createLocalD1FromSqlite } from "./d1-local-fixture.mjs";
import { createD1RehearsalFixture, fixture } from "./d1-rehearsal-fixture.mjs";
import { captureD1Snapshot } from "./d1-snapshot.mjs";
import { connect, migrate, quoteIdentifier as quote } from "./database.mjs";

const ownerGuardError = /canonical_enabled/u;
const populatedTargetError = /not empty/u;
const inventoryError = /table inventory/u;
const storedValueError = /Unsupported stored value/u;
const safeRangeError = /safe range/u;
const nulTextError = /NUL text/u;
const constraintError = /Native import rejected: 23514/u;
const reconciliationError = /Imported value mismatch/u;

if (process.env.OPENMELD_PG_ISOLATED !== "1") {
  throw new Error("Run this rehearsal through pg:local run node --test");
}

async function createSource(root) {
  const input = path.join(root, "fixture.sqlite");
  await createD1RehearsalFixture(input);
  return createLocalD1FromSqlite(input, root);
}

async function freshTarget(admin, index) {
  const database = `openmeld_pg_d1_${index}`;
  await admin.query(
    `CREATE DATABASE ${quote(database)} TEMPLATE openmeld_pg_local`
  );
  const url = new URL(process.env.POSTGRESQL_OPENMELD_MIGRATION_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

async function tableCounts(connectionString, tables) {
  const client = await connect(connectionString, true);
  try {
    const result = [];
    for (const table of tables) {
      result.push(
        (
          await client.query(
            `SELECT count(*)::text AS count FROM openmeld.${quote(table.name)}`
          )
        ).rows[0].count
      );
    }
    return result;
  } finally {
    await client.end();
  }
}

async function waitForCopy(admin, database, child) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const { rows } = await admin.query(
      "SELECT pid FROM pg_stat_activity WHERE datname=$1 AND state='active' AND query LIKE 'COPY openmeld.%users%'",
      [database]
    );
    if (rows.length) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error("Import exited before COPY interruption");
    }
    await delay(20);
  }
  throw new Error("COPY interruption deadline exceeded");
}

// biome-ignore lint/style/noDoneCallback: node:test supplies TestContext, not a completion callback; the async body returns a Promise.
test("historical D1 capture to native PG18 preserves business data and rolls back failure", async (t) => {
  const started = performance.now();
  const root = await mkdtemp(
    process.env.OPENMELD_D1_REHEARSAL_OUTPUT ??
      path.join(os.tmpdir(), "openmeld-d1-rehearsal-")
  );
  await chmod(root, 0o700);
  let mf;
  let admin;
  let targetIndex = 0;
  const evidence = {
    cases: [],
    productWebSmoke: "not_run_by_this_database_rehearsal",
  };
  try {
    const template = await connect(
      process.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
      true
    );
    try {
      await migrate(template);
    } finally {
      await template.end();
    }
    const adminUrl = new URL(process.env.POSTGRESQL_OPENMELD_MIGRATION_URL);
    adminUrl.pathname = "/openmeld_pg_other";
    admin = await connect(adminUrl.toString(), true);
    mf = await createSource(root);
    const source = await mf.getD1Database("SOURCE");
    const capture = (name) =>
      captureD1Snapshot({
        source,
        destination: path.join(root, `${name}.sqlite`),
        identity: {
          kind: "local-synthetic",
          id: "historical-business-fixture",
          frozenBy: "exclusive serial rehearsal process",
        },
      });
    const snapshot = path.join(root, "baseline.sqlite");
    const manifest = await capture("baseline");
    evidence.capture = manifest;
    const baselineCapturedMs = performance.now();
    await t.test(
      "all fields, credentials, owner guards, generated folders, pages and identity high-water marks",
      async () => {
        const connectionString = await freshTarget(admin, targetIndex++);
        evidence.import = await importD1Snapshot({
          snapshot,
          connectionString,
        });
        evidence.setupCaptureAndImportMs = performance.now() - started;
        evidence.freshTargetAndImportMs =
          performance.now() - baselineCapturedMs;
        const client = await connect(connectionString, true);
        try {
          assert.equal(
            (
              await client.query(
                "SELECT count(*)::text AS count FROM openmeld.users"
              )
            ).rows[0].count,
            "262"
          );
          assert.equal(
            (
              await client.query(
                "SELECT name FROM openmeld.users WHERE id=$1",
                [fixture.owner]
              )
            ).rows[0].name,
            fixture.text
          );
          const credentials = (
            await client.query(
              "SELECT password,access_token,refresh_token,scope FROM openmeld.accounts WHERE user_id=$1",
              [fixture.owner]
            )
          ).rows[0];
          assert.equal(
            await verifyPassword({
              password: fixture.password,
              hash: credentials.password,
            }),
            true
          );
          assert.equal(credentials.access_token, fixture.envelope);
          assert.equal(credentials.refresh_token, "\\N");
          assert.equal(credentials.scope, "");
          assert.equal(
            (
              await client.query(
                "SELECT name_key FROM openmeld.organization_document_folders WHERE id='child'"
              )
            ).rows[0].name_key,
            "child"
          );
          assert.deepEqual(
            (
              await client.query(
                'SELECT owner_kind FROM openmeld."openMeldDaemon_agent_profile_bindings" ORDER BY owner_kind'
              )
            ).rows.map((row) => row.owner_kind),
            ["organization", "owner_account"]
          );
          for (const kind of ["owner_account", "organization"]) {
            await assert.rejects(
              client.query(
                "UPDATE openmeld.\"openMeldDaemon_agent_profile_bindings\" SET owner_id='wrong-owner' WHERE owner_kind=$1",
                [kind]
              ),
              { code: "23514" }
            );
            await assert.rejects(
              source
                .prepare(
                  "UPDATE openMeldDaemon_agent_profile_bindings SET owner_id='wrong-owner' WHERE owner_kind=?"
                )
                .bind(kind)
                .run(),
              ownerGuardError
            );
          }
          assert.deepEqual(
            (
              await client.query(
                "SELECT id,sequence::text,read_at_ms IS NOT NULL AS read,cleared_at_ms IS NOT NULL AS cleared FROM openmeld.inbox_items ORDER BY sequence"
              )
            ).rows,
            [
              { id: "unread", sequence: "71", read: false, cleared: false },
              { id: "read", sequence: "73", read: true, cleared: false },
              { id: "cleared", sequence: "79", read: true, cleared: true },
            ]
          );
          await client.query(
            "INSERT INTO openmeld.inbox_items(id,organization_id,recipient_user_id,kind,attention,importance,title,preview,source_kind,source_key,source_target_json,resolution_status,occurred_at_ms,created_at_ms,updated_at_ms) SELECT 'arrival',organization_id,recipient_user_id,kind,attention,importance,title,preview,source_kind,'arrival',source_target_json,resolution_status,occurred_at_ms,created_at_ms,updated_at_ms FROM openmeld.inbox_items WHERE id='unread'"
          );
          assert.equal(
            (
              await client.query(
                "SELECT sequence::text FROM openmeld.inbox_items WHERE id='arrival'"
              )
            ).rows[0].sequence,
            "901"
          );
          assert.equal(
            (
              await client.query(
                "SELECT count(*)::text AS count FROM openmeld.inbox_items WHERE id='arrival' AND sequence <= (SELECT through_row_id FROM openmeld.inbox_feed_snapshots WHERE id='page')"
              )
            ).rows[0].count,
            "0"
          );
          assert.equal(
            (
              await client.query(
                "SELECT nextval(pg_get_serial_sequence('openmeld.agent_activity_events','accepted_sequence'))::text AS next"
              )
            ).rows[0].next,
            "701"
          );
          await assert.rejects(
            importD1Snapshot({ snapshot, connectionString }),
            populatedTargetError
          );
          evidence.cases.push(
            "business_data_and_owner_guards",
            "inbox_deleted_tail_900_to_901",
            "autoincrement_deleted_tail_700_to_701",
            "populated_target_rejected"
          );
        } finally {
          await client.end();
        }
      }
    );

    await t.test(
      "source inventory and stored types fail closed without leaving a snapshot",
      async () => {
        for (const [name, mutation, recovery, pattern] of [
          [
            "unknown_table",
            "CREATE TABLE migration_unknown(id TEXT)",
            "DROP TABLE migration_unknown",
            inventoryError,
          ],
          [
            "stored_blob",
            "UPDATE users SET name=X'80' WHERE id='page-000'",
            "UPDATE users SET name='Page 0' WHERE id='page-000'",
            storedValueError,
          ],
          [
            "invalid_utf8",
            "UPDATE users SET name=CAST(X'80' AS TEXT) WHERE id='page-000'",
            "UPDATE users SET name='Page 0' WHERE id='page-000'",
            storedValueError,
          ],
          [
            "nul_text",
            "UPDATE users SET name=CAST(X'610062' AS TEXT) WHERE id='page-000'",
            "UPDATE users SET name='Page 0' WHERE id='page-000'",
            nulTextError,
          ],
        ]) {
          await source.prepare(mutation).run();
          try {
            await assert.rejects(capture(name), pattern);
            await assert.rejects(readFile(path.join(root, `${name}.sqlite`)), {
              code: "ENOENT",
            });
            evidence.cases.push(name);
          } finally {
            await source.prepare(recovery).run();
          }
        }
      }
    );

    await t.test(
      "exact 64-bit capture rejects unsafe product values and rolls back identity advancement",
      async () => {
        for (const [name, mutation, recovery, pattern] of [
          [
            "unsafe_integer",
            "UPDATE users SET created_at=9007199254740993 WHERE id='page-000'",
            "UPDATE users SET created_at=1 WHERE id='page-000'",
            safeRangeError,
          ],
          [
            "identity_restart",
            "UPDATE inbox_feed_snapshots SET through_row_id=9007199254740991 WHERE id='page'",
            "UPDATE inbox_feed_snapshots SET through_row_id=900 WHERE id='page'",
            safeRangeError,
          ],
        ]) {
          await source.prepare(mutation).run();
          try {
            await capture(name);
            const input = path.join(root, `${name}.sqlite`);
            if (name === "unsafe_integer") {
              const archived = new DatabaseSync(input, { readOnly: true });
              try {
                assert.equal(
                  archived
                    .prepare(
                      "SELECT CAST(created_at AS TEXT) AS value FROM users WHERE id='page-000'"
                    )
                    .get().value,
                  "9007199254740993"
                );
              } finally {
                archived.close();
              }
            }
            const connectionString = await freshTarget(admin, targetIndex++);
            await assert.rejects(
              importD1Snapshot({ snapshot: input, connectionString }),
              pattern
            );
            assert.deepEqual(
              await tableCounts(connectionString, manifest.tables),
              manifest.tables.map(() => "0")
            );
            const client = await connect(connectionString, true);
            try {
              assert.equal(
                (
                  await client.query(
                    "SELECT nextval(pg_get_serial_sequence('openmeld.agent_activity_events','accepted_sequence'))::text AS next"
                  )
                ).rows[0].next,
                "1"
              );
            } finally {
              await client.end();
            }
            evidence.cases.push(`${name}_full_rollback`);
          } finally {
            await source.prepare(recovery).run();
          }
        }
      }
    );

    await t.test(
      "native constraint and value reconciliation failures roll back earlier tables",
      async () => {
        for (const [name, mutation, pattern] of [
          [
            "constraint",
            "ALTER TABLE openmeld.users ADD CONSTRAINT migration_test_reject CHECK(id <> 'page-000')",
            constraintError,
          ],
          [
            "reconciliation",
            "CREATE FUNCTION openmeld.migration_test_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.name := NEW.name || 'changed'; RETURN NEW; END $$; CREATE TRIGGER migration_test_change BEFORE INSERT ON openmeld.users FOR EACH ROW EXECUTE FUNCTION openmeld.migration_test_change()",
            reconciliationError,
          ],
        ]) {
          const connectionString = await freshTarget(admin, targetIndex++);
          const client = await connect(connectionString, true);
          try {
            await client.query(mutation);
          } finally {
            await client.end();
          }
          await assert.rejects(
            importD1Snapshot({ snapshot, connectionString }),
            pattern
          );
          assert.deepEqual(
            await tableCounts(connectionString, manifest.tables),
            manifest.tables.map(() => "0")
          );
          evidence.cases.push(`${name}_full_rollback`);
        }
      }
    );

    await t.test(
      "process interruption during real COPY leaves the target empty and retryable",
      async () => {
        const connectionString = await freshTarget(admin, targetIndex++);
        const client = await connect(connectionString, true);
        try {
          await client.query(
            "CREATE FUNCTION openmeld.migration_test_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.02); RETURN NEW; END $$; CREATE TRIGGER migration_test_slow BEFORE INSERT ON openmeld.users FOR EACH ROW EXECUTE FUNCTION openmeld.migration_test_slow()"
          );
        } finally {
          await client.end();
        }
        const script = `import {importD1Snapshot} from ${JSON.stringify(new URL("./d1-import.mjs", import.meta.url).href)}; await importD1Snapshot({snapshot:process.env.SNAPSHOT,connectionString:process.env.TARGET});`;
        const child = spawn(
          process.execPath,
          ["--input-type=module", "-e", script],
          {
            stdio: "ignore",
            env: {
              ...process.env,
              SNAPSHOT: snapshot,
              TARGET: connectionString,
            },
          }
        );
        const closed = new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        });
        try {
          await waitForCopy(
            admin,
            new URL(connectionString).pathname.slice(1),
            child
          );
          child.kill("SIGTERM");
          assert.equal((await closed).signal, "SIGTERM");
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
            await closed;
          }
        }
        assert.deepEqual(
          await tableCounts(connectionString, manifest.tables),
          manifest.tables.map(() => "0")
        );
        const resumed = await connect(connectionString, true);
        try {
          await resumed.query(
            "DROP TRIGGER migration_test_slow ON openmeld.users; DROP FUNCTION openmeld.migration_test_slow()"
          );
        } finally {
          await resumed.end();
        }
        assert.equal(
          (await importD1Snapshot({ snapshot, connectionString })).status,
          "committed_and_reconciled"
        );
        evidence.cases.push("interrupted_copy_full_rollback_and_clean_retry");
      }
    );
    if (evidence.cases.length !== 13) {
      throw new Error(
        "Migration cases failed; no successful rehearsal receipt written"
      );
    }
    evidence.status = "database_rehearsal_passed";
    evidence.durationMs = performance.now() - started;
    evidence.sourceRows = manifest.tables.reduce(
      (total, table) => total + Number(table.rows),
      0
    );
    evidence.populatedTables = manifest.tables.filter(
      (table) => table.rows !== "0"
    ).length;
    await writeFile(
      path.join(root, "receipt.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { mode: 0o600 }
    );
    console.log(
      JSON.stringify({
        root,
        sourceRows: evidence.sourceRows,
        populatedTables: evidence.populatedTables,
        inventoriedTables: manifest.tables.length,
        cases: evidence.cases,
        durationMs: evidence.durationMs,
      })
    );
  } finally {
    await mf?.dispose();
    await admin?.end();
    if (!process.env.OPENMELD_D1_REHEARSAL_OUTPUT) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
