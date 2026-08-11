import { getPackagesDbDirectoryPath } from "../auth/paths.ts";
import {
  CORE_DISPATCH_REQUIRED_NAMED_INDEXES,
  CORE_DISPATCH_REQUIRED_TABLE_COLUMNS,
  CORE_DISPATCH_REQUIRED_UNIQUE_CONSTRAINTS,
  type CoreRequiredNamedIndex,
  type CoreRequiredTableColumn,
} from "../core/dispatch-schema-requirements.ts";
import {
  DIAGNOSTICS_REQUIRED_NAMED_INDEXES,
  DIAGNOSTICS_REQUIRED_TABLE_COLUMNS,
  DIAGNOSTICS_REQUIRED_UNIQUE_CONSTRAINTS,
} from "../diagnostics/schema-requirements.ts";
import { LATEST_SHARED_MIGRATION_ID } from "../shared/fact-metadata.ts";
import { listSharedLocalWorkerDbTargets } from "../shared/local-worker-targets.ts";
import type { ToolingCommandRunner } from "./command-runner.ts";
import type { DbExecutionMode } from "./db-execution-mode.ts";
import {
  runSharedDbQuery,
  type SqliteIndexColumnRow,
  type SqliteIndexListRow,
  type SqliteTableInfoRow,
} from "./shared-db-query.ts";
import { runSharedWranglerJsonQuery } from "./shared-db-wrangler-query.ts";
import { MissingLocalWranglerSqliteCandidatesError } from "./wrangler-d1-target.ts";

export type SharedDbPhysicalContractInspection = {
  detail: string | null;
  status: "blocked" | "drift_detected" | "ok";
};

type AppliedMigrationIdRow = {
  maxId?: unknown;
};

const SHARED_REQUIRED_TABLE_COLUMNS = [
  ...CORE_DISPATCH_REQUIRED_TABLE_COLUMNS,
  ...DIAGNOSTICS_REQUIRED_TABLE_COLUMNS,
] as const;
const SHARED_REQUIRED_NAMED_INDEXES = [
  ...CORE_DISPATCH_REQUIRED_NAMED_INDEXES,
  ...DIAGNOSTICS_REQUIRED_NAMED_INDEXES,
] as const;
const SHARED_REQUIRED_UNIQUE_CONSTRAINTS = [
  ...CORE_DISPATCH_REQUIRED_UNIQUE_CONSTRAINTS,
  ...DIAGNOSTICS_REQUIRED_UNIQUE_CONSTRAINTS,
] as const;

const normalizeSqliteIdentifier = (value: unknown): string => {
  return String(value ?? "")
    .trim()
    .toLowerCase();
};

const INDEX_COLUMN_PATTERN = /^(`[^`]+`|"[^"]+"|\[[^\]]+\]|[^\s,]+)(.*)$/;
const SQL_DESC_PATTERN = /\bdesc\b/i;
const SQL_WORD_CHARACTER_PATTERN = /[A-Za-z0-9_]/;

const quoteSqlString = (value: string): string => {
  return `'${value.replaceAll("'", "''")}'`;
};

const buildSqlStringList = (values: readonly string[]): string => {
  return values.map((value) => quoteSqlString(value)).join(", ");
};

const inspectAppliedSharedMigration = (input: {
  localDbPath?: string;
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
  wranglerConfigAbsolutePath?: string;
}): SharedDbPhysicalContractInspection => {
  const result = runSharedDbQuery<AppliedMigrationIdRow>({
    localDbPath: input.localDbPath,
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    sql: "SELECT MAX(id) AS maxId FROM d1_migrations;",
    wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
  });
  if (result.blockedReason) {
    return {
      detail: result.blockedReason,
      status: "blocked",
    };
  }

  const appliedMigrationId = Number(result.rows[0]?.maxId ?? 0);
  if (!Number.isInteger(appliedMigrationId) || appliedMigrationId < 0) {
    return {
      detail: "d1_migrations returned an invalid applied migration id",
      status: "blocked",
    };
  }

  if (appliedMigrationId < LATEST_SHARED_MIGRATION_ID) {
    return {
      detail: `applied migration id ${appliedMigrationId}; expected migration id ${LATEST_SHARED_MIGRATION_ID}`,
      status: "drift_detected",
    };
  }

  return {
    detail: null,
    status: "ok",
  };
};

