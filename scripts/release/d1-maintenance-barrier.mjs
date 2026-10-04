import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

export const D1_MAINTENANCE_LEDGER = "openmeld_maintenance_migrations";
export const D1_MAINTENANCE_ERROR = "openmeld.database_maintenance";
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sort = (rows) =>
  [...rows].sort((a, b) => {
    if (a.name < b.name) {
      return -1;
    }
    return a.name > b.name ? 1 : 0;
  });
export const D1_MAINTENANCE_CATALOG_QUERY =
  "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name";

// Wrangler owns these ledger shapes. This separate maintenance ledger never
// joins the ordinary automatic business migration directory or pending set.
function ledgerSql(name) {
  return `CREATE TABLE ${quote(name)}(
\t\tid         INTEGER PRIMARY KEY AUTOINCREMENT,
\t\tname       TEXT UNIQUE,
\t\tapplied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;
}

function sqliteCatalog(database) {
  return database
    .prepare(D1_MAINTENANCE_CATALOG_QUERY)
    .all()
    .map((row) => ({ ...row }));
}

export async function readD1MaintenanceSource(repoRoot) {
  const directory = path.join(repoRoot, "packages/db/drizzle");
  const database = new DatabaseSync(":memory:");
  const digest = createHash("sha256");
  try {
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(path.join(directory, name), "utf8");
      digest.update(name).update("\0").update(sql).update("\0");
      database.exec(sql);
    }
    const catalog = sqliteCatalog(database);
    return {
      historySha256: digest.digest("hex"),
      schemaSha256: hash(JSON.stringify(catalog)),
      catalog,
      tables: catalog
        .filter(
          ({ type, name }) => type === "table" && name !== "sqlite_sequence"
        )
        .map(({ name }) => name),
    };
  } finally {
    database.close();
  }
}

function controlCatalog() {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(ledgerSql("d1_migrations"));
    database.exec(ledgerSql(D1_MAINTENANCE_LEDGER));
    // Captured from Wrangler 4.147.0's actual local D1 sqlite_schema. Unknown
    // platform objects still fail closed; this is not a prefix exclusion.
    database.exec(`CREATE TABLE _cf_METADATA (
        key INTEGER PRIMARY KEY,
        value BLOB
      )`);
    return sqliteCatalog(database).filter(
      ({ name }) => name !== "sqlite_sequence"
    );
  } finally {
    database.close();
  }
}

export function buildD1MaintenanceGuards(source, maintenanceId) {
  if (!UUID.test(maintenanceId)) {
    throw new Error("Maintenance identity must be a UUID v4");
  }
  return source.tables.flatMap((table, index) =>
    ["INSERT", "UPDATE", "DELETE"].map((operation) => {
      const name = `openmeld_maintenance_${maintenanceId.replaceAll("-", "")}_${index}_${operation.toLowerCase()}`;
      return {
        type: "trigger",
        name,
        tbl_name: table,
        sql: `CREATE TRIGGER ${quote(name)} BEFORE ${operation} ON ${quote(table)} BEGIN SELECT RAISE(ABORT, '${D1_MAINTENANCE_ERROR}'); END`,
      };
    })
  );
}

export function inspectD1MaintenanceBarrier({
  source,
  catalog,
  maintenanceId,
  state,
}) {
  if (!["open", "frozen"].includes(state)) {
    throw new Error("Unknown barrier state");
  }
  const controls = controlCatalog();
  const presentControls = [];
  for (const control of controls) {
    const actual = catalog.find(({ name }) => name === control.name);
    if (actual) {
      if (!isDeepStrictEqual(actual, control)) {
        throw new Error(
          `Maintenance/platform ledger schema drift: ${control.name}`
        );
      }
      presentControls.push(control);
    }
  }
  const guards =
    state === "frozen" ? buildD1MaintenanceGuards(source, maintenanceId) : [];
  const expected = sort([...source.catalog, ...presentControls, ...guards]);
  if (!isDeepStrictEqual(sort(catalog), expected)) {
    throw new Error(
      "D1 application inventory or maintenance rule definition differs; preserve state and inspect"
    );
  }
  return {
    state,
    tables: source.tables.length,
    guards: guards.length,
    catalogSha256: hash(JSON.stringify(expected)),
  };
}

// The assertions and every guard change run inside one official migration file.
// Exact object definitions plus total count reject unexpected DDL between the
// read-only preflight and mutation; no SQL parser or live-query wrapper is used.
function catalogAssertions(catalog) {
  // D1 forbids TEMP tables. This scratch table is created and removed inside
  // the same transactional migration, so it never survives commit or failure.
  const temporary = '"openmeld_maintenance_assertion"';
  const statements = [
    `CREATE TABLE ${temporary}(valid INTEGER CHECK(valid=1))`,
    `INSERT INTO ${temporary} SELECT CASE WHEN (SELECT count(*) FROM sqlite_schema WHERE sql IS NOT NULL)=${catalog.length + 1} THEN 1 ELSE 0 END`,
  ];
  let conditions = [];
  const flush = () => {
    if (conditions.length) {
      statements.push(
        `INSERT INTO ${temporary} SELECT CASE WHEN ${conditions.join(" AND ")} THEN 1 ELSE 0 END`
      );
    }
    conditions = [];
  };
  for (const row of catalog) {
    const condition = `EXISTS(SELECT 1 FROM sqlite_schema WHERE type=${literal(row.type)} AND name=${literal(row.name)} AND tbl_name=${literal(row.tbl_name)} AND sql=${literal(row.sql)})`;
    if (Buffer.byteLength(condition) > 90_000) {
      throw new Error("Schema object exceeds reviewed D1 statement budget");
    }
    // D1 caps expression depth at 100, independently of its SQL byte limit.
    if (
      conditions.length === 50 ||
      Buffer.byteLength(conditions.join(" AND ")) +
        Buffer.byteLength(condition) >
        90_000
    ) {
      flush();
    }
    conditions.push(condition);
  }
  flush();
  statements.push(`DROP TABLE ${temporary}`);
  return statements;
}

export async function prepareD1MaintenanceMigration({
  root,
  source,
  catalog,
  maintenanceId,
  operationId,
  operation,
  target,
}) {
  if (!UUID.test(operationId)) {
    throw new Error("Operation identity must be a UUID v4");
  }
  if (!["install", "remove"].includes(operation)) {
    throw new Error("Unknown maintenance operation");
  }
  inspectD1MaintenanceBarrier({
    source,
    catalog,
    maintenanceId,
    state: operation === "install" ? "open" : "frozen",
  });
  // migrations apply initializes its ledger before applying a file.
  const ledger = controlCatalog().find(
    ({ name }) => name === D1_MAINTENANCE_LEDGER
  );
  const before = catalog.some(({ name }) => name === ledger.name)
    ? catalog
    : [...catalog, ledger];
  const guards = buildD1MaintenanceGuards(source, maintenanceId);
  const statements = [
    ...catalogAssertions(before),
    ...guards.map((guard) =>
      operation === "install" ? guard.sql : `DROP TRIGGER ${quote(guard.name)}`
    ),
  ];
  const directory = path.join(root, operationId);
  const migrations = path.join(directory, "migrations");
  await mkdir(migrations, { recursive: true, mode: 0o700 });
  const name = `0001_${operation}_${operationId}.sql`;
  const sql = `${statements.join(";\n")};\n`;
  await writeFile(path.join(migrations, name), sql, {
    flag: "wx",
    mode: 0o600,
  });
  const config = path.join(directory, "wrangler.jsonc");
  await writeFile(
    config,
    JSON.stringify({
      name: "openmeld-d1-maintenance",
      ...(target.accountId ? { account_id: target.accountId } : {}),
      compatibility_date: "2026-09-01",
      d1_databases: [
        {
          binding: "OPENMELD_DB",
          database_name: target.databaseName,
          database_id: target.databaseId,
          migrations_dir: "./migrations",
          migrations_table: D1_MAINTENANCE_LEDGER,
        },
      ],
    }),
    { flag: "wx", mode: 0o600 }
  );
  return {
    config,
    name,
    sqlSha256: hash(sql),
    statements: statements.length,
    guards: guards.length,
    operation,
    operationId,
    maintenanceId,
    historySha256: source.historySha256,
  };
}
