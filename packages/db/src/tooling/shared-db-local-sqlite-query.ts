import Database from "better-sqlite3";
import {
  meetsSharedLocalSqliteMinimumSignature,
  readSharedLocalSqliteSignature,
} from "./shared-db-local-sqlite-signature.ts";

const TABLE_INFO_REGEX = /^PRAGMA\s+table_info\('([^']+)'\);?$/iu;
const TABLE_XINFO_REGEX = /^PRAGMA\s+table_xinfo\('([^']+)'\);?$/iu;
const INDEX_LIST_REGEX = /^PRAGMA\s+index_list\('([^']+)'\);?$/iu;
const INDEX_XINFO_REGEX = /^PRAGMA\s+index_xinfo\('([^']+)'\);?$/iu;
const APPLIED_MIGRATION_ID_REGEX =
  /^SELECT\s+MAX\(id\)\s+AS\s+maxId\s+FROM\s+d1_migrations;?$/iu;

const describeLocalSqliteSignatureFailure = (sqlitePath: string): string => {
  return `shared OPENMELD_DB local sqlite target at ${sqlitePath} does not match the required shared D1 signature`;
};

const executeReadonlySqliteQuery = <TRow>(input: {
  localDbPath: string;
  sql: string;
}): { blockedReason: string | null; rows: TRow[] } => {
  let database: InstanceType<typeof Database> | null = null;

  try {
    const signature = readSharedLocalSqliteSignature(input.localDbPath);
    if (!meetsSharedLocalSqliteMinimumSignature(signature)) {
      return {
        blockedReason: describeLocalSqliteSignatureFailure(input.localDbPath),
        rows: [],
      };
    }

    database = new Database(input.localDbPath, {
      fileMustExist: true,
      readonly: true,
    });

    return {
      blockedReason: null,
      rows: database.prepare(input.sql).all() as TRow[],
    };
  } catch (error) {
    return {
      blockedReason:
        error instanceof Error
          ? `${input.localDbPath}: ${error.message}`
          : `${input.localDbPath}: ${String(error)}`,
      rows: [],
    };
  } finally {
    database?.close();
  }
};

export const runSharedLocalSqliteQuery = <TRow>(input: {
  localDbPath: string;
  sql: string;
}): { blockedReason: string | null; rows: TRow[] } => {
  const normalizedSql = input.sql.trim();
  if (
    !(
      TABLE_INFO_REGEX.test(normalizedSql) ||
      TABLE_XINFO_REGEX.test(normalizedSql) ||
      INDEX_LIST_REGEX.test(normalizedSql) ||
      INDEX_XINFO_REGEX.test(normalizedSql) ||
      APPLIED_MIGRATION_ID_REGEX.test(normalizedSql)
    )
  ) {
    return {
      blockedReason: `unsupported shared local sqlite inspection query: ${normalizedSql}`,
      rows: [],
    };
  }

  return executeReadonlySqliteQuery<TRow>({
    localDbPath: input.localDbPath,
    sql: normalizedSql,
  });
};