const verifyRequiredTableColumn = (input: {
  actualRows: SqliteTableInfoRow[];
  requiredColumn: CoreRequiredTableColumn;
}): string | null => {
  const actualColumn = input.actualRows.find((row) => {
    return (
      normalizeSqliteIdentifier(row.name) === input.requiredColumn.columnName
    );
  });

  if (!actualColumn) {
    return `required column ${input.requiredColumn.columnName} for ${input.requiredColumn.tableName}`;
  }

  if (
    String(actualColumn.type ?? "")
      .trim()
      .toUpperCase() !== input.requiredColumn.sqliteType
  ) {
    return `column ${input.requiredColumn.columnName} for ${input.requiredColumn.tableName} with type ${input.requiredColumn.sqliteType}`;
  }

  const actualPrimaryKey = Number(actualColumn.pk ?? 0) > 0;
  if (actualPrimaryKey !== input.requiredColumn.primaryKey) {
    return `column ${input.requiredColumn.columnName} for ${input.requiredColumn.tableName} with primary key ${String(input.requiredColumn.primaryKey)}`;
  }

  const actualNotNull =
    Number(actualColumn.notnull ?? 0) > 0 || actualPrimaryKey;
  if (actualNotNull !== input.requiredColumn.notNull) {
    return `column ${input.requiredColumn.columnName} for ${input.requiredColumn.tableName} with not null ${String(input.requiredColumn.notNull)}`;
  }

  return null;
};

const verifyRequiredNamedIndex = (input: {
  actualIndexColumns: SqliteIndexColumnRow[];
  actualIndexListRows: SqliteIndexListRow[];
  requiredIndex: CoreRequiredNamedIndex;
}): string | null => {
  const actualIndex = input.actualIndexListRows.find((row) => {
    return (
      normalizeSqliteIdentifier(row.name) ===
      normalizeSqliteIdentifier(input.requiredIndex.indexName)
    );
  });

  if (!actualIndex) {
    return `required index ${input.requiredIndex.indexName}`;
  }

  const actualIndexIsUnique = Number(actualIndex.unique ?? 0) === 1;
  if (actualIndexIsUnique !== input.requiredIndex.isUnique) {
    return `index ${input.requiredIndex.indexName} with unique ${String(input.requiredIndex.isUnique)}`;
  }

  const actualDefinition = input.actualIndexColumns
    .filter((row) => Number(row.key ?? 0) === 1)
    .sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
    .map((row) => {
      return {
        columnName: normalizeSqliteIdentifier(row.name),
        descending: Number(row.desc ?? 0) === 1,
      };
    });

  const expectedDefinition = input.requiredIndex.columns.map((column) => {
    return {
      columnName: normalizeSqliteIdentifier(column.columnName),
      descending: column.descending,
    };
  });

  if (JSON.stringify(actualDefinition) !== JSON.stringify(expectedDefinition)) {
    return `index ${input.requiredIndex.indexName} with columns ${input.requiredIndex.columns
      .map((column) => {
        return `${column.columnName}${column.descending ? " desc" : ""}`;
      })
      .join(", ")}`;
  }

  return null;
};

const buildConstraintColumnKey = (columnNames: readonly string[]): string => {
  return columnNames
    .map((columnName) => normalizeSqliteIdentifier(columnName))
    .join("|");
};

const collectPrimaryKeyConstraintKeys = (
  actualTableInfoRows: SqliteTableInfoRow[]
): Set<string> => {
  const primaryKeyColumnNames = actualTableInfoRows
    .filter((column) => Number(column.pk ?? 0) > 0)
    .sort((left, right) => Number(left.pk ?? 0) - Number(right.pk ?? 0))
    .map((column) => normalizeSqliteIdentifier(column.name));

  return primaryKeyColumnNames.length > 0
    ? new Set([buildConstraintColumnKey(primaryKeyColumnNames)])
    : new Set<string>();
};

