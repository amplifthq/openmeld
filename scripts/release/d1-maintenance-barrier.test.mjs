import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildD1MaintenanceGuards,
  inspectD1MaintenanceBarrier,
  readD1MaintenanceSource,
} from "./d1-maintenance-barrier.mjs";

// Exact sqlite_schema definitions captured from production D1 on 2026-10-04
// after the normal db:release:prod owner applied migrations and PRAGMA optimize.
const productionControls = [
  {
    type: "table",
    name: "_cf_KV",
    tbl_name: "_cf_KV",
    sql: "CREATE TABLE _cf_KV (\n        key TEXT PRIMARY KEY,\n        value BLOB\n      ) WITHOUT ROWID",
  },
  {
    type: "table",
    name: "sqlite_stat1",
    tbl_name: "sqlite_stat1",
    sql: "CREATE TABLE sqlite_stat1(tbl,idx,stat)",
  },
];
const maintenanceId = "07581561-ef44-4aa7-87af-b61f73bf1e44";
const drift = /schema drift|inventory or maintenance rule definition differs/u;

test("production D1 platform objects are preserved while unknown objects and altered guards fail closed", async () => {
  const source = await readD1MaintenanceSource(
    fileURLToPath(new URL("../../", import.meta.url))
  );
  const catalog = [...source.catalog, ...productionControls];
  const open = inspectD1MaintenanceBarrier({
    source,
    catalog,
    maintenanceId,
    state: "open",
  });
  assert.equal(open.tables, source.tables.length);
  assert.equal(open.guards, 0);
  const guards = buildD1MaintenanceGuards(source, maintenanceId);
  const frozen = [...catalog, ...guards];
  assert.equal(
    inspectD1MaintenanceBarrier({
      source,
      catalog: frozen,
      maintenanceId,
      state: "frozen",
    }).guards,
    source.tables.length * 3
  );
  for (const control of productionControls) {
    assert.throws(
      () =>
        inspectD1MaintenanceBarrier({
          source,
          catalog: catalog.map((row) =>
            row === control ? { ...row, sql: `${row.sql} /* changed */` } : row
          ),
          maintenanceId,
          state: "open",
        }),
      drift
    );
  }
  for (const [invalid, state] of [
    [
      [
        ...catalog,
        {
          type: "table",
          name: "_cf_unknown",
          tbl_name: "_cf_unknown",
          sql: "CREATE TABLE _cf_unknown(id)",
        },
      ],
      "open",
    ],
    [frozen.slice(0, -1), "frozen"],
  ]) {
    assert.throws(
      () =>
        inspectD1MaintenanceBarrier({
          source,
          catalog: invalid,
          maintenanceId,
          state,
        }),
      drift
    );
  }
});
