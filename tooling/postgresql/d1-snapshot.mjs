import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { postgresqlD1MaintenanceCaptureSchema } from "../../packages/schemas/src/schemas/release/postgresql-import.ts";
import {
  D1_MAINTENANCE_CATALOG_QUERY,
  D1_MAINTENANCE_LEDGER,
  inspectD1MaintenanceBarrier,
} from "../../scripts/release/d1-maintenance-barrier.mjs";
import { quoteIdentifier as quote } from "./database.mjs";

const history = new URL("../../packages/db/drizzle/", import.meta.url);
const internalTables = new Set(["d1_migrations", "sqlite_sequence"]);
const decimal = /^-?\d+$/u;
const hex = /^(?:[0-9A-F]{2})*$/u;
// These immediate owner triggers query Profiles without a declared foreign key.
// Keep both SQLite and native PostgreSQL owner checks enabled during import.
const triggerDependencies = {
  openMeldDaemon_agent_profile_bindings: ["openmeld_profiles"],
};

export function requireEqual(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) {
    // Unlike assertion errors, diagnostics must never include source values.
    throw new Error(message);
  }
}

function applicationTable(name) {
  return !(
    name.startsWith("sqlite_") ||
    name.startsWith("_cf_") ||
    internalTables.has(name)
  );
}