const resolveActualUniqueConstraintCounts = (input: {
  actualIndexColumnsByName: Map<string, SqliteIndexColumnRow[]>;
  actualIndexListRows: SqliteIndexListRow[];
  actualTableInfoRows: SqliteTableInfoRow[];
}): Map<string, number> => {
  const primaryKeyConstraintKeys = collectPrimaryKeyConstraintKeys(
    input.actualTableInfoRows
  );
  const actualUniqueConstraintCounts = new Map<string, number>();

  for (const candidate of input.actualIndexListRows) {
    if (Number(candidate.unique ?? 0) !== 1) {
      continue;
    }

    const indexName = String(candidate.name ?? "").trim();
    if (indexName.length === 0) {
      continue;
    }

    const actualIndexColumns = (
      input.actualIndexColumnsByName.get(indexName) ?? []
    )
      .filter((row) => Number(row.key ?? 0) === 1)
      .sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
      .map((row) => normalizeSqliteIdentifier(row.name));

    if (actualIndexColumns.length === 0) {
      continue;
    }

    const constraintKey = buildConstraintColumnKey(actualIndexColumns);
    if (primaryKeyConstraintKeys.has(constraintKey)) {
      continue;
    }

    actualUniqueConstraintCounts.set(
      constraintKey,
      (actualUniqueConstraintCounts.get(constraintKey) ?? 0) + 1
    );
  }

  return actualUniqueConstraintCounts;
};

const verifyExactUniqueConstraints = (input: {
  actualIndexColumnsByName: Map<string, SqliteIndexColumnRow[]>;
  actualIndexListRows: SqliteIndexListRow[];
  actualTableInfoRows: SqliteTableInfoRow[];
  tableName: string;
}): string | null => {
  const expectedUniqueConstraintKeys = new Set(
    SHARED_REQUIRED_UNIQUE_CONSTRAINTS.filter((constraint) => {
      return constraint.tableName === input.tableName;
    }).map((constraint) => buildConstraintColumnKey(constraint.columnNames))
  );
  const actualUniqueConstraintCounts = resolveActualUniqueConstraintCounts({
    actualIndexColumnsByName: input.actualIndexColumnsByName,
    actualIndexListRows: input.actualIndexListRows,
    actualTableInfoRows: input.actualTableInfoRows,
  });

  for (const [
    actualUniqueConstraintKey,
    actualConstraintCount,
  ] of actualUniqueConstraintCounts) {
    if (!expectedUniqueConstraintKeys.has(actualUniqueConstraintKey)) {
      return `unexpected unique constraint on ${input.tableName}(${actualUniqueConstraintKey.replaceAll("|", ", ")})`;
    }

    if (actualConstraintCount !== 1) {
      return `duplicate unique constraints on ${input.tableName}(${actualUniqueConstraintKey.replaceAll("|", ", ")})`;
    }
  }

  for (const expectedUniqueConstraintKey of expectedUniqueConstraintKeys) {
    const actualConstraintCount =
      actualUniqueConstraintCounts.get(expectedUniqueConstraintKey) ?? 0;

    if (actualConstraintCount === 0) {
      return `unique constraint on ${input.tableName}(${expectedUniqueConstraintKey.replaceAll("|", ", ")})`;
    }

    if (actualConstraintCount !== 1) {
      return `duplicate unique constraints on ${input.tableName}(${expectedUniqueConstraintKey.replaceAll("|", ", ")})`;
    }
  }

  return null;
};

const loadTableIndexColumnsByName = (input: {
  actualIndexListRows: SqliteIndexListRow[];
  localDbPath?: string;
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
  wranglerConfigAbsolutePath?: string;
}): {
  blockedReason: string | null;
  indexColumnsByName: Map<string, SqliteIndexColumnRow[]>;
} => {
  const indexColumnsByName = new Map<string, SqliteIndexColumnRow[]>();

  for (const row of input.actualIndexListRows) {
    const indexName = String(row.name ?? "").trim();
    if (indexName.length === 0) {
      continue;
    }

    const indexInfoResult = runSharedDbQuery<SqliteIndexColumnRow>({
      localDbPath: input.localDbPath,
      mode: input.mode,
      packagesDbDirectoryPath: input.packagesDbDirectoryPath,
      runner: input.runner,
      sql: `PRAGMA index_xinfo('${indexName}');`,
      wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
    });
    if (indexInfoResult.blockedReason) {
      return {
        blockedReason: indexInfoResult.blockedReason,
        indexColumnsByName,
      };
    }

    indexColumnsByName.set(indexName, indexInfoResult.rows);
  }

  return {
    blockedReason: null,
    indexColumnsByName,
  };
};

