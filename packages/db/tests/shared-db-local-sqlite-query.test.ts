import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runSharedLocalSqliteQuery } from "../src/tooling/shared-db-local-sqlite-query.ts";
import type {
  SqliteIndexColumnRow,
  SqliteIndexListRow,
  SqliteTableInfoRow,
} from "../src/tooling/shared-db-query.ts";

const tempFiles: string[] = [];
type BetterSqliteDatabase = Database.Database;

const createSqliteFile = (
  label: string,
  setup: (database: BetterSqliteDatabase) => void
): string => {
  const sqlitePath = path.join(
    os.tmpdir(),
    `openmeld-shared-local-query-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const database = new Database(sqlitePath);

  try {
    setup(database);
  } finally {
    database.close();
  }

  tempFiles.push(sqlitePath);
  return sqlitePath;
};

const seedCanonicalSharedTables = (database: BetterSqliteDatabase) => {
  database.exec(`
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE verifications (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE openmeld_profiles (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE openmeld_profile_space_history (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE openmeld_space_deletion_tombstones (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE openMeldDaemon_dispatch_results (
      result_ref TEXT PRIMARY KEY NOT NULL,
      dispatch_id TEXT NOT NULL,
      actor_profile_id TEXT NOT NULL,
      actor_profile_key TEXT GENERATED ALWAYS AS (lower(actor_profile_id)) STORED,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX idx_openMeldDaemon_dispatch_results_actor_created
      ON openMeldDaemon_dispatch_results(actor_profile_id, created_at_ms DESC);
  `);
};

afterEach(() => {
  for (const sqlitePath of tempFiles.splice(0)) {
    fs.rmSync(sqlitePath, { force: true });
  }
});

describe("runSharedLocalSqliteQuery", () => {
  it("reads generated columns with PRAGMA table_xinfo from a valid shared sqlite target", () => {
    const sqlitePath = createSqliteFile("table-info", (database) => {
      seedCanonicalSharedTables(database);
    });

    const result = runSharedLocalSqliteQuery<SqliteTableInfoRow>({
      localDbPath: sqlitePath,
      sql: "PRAGMA table_xinfo('openMeldDaemon_dispatch_results');",
    });

    expect(result.blockedReason).toBeNull();
    expect(result.rows.map((row) => String(row.name))).toEqual(
      expect.arrayContaining([
        "result_ref",
        "dispatch_id",
        "actor_profile_id",
        "actor_profile_key",
        "created_at_ms",
      ])
    );
  });

  it("reads PRAGMA index_list and index_xinfo from a valid shared sqlite target", () => {
    const sqlitePath = createSqliteFile("index-info", (database) => {
      seedCanonicalSharedTables(database);
    });

    const indexListResult = runSharedLocalSqliteQuery<SqliteIndexListRow>({
      localDbPath: sqlitePath,
      sql: "PRAGMA index_list('openMeldDaemon_dispatch_results');",
    });
    const indexInfoResult = runSharedLocalSqliteQuery<SqliteIndexColumnRow>({
      localDbPath: sqlitePath,
      sql: "PRAGMA index_xinfo('idx_openMeldDaemon_dispatch_results_actor_created');",
    });

    expect(indexListResult.blockedReason).toBeNull();
    expect(indexInfoResult.blockedReason).toBeNull();
    expect(
      indexListResult.rows.some((row) => {
        return (
          String(row.name) ===
          "idx_openMeldDaemon_dispatch_results_actor_created"
        );
      })
    ).toBe(true);
    expect(
      indexInfoResult.rows
        .filter((row) => Number(row.key ?? 0) === 1)
        .map((row) => String(row.name))
    ).toEqual(["actor_profile_id", "created_at_ms"]);
  });

  it("blocks when the sqlite path does not exist", () => {
    const missingSqlitePath = path.join(
      os.tmpdir(),
      "openmeld-shared-local-query-missing.sqlite"
    );

    const result = runSharedLocalSqliteQuery<SqliteTableInfoRow>({
      localDbPath: missingSqlitePath,
      sql: "PRAGMA table_info('openMeldDaemon_dispatch_results');",
    });

    expect(result.rows).toEqual([]);
    expect(result.blockedReason).toContain(missingSqlitePath);
  });

  it("blocks when the sqlite file does not match the minimum shared signature", () => {
    const sqlitePath = createSqliteFile("invalid-signature", (database) => {
      database.exec(`
        CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY NOT NULL, value INTEGER NOT NULL);
      `);
    });

    const result = runSharedLocalSqliteQuery<SqliteTableInfoRow>({
      localDbPath: sqlitePath,
      sql: "PRAGMA table_info('openMeldDaemon_dispatch_results');",
    });

    expect(result.rows).toEqual([]);
    expect(result.blockedReason).toContain(
      "does not match the required shared D1 signature"
    );
  });
});
