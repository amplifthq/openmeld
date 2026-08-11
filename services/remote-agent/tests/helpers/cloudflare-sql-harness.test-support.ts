import type { DatabaseSync, StatementSync } from "node:sqlite";

const ROW_RETURNING_SQL_PATTERN =
  /^\s*(?:EXPLAIN|PRAGMA|SELECT)\b|\bRETURNING\b/iu;

export function createCloudflareSqlHarness(database: DatabaseSync) {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = database.prepare(query);
      if (returnsRows(statement, query)) {
        const rows = statement.all(...(bindings as never[])) as Record<
          string,
          unknown
        >[];
        return { rowsWritten: 0, toArray: () => rows };
      }
      const result = statement.run(...(bindings as never[]));
      return {
        rowsWritten: Number(result.changes),
        toArray: () => [] as Record<string, unknown>[],
      };
    },
  };
}

export function createTransactionRunner(database: DatabaseSync) {
  return <T>(closure: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = closure();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
}

function returnsRows(_statement: StatementSync, query: string): boolean {
  return ROW_RETURNING_SQL_PATTERN.test(query);
}
