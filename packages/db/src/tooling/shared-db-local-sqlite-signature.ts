import Database from "better-sqlite3";

export const SHARED_LOCAL_SQLITE_REQUIRED_AUTH_TABLE_NAMES = [
  "accounts",
  "users",
  "sessions",
  "verifications",
  "openmeld_profiles",
  "openmeld_profile_space_history",
  "openmeld_space_deletion_tombstones",
] as const;

export const SHARED_LOCAL_SQLITE_REQUIRED_DISPATCH_TABLE_NAMES = [
  "openMeldDaemon_dispatch_attempts",
  "openMeldDaemon_dispatch_results",
  "openMeldDaemon_dispatch_ledger",
  "openMeldDaemon_ops_decisions",
  "openMeldDaemon_dlq",
] as const;

export type SharedLocalSqliteSignature = {
  authMatchCount: number;
  dispatchMatchCount: number;
  hasD1Migrations: boolean;
  matchedGroupCount: number;
  totalMatchCount: number;
};

const readTableNames = (sqlitePath: string): string[] => {
  const database = new Database(sqlitePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    return (
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    )
      .map((row) =>
        String(row.name ?? "")
          .trim()
          .toLowerCase()
      )
      .filter((name) => name.length > 0);
  } finally {
    database.close();
  }
};

export const buildSharedLocalSqliteSignature = (input: {
  tableNames: readonly string[];
}): SharedLocalSqliteSignature => {
  const tableNameSet = new Set(
    input.tableNames.map((tableName) => {
      return String(tableName).trim().toLowerCase();
    })
  );
  const authMatchCount = SHARED_LOCAL_SQLITE_REQUIRED_AUTH_TABLE_NAMES.filter(
    (tableName) => tableNameSet.has(tableName)
  ).length;
  const dispatchMatchCount =
    SHARED_LOCAL_SQLITE_REQUIRED_DISPATCH_TABLE_NAMES.filter((tableName) => {
      return tableNameSet.has(tableName);
    }).length;
  const hasD1Migrations = tableNameSet.has("d1_migrations");
  const matchedGroupCount =
    Number(authMatchCount > 0) + Number(dispatchMatchCount > 0);

  return {
    authMatchCount,
    dispatchMatchCount,
    hasD1Migrations,
    matchedGroupCount,
    totalMatchCount: authMatchCount + dispatchMatchCount,
  };
};

export const readSharedLocalSqliteSignature = (
  sqlitePath: string
): SharedLocalSqliteSignature => {
  return buildSharedLocalSqliteSignature({
    tableNames: readTableNames(sqlitePath),
  });
};

export const meetsSharedLocalSqliteMinimumSignature = (
  signature: SharedLocalSqliteSignature
): boolean => {
  return signature.hasD1Migrations && signature.matchedGroupCount > 0;
};
