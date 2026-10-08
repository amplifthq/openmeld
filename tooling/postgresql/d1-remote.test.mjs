import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCutoverDataCommand, verifyRuntimeGrants } from "./cutover.mjs";
import { importD1Snapshot } from "./d1-import.mjs";
import { rehearseFrozenD1Capture } from "./d1-maintenance.test-support.mjs";
import { createRemoteD1Source } from "./d1-remote.mjs";
import { captureD1Snapshot } from "./d1-snapshot.mjs";
import {
  connect,
  grantRuntime,
  migrate,
  quoteIdentifier,
} from "./database.mjs";
import { readCutoverTarget, verifyRemoteCredential } from "./remote-target.mjs";

const identity = {
  kind: "cloudflare-d1",
  accountId: "a".repeat(32),
  databaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const targetMismatch = /registered cutover target/u;
const sourceMismatch = /different D1 source/u;
const invalidResponse = /invalid query result/u;
const requestFailure = /HTTP (401|429|500).*no automatic retry/u;
const missingMaintenance = /maintenance identity/u;
const mismatchedIdentity = /source identity mismatch/u;
const runtimeGrantMismatch = /runtime grants differ/u;

test("remote D1 transport preserves typed cells and binds only the selected source", async () => {
  let calls = 0;
  // Official Query D1 Database response: result[] contains success, results,
  // and optional meta. Cells are the existing typed SQL projection, not JS ints.
  // https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
  const rows = [{ source_rowid: "9007199254740993", v0: '["text","5C4E"]' }];
  const source = createRemoteD1Source({
    identity,
    token: "synthetic-scoped-token",
    request: (url, options) => {
      calls += 1;
      assert.equal(
        url,
        `https://api.cloudflare.com/client/v4/accounts/${identity.accountId}/d1/database/${identity.databaseId}/query`
      );
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers.Authorization,
        "Bearer synthetic-scoped-token"
      );
      assert.deepEqual(JSON.parse(options.body), {
        sql: "SELECT rowid FROM users WHERE rowid > ?",
        params: ["9007199254740992"],
      });
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result: [{ success: true, results: rows, meta: { changed_db: false } }],
      });
    },
  });
  assert.deepEqual(
    (
      await source
        .prepare("SELECT rowid FROM users WHERE rowid > ?")
        .bind("9007199254740992")
        .all()
    ).results,
    rows
  );
  assert.equal(calls, 1);
});

test("remote D1 errors, incomplete envelopes and unexpected writes stop capture without retries", async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const source = createRemoteD1Source({
      identity,
      token: "synthetic",
      request: () => {
        calls += 1;
        return new Response("private response must not enter diagnostics", {
          status,
        });
      },
    });
    await assert.rejects(
      source.prepare("SELECT 1").bind().all(),
      requestFailure
    );
    assert.equal(calls, 1);
  }
  for (const body of [
    null,
    { success: false },
    { success: true, result: [] },
    {
      success: true,
      result: [{ success: true, results: [], meta: { changed_db: true } }],
    },
  ]) {
    const source = createRemoteD1Source({
      identity,
      token: "synthetic",
      request: () => Response.json(body),
    });
    await assert.rejects(
      source.prepare("SELECT 1").bind().all(),
      invalidResponse
    );
  }
});

test("cutover planning is offline and credentials cannot select another target or override TLS", async () => {
  const registered = await readCutoverTarget();
  const plan = await runCutoverDataCommand(["plan"]);
  assert.equal(plan.productionOperationExecuted, false);
  assert.deepEqual(plan.source, registered.source);
  const credential = new URL(
    `postgresql://${registered.target.host}:5432/postgres`
  );
  credential.username = `${registered.migrationRole}.${registered.target.branchId}`;
  credential.password = "synthetic";
  assert.doesNotThrow(() =>
    verifyRemoteCredential(credential.toString(), registered)
  );
  for (const changes of [
    { hostname: "another.pg.psdb.cloud" },
    { username: `${registered.runtimeRole}.${registered.target.branchId}` },
    { pathname: "/other" },
    { port: "6432" },
    { search: "?sslmode=disable" },
    { hash: "#other" },
  ]) {
    const changed = new URL(credential);
    Object.assign(changed, changes);
    assert.throws(
      () => verifyRemoteCredential(changed.toString(), registered),
      targetMismatch
    );
  }
});

test("remote capture requires exact source and frozen maintenance identity before opening files", async () => {
  const source = { identity };
  await assert.rejects(
    captureD1Snapshot({ source, identity, destination: "must-not-open" }),
    missingMaintenance
  );
  await assert.rejects(
    captureD1Snapshot({
      source,
      identity: { ...identity, accountId: "b".repeat(32) },
      maintenanceId: "maintenance",
      destination: "must-not-open",
    }),
    mismatchedIdentity
  );
});

test("identified remote capture reuses actual frozen D1 to local PG import and rejects another production source", async () => {
  assert.equal(
    process.env.OPENMELD_PG_ISOLATED,
    "1",
    "Run through tooling/postgresql/local.mjs run"
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "openmeld-remote-d1-"));
  const connectionString = process.env.POSTGRESQL_OPENMELD_MIGRATION_URL;
  const client = await connect(connectionString, true);
  try {
    await migrate(client);
    const role = process.env.POSTGRESQL_OPENMELD_RUNTIME_ROLE;
    await grantRuntime(client, role);
    await verifyRuntimeGrants(client, role);
    await client.query(
      `GRANT TRUNCATE ON openmeld.users TO ${quoteIdentifier(role)}`
    );
    await assert.rejects(
      verifyRuntimeGrants(client, role),
      runtimeGrantMismatch
    );
    await client.query(
      `REVOKE TRUNCATE ON openmeld.users FROM ${quoteIdentifier(role)}`
    );
    const result = await rehearseFrozenD1Capture({
      root,
      connectionString,
      sourceIdentity: identity,
    });
    assert.deepEqual(result.capture.identity, identity);
    assert.equal(result.imported.status, "committed_and_reconciled");
    assert.ok(
      result.imported.tables.some(
        ({ table, rows }) => table === "users" && rows === 262
      )
    );
    const manifest = JSON.parse(
      await readFile(path.join(root, "frozen.sqlite.json"), "utf8")
    );
    assert.equal(
      manifest.maintenance.maintenanceId,
      result.capture.maintenance.maintenanceId
    );
    const registered = await readCutoverTarget();
    const credential = `postgresql://${registered.migrationRole}.${registered.target.branchId}:synthetic@${registered.target.host}:5432/postgres`;
    await assert.rejects(
      importD1Snapshot({
        snapshot: path.join(root, "frozen.sqlite"),
        destination: "production",
        connectionString: credential,
      }),
      sourceMismatch
    );
  } finally {
    await client.end();
    await rm(root, { recursive: true, force: true });
  }
});
