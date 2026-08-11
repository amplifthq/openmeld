import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getRepoRootDirectoryPath } from "../../src/tooling";

export type BetterSqliteDatabase = Database.Database;

export const DB_TOOLING_CONTRACT_TEST_TIMEOUT_MS = 30_000;

const D1_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE d1_migrations (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

export const getSharedMigrationDirectoryPath = (): string => {
  return path.resolve(getRepoRootDirectoryPath(), "packages/db/drizzle");
};

export const findAllSharedMigrationPaths = (): string[] => {
  return fs
    .readdirSync(getSharedMigrationDirectoryPath())
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.resolve(getSharedMigrationDirectoryPath(), entry));
};

export const splitMigrationStatements = (migrationSource: string): string[] => {
  return migrationSource
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

export const applyMigrationFile = (
  database: BetterSqliteDatabase,
  migrationPath: string
): void => {
  const migrationSource = fs.readFileSync(migrationPath, "utf8");
  for (const statement of splitMigrationStatements(migrationSource)) {
    database.exec(statement);
  }
};

export const applySharedMigrationChain = (
  database: BetterSqliteDatabase,
  migrationPaths: readonly string[] = findAllSharedMigrationPaths()
): void => {
  for (const [index, migrationPath] of migrationPaths.entries()) {
    applyMigrationFile(database, migrationPath);
    const hasMigrationLedger = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'"
      )
      .get();
    if (hasMigrationLedger) {
      database
        .prepare(
          "INSERT INTO d1_migrations (id, name, applied_at) VALUES (?, ?, ?)"
        )
        .run(
          index + 1,
          path.basename(migrationPath),
          new Date(0).toISOString()
        );
    }
  }
};

const createTempSharedSqlitePath = (
  label: string,
  sqliteFilePrefix: string
): string => {
  return path.join(
    os.tmpdir(),
    `${sqliteFilePrefix}-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
};

export const createSharedLocalFixture = (
  label: string,
  setup: (database: BetterSqliteDatabase) => void,
  sqliteFilePrefix = "openmeld-shared-local"
): { cleanup: () => void; sqlitePath: string } => {
  const sqlitePath = createTempSharedSqlitePath(label, sqliteFilePrefix);
  const database = new Database(sqlitePath);

  try {
    database.exec(D1_MIGRATIONS_TABLE_SQL);
    setup(database);
  } finally {
    database.close();
  }

  return {
    cleanup: () => {
      fs.rmSync(sqlitePath, { force: true });
    },
    sqlitePath,
  };
};

export const createCanonicalSharedLocalFixture = (
  label: string,
  sqliteFilePrefix = "openmeld-shared-local"
): { cleanup: () => void; sqlitePath: string } => {
  return createSharedLocalFixture(
    label,
    (database) => {
      applySharedMigrationChain(database);
    },
    sqliteFilePrefix
  );
};

export const createCanonicalSharedInMemoryDatabase =
  (): BetterSqliteDatabase => {
    const database = new Database(":memory:");
    database.exec(D1_MIGRATIONS_TABLE_SQL);
    applySharedMigrationChain(database);
    return database;
  };
