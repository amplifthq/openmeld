import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  findLatestLocalWranglerSqlitePath,
  resolveSharedLocalWranglerSqlitePath,
} from "../src/tooling/wrangler-d1-target.ts";

const tempDirectories: string[] = [];
type BetterSqliteDatabase = Database.Database;
const SHARED_SIGNATURE_MISSING_ERROR_REGEX =
  /matches the shared OPENMELD_DB signature/u;
const SHARED_SIGNATURE_AMBIGUOUS_ERROR_REGEX =
  /match the shared OPENMELD_DB signature equally/u;

const withTempStateDirectory = (): string => {
  const stateDirectoryPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "openmeld-db-wrangler-target-")
  );
  tempDirectories.push(stateDirectoryPath);
  return stateDirectoryPath;
};

const createSqliteFile = (
  sqlitePath: string,
  setup?: (database: BetterSqliteDatabase) => void
) => {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const database = new Database(sqlitePath);

  try {
    setup?.(database);
  } finally {
    database.close();
  }
};

const seedSharedSignatureTables = (
  database: BetterSqliteDatabase,
  input?: {
    includeAuthTables?: boolean;
    includeDispatchTables?: boolean;
  }
) => {
  database.exec(`
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  if (input?.includeAuthTables ?? true) {
    database.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL);
    `);
  }

  if (input?.includeDispatchTables ?? true) {
    database.exec(`
      CREATE TABLE openMeldDaemon_dispatch_attempts (attempt_id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE openMeldDaemon_dispatch_results (result_ref TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE openMeldDaemon_dispatch_ledger (id INTEGER PRIMARY KEY NOT NULL);
    `);
  }
};

afterEach(() => {
  for (const directoryPath of tempDirectories.splice(0)) {
    fs.rmSync(directoryPath, { force: true, recursive: true });
  }
});

describe("findLatestLocalWranglerSqlitePath", () => {
  it("returns the newest D1 sqlite file and ignores DO files", () => {
    const stateDirectoryPath = withTempStateDirectory();
    const d1DirectoryPath = path.join(
      stateDirectoryPath,
      "v3",
      "d1",
      "miniflare-D1DatabaseObject"
    );
    const doDirectoryPath = path.join(
      stateDirectoryPath,
      "v3",
      "do",
      "openmeld-core-Space"
    );
    const olderD1SqlitePath = path.join(d1DirectoryPath, "older.sqlite");
    const newerD1SqlitePath = path.join(d1DirectoryPath, "newer.sqlite");
    const newerDoSqlitePath = path.join(doDirectoryPath, "newest.sqlite");

    createSqliteFile(olderD1SqlitePath);
    createSqliteFile(newerD1SqlitePath);
    createSqliteFile(newerDoSqlitePath);
    fs.writeFileSync(`${newerD1SqlitePath}-wal`, "");
    fs.writeFileSync(`${newerD1SqlitePath}-shm`, "");
    fs.utimesSync(
      olderD1SqlitePath,
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-01T00:00:00.000Z")
    );
    fs.utimesSync(
      newerD1SqlitePath,
      new Date("2026-03-02T00:00:00.000Z"),
      new Date("2026-03-02T00:00:00.000Z")
    );
    fs.utimesSync(
      newerDoSqlitePath,
      new Date("2026-03-03T00:00:00.000Z"),
      new Date("2026-03-03T00:00:00.000Z")
    );

    expect(findLatestLocalWranglerSqlitePath(stateDirectoryPath)).toBe(
      newerD1SqlitePath
    );
  });
});

describe("resolveSharedLocalWranglerSqlitePath", () => {
  it("prefers the candidate with the strongest shared OPENMELD_DB signature", () => {
    const stateDirectoryPath = withTempStateDirectory();
    const d1DirectoryPath = path.join(
      stateDirectoryPath,
      "v3",
      "d1",
      "miniflare-D1DatabaseObject"
    );
    const weakerCandidatePath = path.join(d1DirectoryPath, "weaker.sqlite");
    const strongerCandidatePath = path.join(d1DirectoryPath, "stronger.sqlite");

    createSqliteFile(weakerCandidatePath, (database) => {
      seedSharedSignatureTables(database, {
        includeAuthTables: false,
        includeDispatchTables: true,
      });
    });
    createSqliteFile(strongerCandidatePath, (database) => {
      seedSharedSignatureTables(database, {
        includeAuthTables: true,
        includeDispatchTables: true,
      });
    });

    expect(resolveSharedLocalWranglerSqlitePath(stateDirectoryPath)).toBe(
      strongerCandidatePath
    );
  });

  it("uses mtime as the tie-breaker when shared signatures are identical", () => {
    const stateDirectoryPath = withTempStateDirectory();
    const d1DirectoryPath = path.join(
      stateDirectoryPath,
      "v3",
      "d1",
      "miniflare-D1DatabaseObject"
    );
    const olderCandidatePath = path.join(d1DirectoryPath, "older.sqlite");
    const newerCandidatePath = path.join(d1DirectoryPath, "newer.sqlite");

    createSqliteFile(olderCandidatePath, (database) => {
      seedSharedSignatureTables(database);
    });
    createSqliteFile(newerCandidatePath, (database) => {
      seedSharedSignatureTables(database);
    });
    fs.utimesSync(
      olderCandidatePath,
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-01T00:00:00.000Z")
    );
    fs.utimesSync(
      newerCandidatePath,
      new Date("2026-03-02T00:00:00.000Z"),
      new Date("2026-03-02T00:00:00.000Z")
    );

    expect(resolveSharedLocalWranglerSqlitePath(stateDirectoryPath)).toBe(
      newerCandidatePath
    );
  });

  it("throws when no candidate matches the minimum shared OPENMELD_DB signature", () => {
    const stateDirectoryPath = withTempStateDirectory();
    const d1DirectoryPath = path.join(
      stateDirectoryPath,
      "v3",
      "d1",
      "miniflare-D1DatabaseObject"
    );
    const emptyCandidatePath = path.join(d1DirectoryPath, "empty.sqlite");

    createSqliteFile(emptyCandidatePath, (database) => {
      database.exec(
        "CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value INTEGER);"
      );
    });

    expect(() => {
      resolveSharedLocalWranglerSqlitePath(stateDirectoryPath);
    }).toThrow(SHARED_SIGNATURE_MISSING_ERROR_REGEX);
  });

  it("throws when equally strong candidates also share the same mtime", () => {
    const stateDirectoryPath = withTempStateDirectory();
    const d1DirectoryPath = path.join(
      stateDirectoryPath,
      "v3",
      "d1",
      "miniflare-D1DatabaseObject"
    );
    const firstCandidatePath = path.join(d1DirectoryPath, "first.sqlite");
    const secondCandidatePath = path.join(d1DirectoryPath, "second.sqlite");

    createSqliteFile(firstCandidatePath, (database) => {
      seedSharedSignatureTables(database);
    });
    createSqliteFile(secondCandidatePath, (database) => {
      seedSharedSignatureTables(database);
    });
    const identicalTime = new Date("2026-03-02T00:00:00.000Z");
    fs.utimesSync(firstCandidatePath, identicalTime, identicalTime);
    fs.utimesSync(secondCandidatePath, identicalTime, identicalTime);

    expect(() => {
      resolveSharedLocalWranglerSqlitePath(stateDirectoryPath);
    }).toThrow(SHARED_SIGNATURE_AMBIGUOUS_ERROR_REGEX);
  });
});