/** SQLite executes the immutable history; no SQL translation or parser. */
export async function createHistoricalD1Database(path = ":memory:") {
  const database = new DatabaseSync(path);
  const digest = createHash("sha256");
  try {
    for (const name of (await readdir(history))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(new URL(name, history), "utf8");
      digest.update(name).update("\0").update(sql).update("\0");
      database.exec(sql);
    }
    return { database, historySha256: digest.digest("hex") };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function readD1Catalog(database) {
  return database
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all()
    .filter(({ name }) => applicationTable(name))
    .map(({ name }) => {
      const columns = database
        .prepare(`PRAGMA table_xinfo(${quote(name)})`)
        .all();
      const indexes = database
        .prepare(`PRAGMA index_list(${quote(name)})`)
        .all()
        .map((index) => ({
          ...index,
          columns: database
            .prepare(`PRAGMA index_info(${quote(index.name)})`)
            .all()
            .map((column) => column.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const primary = columns
        .filter((column) => column.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name);
      const key = primary.length
        ? primary
        : indexes.find(
            (index) =>
              index.unique &&
              !index.partial &&
              index.columns.every(
                (column) =>
                  columns.find((candidate) => candidate.name === column)
                    ?.notnull
              )
          )?.columns;
      if (!key?.length) {
        throw new Error(`Missing non-null unique migration key: ${name}`);
      }
      return {
        name,
        columns,
        key,
        foreignKeys: database
          .prepare(`PRAGMA foreign_key_list(${quote(name)})`)
          .all()
          .map((row) => ({ ...row })),
      };
    });
}

export function orderD1Tables(catalog) {
  const ordered = [];
  const pending = new Map(catalog.map((table) => [table.name, table]));
  while (pending.size) {
    const ready = [...pending.values()].filter((table) =>
      [
        ...table.foreignKeys.map((key) => key.table),
        ...(triggerDependencies[table.name] ?? []),
      ].every(
        (dependency) =>
          dependency === table.name ||
          ordered.some((prior) => prior.name === dependency)
      )
    );
    if (!ready.length) {
      throw new Error("Unreviewed cross-table foreign-key cycle");
    }
    for (const table of ready) {
      ordered.push(table);
      pending.delete(table.name);
    }
  }
  return ordered;
}

export async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function columnContract(columns) {
  return columns.map(({ name, type, notnull, pk, hidden }) => ({
    name,
    type,
    notnull,
    pk,
    hidden,
  }));
}

export function canonicalRow(values) {
  return JSON.stringify(
    values.map((value) =>
      value === null
        ? null
        : [typeof value === "bigint" ? "integer" : "text", String(value)]
    )
  );
}

function decodeCell(row, column, index, table) {
  const [type, encoded] = JSON.parse(row[`v${index}`]);
  if (type === "null") {
    return null;
  }
  if (
    column.type === "INTEGER" &&
    type === "integer" &&
    decimal.test(encoded)
  ) {
    return BigInt(encoded);
  }
  if (column.type === "TEXT" && type === "text" && hex.test(encoded)) {
    const bytes = Buffer.from(encoded, "hex");
    const value = bytes.toString("utf8");
    if (value.includes("\0")) {
      throw new Error(
        `PostgreSQL cannot preserve NUL text: ${table}.${column.name}`
      );
    }
    if (Buffer.from(value).equals(bytes)) {
      return value;
    }
  }
  // Do not print values: source cells can contain credentials or private text.
  throw new Error(`Unsupported stored value at ${table}.${column.name}`);
}

async function captureTable(query, database, table) {
  const columns = await query(`PRAGMA table_xinfo(${quote(table.name)})`);
  requireEqual(
    columnContract(columns),
    columnContract(table.columns),
    `D1 column contract changed: ${table.name}`
  );
  requireEqual(
    await query(`PRAGMA foreign_key_list(${quote(table.name)})`),
    table.foreignKeys,
    `D1 foreign keys changed: ${table.name}`
  );
  const writable = columns.filter((column) => column.hidden === 0);
  // Capture generated cells as well: the archival engine must reproduce the
  // source value, not merely agree with its own generated expression.
  const expressions = columns.map(
    (column, index) =>
      `json_array(typeof(${quote(column.name)}),${column.type === "TEXT" ? `hex(CAST(${quote(column.name)} AS BLOB))` : `CAST(${quote(column.name)} AS TEXT)`}) AS v${index}`
  );
  const insert = database.prepare(
    `INSERT INTO ${quote(table.name)} (rowid,${writable.map((column) => quote(column.name)).join(",")}) VALUES (${new Array(
      writable.length + 1
    )
      .fill("?")
      .join(",")})`
  );
  const expected = (
    await query(
      `SELECT CAST(count(*) AS TEXT) AS count FROM ${quote(table.name)}`
    )
  )[0].count;
  let after;
  let count = 0n;
  const sourceHash = createHash("sha256");
  while (true) {
    const rows = await query(
      `SELECT CAST(rowid AS TEXT) AS source_rowid,${expressions.join(",")} FROM ${quote(table.name)} ${after === undefined ? "" : "WHERE rowid > ?"} ORDER BY rowid LIMIT 128`,
      after === undefined ? [] : [after]
    );
    if (!rows.length) {
      break;
    }
    for (const row of rows) {
      const values = columns.map((column, index) =>
        decodeCell(row, column, index, table.name)
      );
      insert.run(
        BigInt(row.source_rowid),
        ...values.filter((_, index) => columns[index].hidden === 0)
      );
      sourceHash
        .update(canonicalRow([BigInt(row.source_rowid), ...values]))
        .update("\n");
      after = row.source_rowid;
      count += 1n;
    }
  }
  if (String(count) !== expected) {
    throw new Error(`D1 capture count mismatch: ${table.name}`);
  }
  const snapshotHash = createHash("sha256");
  const archived = database.prepare(
    `SELECT rowid AS source_rowid,${columns.map((column) => quote(column.name)).join(",")} FROM ${quote(table.name)} ORDER BY rowid`
  );
  archived.setReadBigInts(true);
  for (const row of archived.iterate()) {
    snapshotHash
      .update(
        canonicalRow([
          row.source_rowid,
          ...columns.map((column) => row[column.name]),
        ])
      )
      .update("\n");
  }
  const rowSha256 = sourceHash.digest("hex");
  if (snapshotHash.digest("hex") !== rowSha256) {
    throw new Error(`D1 archival value mismatch: ${table.name}`);
  }
  return { name: table.name, rows: expected, rowSha256 };
}

async function captureMetadata(query, database) {
  // Deleted AUTOINCREMENT keys remain high-water marks. This metadata never
  // replaces the native PostgreSQL Drizzle ledger.
  const sequences = (
    await query(
      "SELECT name,typeof(seq) AS stored_type,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name"
    )
  ).map(({ name, stored_type, seq }) => {
    if (stored_type !== "integer" || !decimal.test(seq)) {
      throw new Error(`Unsupported sqlite_sequence value: ${name}`);
    }
    return { name, seq };
  });
  database.exec("DELETE FROM sqlite_sequence");
  for (const { name, seq } of sequences) {
    database
      .prepare("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)")
      .run(name, BigInt(seq));
  }
  const ledger = await query(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name='d1_migrations'"
  );
  if (ledger.length) {
    database.exec(
      "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY NOT NULL,name TEXT NOT NULL,applied_at TEXT NOT NULL)"
    );
    for (const row of await query(
      "SELECT CAST(id AS TEXT) AS id,name,applied_at FROM d1_migrations ORDER BY id"
    )) {
      database
        .prepare("INSERT INTO d1_migrations VALUES(?,?,?)")
        .run(BigInt(row.id), row.name, row.applied_at);
    }
  }
  return sequences;
}

/** Remote capture requires a separately authorized, verified stopped source. */
export async function captureD1Snapshot({
  source,
  destination,
  identity,
  maintenanceId,
}) {
  if (
    process.env.OPENMELD_PG_ISOLATED !== "1" ||
    identity.kind !== "local-synthetic"
  ) {
    throw new Error(
      "Only isolated synthetic D1 capture is enabled; production capture is unavailable"
    );
  }
  const handle = await open(destination, "wx", 0o600);
  await handle.close();
  let database;
  let completed = false;
  const query = async (sql, params = []) => {
    const result = await source
      .prepare(sql)
      .bind(...params)
      .all();
    if (!result.success) {
      throw new Error("D1 snapshot query failed");
    }
    return result.results;
  };
  try {
    const historical = await createHistoricalD1Database(destination);
    database = historical.database;
    const catalog = readD1Catalog(database);
    const maintenanceSource = {
      catalog: database
        .prepare(D1_MAINTENANCE_CATALOG_QUERY)
        .all()
        .map((row) => ({ ...row })),
      tables: catalog.map(({ name }) => name),
    };
    const actualSchema = await query(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name"
    );
    const readMaintenance = async (schema) => {
      const inspection = inspectD1MaintenanceBarrier({
        source: maintenanceSource,
        catalog: schema.filter(({ sql }) => sql !== null),
        maintenanceId,
        state: "frozen",
      });
      return postgresqlD1MaintenanceCaptureSchema.parse({
        ...inspection,
        maintenanceId,
        ledger: {
          schema: schema.find(({ name }) => name === D1_MAINTENANCE_LEDGER)
            ?.sql,
          rows: await query(
            `SELECT CAST(id AS TEXT) AS id,name,applied_at FROM ${quote(D1_MAINTENANCE_LEDGER)} ORDER BY id`
          ),
        },
      });
    };
    const maintenance = maintenanceId
      ? await readMaintenance(actualSchema)
      : undefined;
    const sourceSchema = actualSchema.filter((entry) =>
      applicationTable(entry.tbl_name)
    );
    const sourceNames = sourceSchema
      .filter(
        (entry) =>
          entry.type === "table" &&
          !(maintenance && entry.name === D1_MAINTENANCE_LEDGER)
      )
      .map(({ name }) => name);
    requireEqual(
      sourceNames,
      catalog.map(({ name }) => name),
      "D1 table inventory differs from reviewed history"
    );
    const tables = [];
    database.exec("BEGIN; PRAGMA defer_foreign_keys=ON;");
    for (const table of orderD1Tables(catalog)) {
      tables.push(await captureTable(query, database, table));
    }
    const sequences = await captureMetadata(query, database);
    requireEqual(
      database.prepare("PRAGMA foreign_key_check").all(),
      [],
      "D1 snapshot has foreign-key violations"
    );
    if (maintenance) {
      requireEqual(
        await readMaintenance(
          await query(
            "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name"
          )
        ),
        maintenance,
        "D1 maintenance evidence changed during capture"
      );
    }
    database.exec("COMMIT");
    database.close();
    database = undefined;
    const manifest = {
      version: 1,
      identity,
      historySha256: historical.historySha256,
      sourceSchemaSha256: createHash("sha256")
        .update(JSON.stringify(sourceSchema))
        .digest("hex"),
      snapshotSha256: await fileSha256(destination),
      tables,
      sequences,
      ...(maintenance ? { maintenance } : {}),
    };
    await writeFile(
      `${destination}.json`,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx", mode: 0o600 }
    );
    await chmod(destination, 0o400);
    completed = true;
    return manifest;
  } finally {
    database?.close();
    if (!completed) {
      await rm(destination, { force: true });
    }
  }
}
