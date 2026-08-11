import { type AnySQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";

export type SqliteRequiredSchemaObject = {
  name: string;
  type: "index" | "table";
};

export type SqliteRequiredTableColumn = {
  columnName: string;
  notNull: boolean;
  primaryKey: boolean;
  sqliteType: string;
  tableName: string;
};

export type SqliteRequiredNamedIndexColumn = {
  columnName: string;
  descending: boolean;
};

export type SqliteRequiredNamedIndex = {
  columns: readonly SqliteRequiredNamedIndexColumn[];
  indexName: string;
  isUnique: boolean;
  tableName: string;
};

export type SqliteRequiredUniqueConstraint = {
  columnNames: readonly string[];
  tableName: string;
};

export type SqliteSchemaRequirements = {
  namedIndexes: SqliteRequiredNamedIndex[];
  schemaObjects: SqliteRequiredSchemaObject[];
  tableColumns: SqliteRequiredTableColumn[];
  uniqueConstraints: SqliteRequiredUniqueConstraint[];
};

const sortByName = <T extends { name: string }>(items: readonly T[]): T[] => {
  return [...items].sort((left, right) => {
    return left.name.localeCompare(right.name);
  });
};

const sortByTableThenName = <T extends { tableName: string }>(
  items: readonly T[],
  getName: (item: T) => string
): T[] => {
  return [...items].sort((left, right) => {
    const tableComparison = left.tableName.localeCompare(right.tableName);
    if (tableComparison !== 0) {
      return tableComparison;
    }

    return getName(left).localeCompare(getName(right));
  });
};

const toUpperSqliteType = (value: string): string => {
  return value.trim().toUpperCase();
};

const hasNamedIndexColumn = (
  value: unknown
): value is {
  name: string;
} => {
  return (
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    typeof value.name === "string"
  );
};

const hasQueryChunks = (
  value: unknown
): value is {
  queryChunks: unknown[];
} => {
  return (
    value !== null &&
    typeof value === "object" &&
    "queryChunks" in value &&
    Array.isArray(value.queryChunks)
  );
};

const resolveQueryChunkText = (chunk: unknown): string => {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (
    chunk &&
    typeof chunk === "object" &&
    "value" in chunk &&
    Array.isArray(chunk.value)
  ) {
    return chunk.value.join("");
  }

  return "";
};

const resolveQueryChunkIndexColumnDefinition = (
  queryChunks: readonly unknown[]
): SqliteRequiredNamedIndexColumn | null => {
  let columnName: string | null = null;
  let descending = false;

  for (const chunk of queryChunks) {
    if (hasNamedIndexColumn(chunk)) {
      columnName = chunk.name;
      continue;
    }

    const chunkText = resolveQueryChunkText(chunk);
    if (chunkText.toLowerCase().includes("desc")) {
      descending = true;
    }
  }

  if (!columnName) {
    return null;
  }

  return {
    columnName,
    descending,
  };
};

const resolveIndexColumnDefinition = (
  indexColumn: unknown
): SqliteRequiredNamedIndexColumn => {
  if (hasNamedIndexColumn(indexColumn)) {
    return {
      columnName: indexColumn.name,
      descending: false,
    };
  }

  if (hasQueryChunks(indexColumn)) {
    const resolvedDefinition = resolveQueryChunkIndexColumnDefinition(
      indexColumn.queryChunks
    );
    if (resolvedDefinition) {
      return resolvedDefinition;
    }
  }

  throw new Error(
    `Unsupported drizzle index column definition: ${String(indexColumn)}`
  );
};

const resolveTablePrimaryKeyColumnNames = (
  config: ReturnType<typeof getTableConfig>
): Set<string> => {
  const columnNames = new Set(
    config.columns
      .filter((column) => column.primary)
      .map((column) => column.name)
  );

  for (const primaryKey of config.primaryKeys) {
    for (const column of primaryKey.columns) {
      columnNames.add(column.name);
    }
  }

  return columnNames;
};

export const buildSqliteSchemaRequirements = (
  schema: Record<string, AnySQLiteTable>
): SqliteSchemaRequirements => {
  const tables = Object.values(schema);

  const schemaObjects = sortByName(
    tables.flatMap((table) => {
      const config = getTableConfig(table);

      return [
        {
          name: config.name,
          type: "table" as const,
        },
        ...config.indexes.flatMap((index) => {
          return index.config.name
            ? [
                {
                  name: index.config.name,
                  type: "index" as const,
                },
              ]
            : [];
        }),
      ];
    })
  );

  const tableColumns = tables.flatMap((table) => {
    const config = getTableConfig(table);
    const primaryKeyColumnNames = resolveTablePrimaryKeyColumnNames(config);

    return config.columns.map((column) => {
      const primaryKey = primaryKeyColumnNames.has(column.name);
      return {
        tableName: config.name,
        columnName: column.name,
        sqliteType: toUpperSqliteType(column.getSQLType()),
        notNull: primaryKey ? true : column.notNull,
        primaryKey,
      };
    });
  });

  const namedIndexes = sortByTableThenName(
    tables.flatMap((table) => {
      const config = getTableConfig(table);

      return config.indexes.flatMap((index) => {
        if (!index.config.name) {
          return [];
        }

        return [
          {
            tableName: config.name,
            indexName: index.config.name,
            isUnique: Boolean(index.config.unique),
            columns: index.config.columns.map((column) => {
              return resolveIndexColumnDefinition(column);
            }),
          },
        ];
      });
    }),
    (item) => item.indexName
  );

  const uniqueConstraints = sortByTableThenName(
    tables.flatMap((table) => {
      const config = getTableConfig(table);

      const columnUniqueConstraints = config.columns.flatMap((column) => {
        if (!column.isUnique) {
          return [];
        }

        return [
          {
            tableName: config.name,
            columnNames: [column.name],
          },
        ];
      });

      const namedUniqueConstraints = config.indexes.flatMap((index) => {
        if (!index.config.unique) {
          return [];
        }

        return [
          {
            tableName: config.name,
            columnNames: index.config.columns.map((column) => {
              return resolveIndexColumnDefinition(column).columnName;
            }),
          },
        ];
      });

      return [...columnUniqueConstraints, ...namedUniqueConstraints];
    }),
    (item) => item.columnNames.join(",")
  );

  return {
    namedIndexes,
    schemaObjects,
    tableColumns,
    uniqueConstraints,
  };
};