const inspectRequiredTablePhysicalContract = (input: {
  localDbPath?: string;
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
  tableName: string;
  wranglerConfigAbsolutePath?: string;
}): SharedDbPhysicalContractInspection => {
  const tableInfoResult = runSharedDbQuery<SqliteTableInfoRow>({
    localDbPath: input.localDbPath,
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    // table_info omits generated columns. table_xinfo returns the same
    // contract fields plus generated and hidden columns.
    sql: `PRAGMA table_xinfo('${input.tableName}');`,
    wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
  });
  if (tableInfoResult.blockedReason) {
    return {
      detail: tableInfoResult.blockedReason,
      status: "blocked",
    };
  }
  if (tableInfoResult.rows.length === 0) {
    return {
      detail: `required table ${input.tableName}`,
      status: "drift_detected",
    };
  }

  for (const requiredColumn of SHARED_REQUIRED_TABLE_COLUMNS.filter(
    (column) => column.tableName === input.tableName
  )) {
    const failure = verifyRequiredTableColumn({
      actualRows: tableInfoResult.rows,
      requiredColumn,
    });
    if (failure) {
      return {
        detail: failure,
        status: "drift_detected",
      };
    }
  }

  const indexListResult = runSharedDbQuery<SqliteIndexListRow>({
    localDbPath: input.localDbPath,
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    sql: `PRAGMA index_list('${input.tableName}');`,
    wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
  });
  if (indexListResult.blockedReason) {
    return {
      detail: indexListResult.blockedReason,
      status: "blocked",
    };
  }

  const indexColumnsResult = loadTableIndexColumnsByName({
    actualIndexListRows: indexListResult.rows,
    localDbPath: input.localDbPath,
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
  });
  if (indexColumnsResult.blockedReason) {
    return {
      detail: indexColumnsResult.blockedReason,
      status: "blocked",
    };
  }

  for (const requiredIndex of SHARED_REQUIRED_NAMED_INDEXES.filter(
    (index) => index.tableName === input.tableName
  )) {
    const failure = verifyRequiredNamedIndex({
      actualIndexColumns:
        indexColumnsResult.indexColumnsByName.get(requiredIndex.indexName) ??
        [],
      actualIndexListRows: indexListResult.rows,
      requiredIndex,
    });
    if (failure) {
      return {
        detail: failure,
        status: "drift_detected",
      };
    }
  }

  const uniqueConstraintFailure = verifyExactUniqueConstraints({
    actualIndexColumnsByName: indexColumnsResult.indexColumnsByName,
    actualIndexListRows: indexListResult.rows,
    actualTableInfoRows: tableInfoResult.rows,
    tableName: input.tableName,
  });
  if (uniqueConstraintFailure) {
    return {
      detail: uniqueConstraintFailure,
      status: "drift_detected",
    };
  }

  return {
    detail: null,
    status: "ok",
  };
};

type RemoteSqliteIndexDefinitionRow = {
  index_name?: unknown;
  sql?: unknown;
};

type RemoteSqliteIndexListRow = SqliteIndexListRow & {
  table_name?: unknown;
};

type RemoteSqliteTableInfoRow = SqliteTableInfoRow & {
  not_null?: unknown;
  table_name?: unknown;
};

const stripSqlIdentifierQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const resolveSqlQuoteEndCharacter = (character: string): string | null => {
  if (character === "'" || character === '"' || character === "`") {
    return character;
  }

  if (character === "[") {
    return "]";
  }

  return null;
};

const advanceSqlQuoteState = (input: {
  character: string;
  nextCharacter: string | undefined;
  quoteEndCharacter: string | null;
}): {
  isInsideQuotedText: boolean;
  quoteEndCharacter: string | null;
  shouldSkipNextCharacter: boolean;
} => {
  if (!input.quoteEndCharacter) {
    const quoteEndCharacter = resolveSqlQuoteEndCharacter(input.character);

    return {
      isInsideQuotedText: quoteEndCharacter !== null,
      quoteEndCharacter,
      shouldSkipNextCharacter: false,
    };
  }

  if (input.character !== input.quoteEndCharacter) {
    return {
      isInsideQuotedText: true,
      quoteEndCharacter: input.quoteEndCharacter,
      shouldSkipNextCharacter: false,
    };
  }

  const shouldSkipNextCharacter =
    (input.quoteEndCharacter === "'" || input.quoteEndCharacter === '"') &&
    input.nextCharacter === input.quoteEndCharacter;

  return {
    isInsideQuotedText: true,
    quoteEndCharacter: shouldSkipNextCharacter ? input.quoteEndCharacter : null,
    shouldSkipNextCharacter,
  };
};

