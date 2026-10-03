import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { orderD1Tables, readD1Catalog } from "./d1-snapshot.mjs";
import { quoteIdentifier as quote } from "./database.mjs";

// Prepares only disposable synthetic D1 fixtures; never reads a remote database.
function command(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  if (result.status !== 0) {
    throw new Error(
      `Local fixture command failed: ${executable}; exit=${result.status}`
    );
  }
  return result.stdout;
}

export async function createLocalD1FromSqlite(input, root) {
  if (process.env.OPENMELD_PG_ISOLATED !== "1") {
    throw new Error(
      "Only isolated synthetic local D1 fixture preparation is enabled"
    );
  }
  const database = new DatabaseSync(input, { readOnly: true });
  let schema;
  try {
    schema = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name"
      )
      .all()
      .map((row) => `${row.sql};`)
      .join("\n");
  } finally {
    database.close();
  }
  await writeFile(path.join(root, "fixture.sql"), schema, { mode: 0o600 });
  const config = path.join(root, "wrangler.jsonc");
  await writeFile(
    config,
    JSON.stringify({
      name: "openmeld-d1-rehearsal",
      compatibility_date: "2026-09-01",
      d1_databases: [
        {
          binding: "SOURCE",
          database_name: "openmeld-d1-rehearsal",
          database_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
    }),
    { mode: 0o600 }
  );
  command("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "openmeld-d1-rehearsal",
    "--local",
    "--config",
    config,
    "--file",
    path.join(root, "fixture.sql"),
  ]);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {}",
      resourcePersistencePath: path.join(root, ".wrangler/state/v3"),
      d1Databases: { SOURCE: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    })
  );
  try {
    await populateSource(await mf.getD1Database("SOURCE"), input);
    return mf;
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

async function populateSource(source, input) {
  const database = new DatabaseSync(input, { readOnly: true });
  try {
    const tables = orderD1Tables(readD1Catalog(database));
    for (const name of ["d1_migrations", "sqlite_sequence"]) {
      tables.push({
        name,
        columns: database.prepare(`PRAGMA table_xinfo(${quote(name)})`).all(),
      });
    }
    for (const table of tables) {
      const columns = table.columns
        .filter((column) => column.hidden === 0)
        .map((column) => column.name);
      const rows = database
        .prepare(
          `SELECT rowid AS fixture_rowid,${columns.map(quote).join(",")} FROM ${quote(table.name)} ORDER BY rowid`
        )
        .all();
      if (table.name === "sqlite_sequence") {
        await source.prepare("DELETE FROM sqlite_sequence").run();
      }
      for (let offset = 0; offset < rows.length; offset += 64) {
        const inserts = rows
          .slice(offset, offset + 64)
          .map((row) =>
            source
              .prepare(
                `INSERT INTO ${quote(table.name)} (rowid,${columns.map(quote).join(",")}) VALUES (${["?", ...columns.map((column) => (table.name === "sqlite_sequence" && column === "seq" ? "CAST(? AS INTEGER)" : "?"))].join(",")})`
              )
              .bind(row.fixture_rowid, ...columns.map((column) => row[column]))
          );
        // The synthetic folder child precedes its parent in this batch.
        await source.batch([
          source.prepare("PRAGMA defer_foreign_keys=ON"),
          ...inserts,
        ]);
      }
    }
  } finally {
    database.close();
  }
}
