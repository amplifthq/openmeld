// biome-ignore-all lint/suspicious/noMisplacedAssertion: Called by the native D1 rehearsal's node:test case; assertions inspect actual isolated D1 and PostgreSQL.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  D1_MAINTENANCE_CATALOG_QUERY,
  D1_MAINTENANCE_LEDGER,
  prepareD1MaintenanceMigration,
  readD1MaintenanceSource,
} from "../../scripts/release/d1-maintenance-barrier.mjs";
import { importD1Snapshot } from "./d1-import.mjs";
import { createLocalD1FromSqlite } from "./d1-local-fixture.mjs";
import { createD1RehearsalFixture, fixture } from "./d1-rehearsal-fixture.mjs";
import { captureD1Snapshot } from "./d1-snapshot.mjs";
import { connect } from "./database.mjs";

const maintenanceError = /openmeld\.database_maintenance/u;
const inventoryError = /table inventory/u;
const maintenanceIdentityError = /maintenance identity/u;
const barrierError = /inventory or maintenance rule definition differs/u;

export async function rehearseFrozenD1Capture({
  root,
  connectionString,
  sourceIdentity,
}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const input = path.join(root, "fixture.sqlite");
  const { now } = await createD1RehearsalFixture(input);
  let runtime = await createLocalD1FromSqlite(input, root);
  let client;
  try {
    const source = await runtime.getD1Database("SOURCE");
    const history = await readD1MaintenanceSource(
      fileURLToPath(new URL("../../", import.meta.url))
    );
    const maintenanceId = randomUUID();
    const install = await prepareD1MaintenanceMigration({
      root,
      source: history,
      catalog: (await source.prepare(D1_MAINTENANCE_CATALOG_QUERY).all())
        .results,
      maintenanceId,
      operationId: randomUUID(),
      operation: "install",
      target: {
        databaseName: "openmeld-d1-rehearsal",
        databaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
    await runtime.dispose();
    const applied = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "openmeld-d1-rehearsal",
        "--config",
        install.config,
        "--local",
        "--persist-to",
        path.join(root, ".wrangler/state"),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      }
    );
    assert.equal(applied.status, 0, applied.stderr);
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {}",
        resourcePersistencePath: path.join(root, ".wrangler/state/v3"),
        d1Databases: { SOURCE: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      })
    );
    const frozen = await runtime.getD1Database("SOURCE");
    await assert.rejects(
      frozen.prepare("UPDATE users SET name='Rejected'").run(),
      maintenanceError
    );
    const identity = sourceIdentity ?? {
      kind: "local-synthetic",
      id: "frozen-business-fixture",
      frozenBy:
        "verified exact local D1 maintenance barrier; no runtime attached",
    };
    const captureSource = sourceIdentity
      ? { identity, prepare: (sql) => frozen.prepare(sql) }
      : frozen;
    await assert.rejects(
      captureD1Snapshot({
        source: captureSource,
        destination: path.join(root, "missing-identity.sqlite"),
        identity,
      }),
      sourceIdentity ? maintenanceIdentityError : inventoryError
    );
    const snapshot = path.join(root, "frozen.sqlite");
    const capture = await captureD1Snapshot({
      source: captureSource,
      destination: snapshot,
      identity,
      maintenanceId,
    });
    assert.equal(capture.maintenance.guards, history.tables.length * 3);
    assert.equal(capture.maintenance.ledger.rows[0].name, install.name);
    assert.equal(
      capture.tables.some(({ name }) => name === D1_MAINTENANCE_LEDGER),
      false
    );
    const imported = await importD1Snapshot({ snapshot, connectionString });
    client = await connect(connectionString, true);
    assert.deepEqual(
      (
        await client.query(
          "SELECT state, decided_at_ms, request_json::jsonb #>> '{input,name}' AS name FROM openmeld.plugin_action_requests"
        )
      ).rows,
      [
        {
          state: "approved",
          decided_at_ms: String(now + 1000),
          name: fixture.text,
        },
      ]
    );
    assert.equal(
      (
        await client.query(
          "SELECT connection_updated_at_ms FROM openmeld.center_agent_connector_action_operations WHERE id='migration-plugin-receipt'"
        )
      ).rows[0].connection_updated_at_ms,
      String(now - 1000)
    );
    assert.equal(
      (
        await client.query("SELECT name FROM openmeld.users WHERE id=$1", [
          fixture.owner,
        ])
      ).rows[0].name,
      fixture.text
    );
    assert.equal(
      (await client.query("SELECT count(*)::text AS count FROM openmeld.users"))
        .rows[0].count,
      "262"
    );
    assert.equal(
      (
        await client.query(
          "SELECT to_regclass('openmeld.openmeld_maintenance_migrations') AS name"
        )
      ).rows[0].name,
      null
    );
    assert.equal(
      (
        await client.query(
          "SELECT nextval(pg_get_serial_sequence('openmeld.inbox_items','sequence'))::text AS next"
        )
      ).rows[0].next,
      "902"
    );
    assert.equal(
      (
        await client.query(
          "SELECT nextval(pg_get_serial_sequence('openmeld.agent_activity_events','accepted_sequence'))::text AS next"
        )
      ).rows[0].next,
      "701"
    );
    const guard = (
      await frozen
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'openmeld_maintenance_%' ORDER BY name LIMIT 1"
        )
        .first()
    ).name;
    await frozen.prepare(`DROP TRIGGER "${guard}"`).run();
    await assert.rejects(
      captureD1Snapshot({
        source: captureSource,
        destination: path.join(root, "missing-guard.sqlite"),
        identity,
        maintenanceId,
      }),
      barrierError
    );
    return {
      capture,
      imported,
      elapsedMs: Math.round(performance.now() - started),
      runtimeDrain: "not_claimed_by_database_rehearsal",
    };
  } finally {
    await client?.end();
    await runtime.dispose();
  }
}