const findSqlKeywordOutsideQuotes = (input: {
  keyword: string;
  sql: string;
}): number => {
  const normalizedKeyword = input.keyword.toLowerCase();
  let quoteEndCharacter: string | null = null;

  for (
    let index = 0;
    index <= input.sql.length - input.keyword.length;
    index++
  ) {
    const character = input.sql[index] ?? "";
    const quoteState = advanceSqlQuoteState({
      character,
      nextCharacter: input.sql[index + 1],
      quoteEndCharacter,
    });
    quoteEndCharacter = quoteState.quoteEndCharacter;
    if (quoteState.shouldSkipNextCharacter) {
      index++;
    }
    if (quoteState.isInsideQuotedText) {
      continue;
    }

    const candidate = input.sql
      .slice(index, index + input.keyword.length)
      .toLowerCase();
    if (candidate !== normalizedKeyword) {
      continue;
    }

    const previousCharacter = input.sql[index - 1];
    const nextCharacter = input.sql[index + input.keyword.length];
    if (
      !(
        SQL_WORD_CHARACTER_PATTERN.test(previousCharacter ?? "") ||
        SQL_WORD_CHARACTER_PATTERN.test(nextCharacter ?? "")
      )
    ) {
      return index;
    }
  }

  return -1;
};

const findNextOpenParenthesisOutsideQuotes = (input: {
  fromIndex: number;
  sql: string;
}): number => {
  let quoteEndCharacter: string | null = null;

  for (let index = input.fromIndex; index < input.sql.length; index++) {
    const character = input.sql[index] ?? "";
    const quoteState = advanceSqlQuoteState({
      character,
      nextCharacter: input.sql[index + 1],
      quoteEndCharacter,
    });
    quoteEndCharacter = quoteState.quoteEndCharacter;
    if (quoteState.shouldSkipNextCharacter) {
      index++;
    }
    if (quoteState.isInsideQuotedText) {
      continue;
    }

    if (character === "(") {
      return index;
    }
  }

  return -1;
};

const extractSqlParenthesizedContent = (input: {
  openParenthesisIndex: number;
  sql: string;
}): string | null => {
  let depth = 0;
  let quoteEndCharacter: string | null = null;

  for (
    let index = input.openParenthesisIndex;
    index < input.sql.length;
    index++
  ) {
    const character = input.sql[index] ?? "";
    const quoteState = advanceSqlQuoteState({
      character,
      nextCharacter: input.sql[index + 1],
      quoteEndCharacter,
    });
    quoteEndCharacter = quoteState.quoteEndCharacter;
    if (quoteState.shouldSkipNextCharacter) {
      index++;
    }
    if (quoteState.isInsideQuotedText) {
      continue;
    }

    if (character === "(") {
      depth++;
      continue;
    }

    if (character === ")") {
      depth--;
      if (depth === 0) {
        return input.sql.slice(input.openParenthesisIndex + 1, index);
      }
    }
  }

  return null;
};

const splitSqlTopLevelCommaList = (value: string): string[] => {
  const items: string[] = [];
  let depth = 0;
  let quoteEndCharacter: string | null = null;
  let itemStartIndex = 0;

  for (let index = 0; index < value.length; index++) {
    const character = value[index] ?? "";
    const quoteState = advanceSqlQuoteState({
      character,
      nextCharacter: value[index + 1],
      quoteEndCharacter,
    });
    quoteEndCharacter = quoteState.quoteEndCharacter;
    if (quoteState.shouldSkipNextCharacter) {
      index++;
    }
    if (quoteState.isInsideQuotedText) {
      continue;
    }

    if (character === "(") {
      depth++;
      continue;
    }

    if (character === ")") {
      depth--;
      continue;
    }

    if (character === "," && depth === 0) {
      items.push(value.slice(itemStartIndex, index));
      itemStartIndex = index + 1;
    }
  }

  items.push(value.slice(itemStartIndex));
  return items;
};

const extractRemoteIndexColumnList = (sql: string): string | null => {
  const onKeywordIndex = findSqlKeywordOutsideQuotes({
    keyword: "on",
    sql,
  });
  if (onKeywordIndex < 0) {
    return null;
  }

  const openParenthesisIndex = findNextOpenParenthesisOutsideQuotes({
    fromIndex: onKeywordIndex + "on".length,
    sql,
  });
  if (openParenthesisIndex < 0) {
    return null;
  }

  return extractSqlParenthesizedContent({
    openParenthesisIndex,
    sql,
  });
};

const parseRemoteIndexColumns = (sql: string): SqliteIndexColumnRow[] => {
  const columnList = extractRemoteIndexColumnList(sql);
  if (!columnList) {
    return [];
  }

  return splitSqlTopLevelCommaList(columnList).flatMap((columnSql, seqno) => {
    const columnMatch = columnSql.trim().match(INDEX_COLUMN_PATTERN);
    if (!columnMatch) {
      return [];
    }

    return [
      {
        desc: SQL_DESC_PATTERN.test(columnMatch[2] ?? ""),
        key: 1,
        name: stripSqlIdentifierQuotes(columnMatch[1] ?? ""),
        seqno,
      },
    ];
  });
};

const parseRemoteIndexDefinitions = (input: {
  expectedIndexNames: readonly string[];
  rows: readonly RemoteSqliteIndexDefinitionRow[];
}): {
  blockedReason: string | null;
  indexColumnsByName: Map<string, SqliteIndexColumnRow[]>;
} => {
  const indexColumnsByName = new Map<string, SqliteIndexColumnRow[]>();

  for (const row of input.rows) {
    const indexName = String(row.index_name ?? "").trim();
    if (indexName.length === 0) {
      continue;
    }

    indexColumnsByName.set(
      indexName,
      parseRemoteIndexColumns(String(row.sql ?? ""))
    );
  }

  const missingIndexNames = input.expectedIndexNames.filter((indexName) => {
    return !indexColumnsByName.has(indexName);
  });
  if (missingIndexNames.length > 0) {
    return {
      blockedReason: `unable to inspect index definitions: ${missingIndexNames.join(", ")}`,
      indexColumnsByName,
    };
  }

  return {
    blockedReason: null,
    indexColumnsByName,
  };
};

const loadRemotePhysicalContractMetadata = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
  tableNames: readonly string[];
}): {
  blockedReason: string | null;
  indexColumnsByName: Map<string, SqliteIndexColumnRow[]>;
  indexListRowsByTableName: Map<string, SqliteIndexListRow[]>;
  tableInfoRowsByName: Map<string, SqliteTableInfoRow[]>;
} => {
  const tableNameSql = buildSqlStringList(input.tableNames);
  const tableInfoResult = runSharedWranglerJsonQuery<RemoteSqliteTableInfoRow>({
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    sql: `
      SELECT
        m.name AS table_name,
        p.name,
        p.type,
        p.[notnull] AS not_null,
        p.pk
      FROM sqlite_master AS m
      JOIN pragma_table_xinfo(m.name) AS p
      WHERE m.type = 'table'
        AND m.name IN (${tableNameSql});
    `,
  });
  if (tableInfoResult.blockedReason) {
    return {
      blockedReason: tableInfoResult.blockedReason,
      indexColumnsByName: new Map(),
      indexListRowsByTableName: new Map(),
      tableInfoRowsByName: new Map(),
    };
  }

  const indexListResult = runSharedWranglerJsonQuery<RemoteSqliteIndexListRow>({
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    sql: `
      SELECT
        m.name AS table_name,
        il.name,
        il.[unique] AS [unique],
        il.origin
      FROM sqlite_master AS m
      JOIN pragma_index_list(m.name) AS il
      WHERE m.type = 'table'
        AND m.name IN (${tableNameSql});
    `,
  });
  if (indexListResult.blockedReason) {
    return {
      blockedReason: indexListResult.blockedReason,
      indexColumnsByName: new Map(),
      indexListRowsByTableName: new Map(),
      tableInfoRowsByName: new Map(),
    };
  }

  const actualIndexNames = new Set(
    indexListResult.rows.map((row) => String(row.name ?? "").trim())
  );
  const indexNamesToInspect = Array.from(
    new Set([
      ...SHARED_REQUIRED_NAMED_INDEXES.flatMap((index) => {
        return actualIndexNames.has(index.indexName) ? [index.indexName] : [];
      }),
      ...indexListResult.rows.flatMap((row) => {
        const indexName = String(row.name ?? "").trim();
        if (
          indexName.length === 0 ||
          Number(row.unique ?? 0) !== 1 ||
          String(row.origin ?? "").trim() === "pk"
        ) {
          return [];
        }

        return [indexName];
      }),
    ])
  );

  const indexDefinitionResult =
    indexNamesToInspect.length === 0
      ? { blockedReason: null, rows: [] }
      : runSharedWranglerJsonQuery<RemoteSqliteIndexDefinitionRow>({
          mode: input.mode,
          packagesDbDirectoryPath: input.packagesDbDirectoryPath,
          runner: input.runner,
          sql: `
            SELECT
              name AS index_name,
              sql
            FROM sqlite_master
            WHERE type = 'index'
              AND name IN (${buildSqlStringList(indexNamesToInspect)});
          `,
        });
  if (indexDefinitionResult.blockedReason) {
    return {
      blockedReason: indexDefinitionResult.blockedReason,
      indexColumnsByName: new Map(),
      indexListRowsByTableName: new Map(),
      tableInfoRowsByName: new Map(),
    };
  }

  const tableInfoRowsByName = new Map<string, SqliteTableInfoRow[]>();
  for (const row of tableInfoResult.rows) {
    const tableName = normalizeSqliteIdentifier(row.table_name);
    const rows = tableInfoRowsByName.get(tableName) ?? [];
    rows.push({
      name: row.name,
      notnull: row.not_null,
      pk: row.pk,
      type: row.type,
    });
    tableInfoRowsByName.set(tableName, rows);
  }

  const indexListRowsByTableName = new Map<string, SqliteIndexListRow[]>();
  for (const row of indexListResult.rows) {
    const tableName = normalizeSqliteIdentifier(row.table_name);
    const rows = indexListRowsByTableName.get(tableName) ?? [];
    rows.push({
      name: row.name,
      origin: row.origin,
      unique: row.unique,
    });
    indexListRowsByTableName.set(tableName, rows);
  }

  const indexDefinitionParseResult = parseRemoteIndexDefinitions({
    expectedIndexNames: indexNamesToInspect,
    rows: indexDefinitionResult.rows,
  });
  if (indexDefinitionParseResult.blockedReason) {
    return {
      blockedReason: indexDefinitionParseResult.blockedReason,
      indexColumnsByName: new Map(),
      indexListRowsByTableName: new Map(),
      tableInfoRowsByName: new Map(),
    };
  }

  return {
    blockedReason: null,
    indexColumnsByName: indexDefinitionParseResult.indexColumnsByName,
    indexListRowsByTableName,
    tableInfoRowsByName,
  };
};

const inspectRequiredTablePhysicalContractFromMetadata = (input: {
  indexColumnsByName: Map<string, SqliteIndexColumnRow[]>;
  indexListRowsByTableName: Map<string, SqliteIndexListRow[]>;
  tableInfoRowsByName: Map<string, SqliteTableInfoRow[]>;
  tableName: string;
}): SharedDbPhysicalContractInspection => {
  const tableNameKey = normalizeSqliteIdentifier(input.tableName);
  const tableInfoRows = input.tableInfoRowsByName.get(tableNameKey) ?? [];
  if (tableInfoRows.length === 0) {
    return {
      detail: `required table ${input.tableName}`,
      status: "drift_detected",
    };
  }

  for (const requiredColumn of SHARED_REQUIRED_TABLE_COLUMNS.filter(
    (column) => column.tableName === input.tableName
  )) {
    const failure = verifyRequiredTableColumn({
      actualRows: tableInfoRows,
      requiredColumn,
    });
    if (failure) {
      return {
        detail: failure,
        status: "drift_detected",
      };
    }
  }

  const indexListRows = input.indexListRowsByTableName.get(tableNameKey) ?? [];
  for (const requiredIndex of SHARED_REQUIRED_NAMED_INDEXES.filter(
    (index) => index.tableName === input.tableName
  )) {
    const failure = verifyRequiredNamedIndex({
      actualIndexColumns:
        input.indexColumnsByName.get(requiredIndex.indexName) ?? [],
      actualIndexListRows: indexListRows,
      requiredIndex,
    });
    if (failure) {
      return {
        detail: failure,
        status: "drift_detected",
      };
    }
  }

  const uniqueConstraintFailure = verifyExactUniqueConstraints({
    actualIndexColumnsByName: input.indexColumnsByName,
    actualIndexListRows: indexListRows,
    actualTableInfoRows: tableInfoRows,
    tableName: input.tableName,
  });
  if (uniqueConstraintFailure) {
    return {
      detail: uniqueConstraintFailure,
      status: "drift_detected",
    };
  }

  return {
    detail: null,
    status: "ok",
  };
};

const inspectRemoteCoreDispatchPhysicalContract = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
  tableNames: readonly string[];
}): SharedDbPhysicalContractInspection => {
  const metadata = loadRemotePhysicalContractMetadata(input);
  if (metadata.blockedReason) {
    return {
      detail: metadata.blockedReason,
      status: "blocked",
    };
  }

  for (const tableName of input.tableNames) {
    const inspection = inspectRequiredTablePhysicalContractFromMetadata({
      indexColumnsByName: metadata.indexColumnsByName,
      indexListRowsByTableName: metadata.indexListRowsByTableName,
      tableInfoRowsByName: metadata.tableInfoRowsByName,
      tableName,
    });
    if (inspection.status !== "ok") {
      return inspection;
    }
  }

  return {
    detail: null,
    status: "ok",
  };
};

type SharedDbPhysicalTarget = {
  localDbPath?: string;
  targetLabel: string | null;
  wranglerConfigAbsolutePath?: string;
};

const addSharedDbTargetLabel = (input: {
  inspection: SharedDbPhysicalContractInspection;
  targetLabel: string | null;
}): SharedDbPhysicalContractInspection => {
  return {
    ...input.inspection,
    detail:
      input.inspection.detail && input.targetLabel
        ? `${input.targetLabel}: ${input.inspection.detail}`
        : input.inspection.detail,
  };
};

const inspectSharedDbPhysicalTarget = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
  tableNames: readonly string[];
  target: SharedDbPhysicalTarget;
}): SharedDbPhysicalContractInspection => {
  const migrationInspection = inspectAppliedSharedMigration({
    localDbPath: input.target.localDbPath,
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    wranglerConfigAbsolutePath: input.target.wranglerConfigAbsolutePath,
  });
  if (migrationInspection.status !== "ok") {
    return addSharedDbTargetLabel({
      inspection: migrationInspection,
      targetLabel: input.target.targetLabel,
    });
  }

  for (const tableName of input.tableNames) {
    const inspection = inspectRequiredTablePhysicalContract({
      localDbPath: input.target.localDbPath,
      tableName,
      mode: input.mode,
      packagesDbDirectoryPath: input.packagesDbDirectoryPath,
      runner: input.runner,
      wranglerConfigAbsolutePath: input.target.wranglerConfigAbsolutePath,
    });
    if (inspection.status !== "ok") {
      return addSharedDbTargetLabel({
        inspection,
        targetLabel: input.target.targetLabel,
      });
    }
  }

  return {
    detail: null,
    status: "ok",
  };
};

export const inspectSharedCoreDispatchPhysicalContract = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner: ToolingCommandRunner;
}): SharedDbPhysicalContractInspection => {
  const packagesDbDirectoryPath =
    input.packagesDbDirectoryPath ?? getPackagesDbDirectoryPath();
  const tableNames = Array.from(
    new Set(SHARED_REQUIRED_TABLE_COLUMNS.map((column) => column.tableName))
  );

  if (input.mode === "prod") {
    const migrationInspection = inspectAppliedSharedMigration({
      mode: input.mode,
      packagesDbDirectoryPath,
      runner: input.runner,
    });
    if (migrationInspection.status !== "ok") {
      return migrationInspection;
    }

    return inspectRemoteCoreDispatchPhysicalContract({
      mode: input.mode,
      packagesDbDirectoryPath,
      runner: input.runner,
      tableNames,
    });
  }

  let targets: SharedDbPhysicalTarget[] | null = null;

  try {
    targets =
      input.mode === "dev"
        ? listSharedLocalWorkerDbTargets().map((target) => ({
            localDbPath: target.localPath,
            targetLabel: target.targetLabel,
            wranglerConfigAbsolutePath: target.wranglerConfigAbsolutePath,
          }))
        : [
            {
              localDbPath: undefined,
              targetLabel: null,
              wranglerConfigAbsolutePath: undefined,
            },
          ];
  } catch (error) {
    if (
      input.mode === "dev" &&
      error instanceof MissingLocalWranglerSqliteCandidatesError
    ) {
      return {
        detail:
          "local OPENMELD_DB has not been initialized; apply the committed migrations",
        status: "drift_detected",
      };
    }

    return {
      detail: error instanceof Error ? error.message : String(error),
      status: "blocked",
    };
  }

  for (const target of targets) {
    const inspection = inspectSharedDbPhysicalTarget({
      mode: input.mode,
      packagesDbDirectoryPath,
      runner: input.runner,
      tableNames,
      target,
    });
    if (inspection.status !== "ok") {
      return inspection;
    }
  }

  return {
    detail: null,
    status: "ok",
  };
};

export const verifySharedCoreDispatchPhysicalContract = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner: ToolingCommandRunner;
}): string | null => {
  return inspectSharedCoreDispatchPhysicalContract(input).detail;
};
