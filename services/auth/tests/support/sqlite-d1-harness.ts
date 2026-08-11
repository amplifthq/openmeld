import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type SqliteBindValue = number | string | null;

type TestPreparedStatement = D1PreparedStatement & {
  __runInTransaction: () => unknown;
};

type SqliteD1HarnessOptions = {
  rejectExplicitTransactions?: boolean;
};

const EXPLICIT_TRANSACTION_STATEMENT_PATTERN =
  /^\s*(?:begin|commit|release|rollback|savepoint)\b/iu;

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

export type SqliteD1Harness = ReturnType<typeof createSqliteD1Harness>;

export function createSqliteD1Harness(options: SqliteD1HarnessOptions = {}) {
  const database = new DatabaseSync(":memory:");
  const rejectExplicitTransactions = options.rejectExplicitTransactions ?? true;

  return {
    close: () => {
      database.close();
    },
    database,
    db: createD1Database(database, rejectExplicitTransactions),
    queryAll: <TRow extends Record<string, unknown>>(input: {
      params?: readonly SqliteBindValue[];
      sql: string;
    }) => database.prepare(input.sql).all(...(input.params ?? [])) as TRow[],
    queryFirst: <TRow extends Record<string, unknown>>(input: {
      params?: readonly SqliteBindValue[];
      sql: string;
    }) =>
      (database.prepare(input.sql).get(...(input.params ?? [])) as
        | TRow
        | undefined) ?? null,
    run: (input: { params?: readonly SqliteBindValue[]; sql: string }) =>
      database.prepare(input.sql).run(...(input.params ?? [])),
  };
}

export function applyDrizzleMigrations(database: DatabaseSync): void {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  for (const entry of fs
    .readdirSync(migrationDirectoryPath)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))) {
    const source = fs.readFileSync(
      path.resolve(migrationDirectoryPath, entry),
      "utf8"
    );
    for (const statement of source
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)) {
      database.exec(statement);
    }
  }
}

function createD1Database(
  database: DatabaseSync,
  rejectExplicitTransactions: boolean
): D1Database {
  return {
    batch: (statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          runPreparedStatementInTransaction(statement)
        );
        database.exec("COMMIT");
        return Promise.resolve(results as D1Result[]);
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error);
      }
    },
    exec: (sql: string) => {
      if (
        rejectExplicitTransactions &&
        EXPLICIT_TRANSACTION_STATEMENT_PATTERN.test(sql)
      ) {
        return Promise.reject(createExplicitTransactionNotSupportedError(sql));
      }
      database.exec(sql);
      return Promise.resolve({
        count: 0,
        duration: 0,
      } as D1ExecResult);
    },
    prepare: (sql: string) => {
      if (
        rejectExplicitTransactions &&
        EXPLICIT_TRANSACTION_STATEMENT_PATTERN.test(sql)
      ) {
        return createUnsupportedExplicitTransactionStatement(sql);
      }
      return createPreparedStatement(
        database.prepare(sql),
        []
      ) as D1PreparedStatement;
    },
  } as D1Database;
}

function createUnsupportedExplicitTransactionStatement(
  sql: string
): D1PreparedStatement {
  const reject = () =>
    Promise.reject(createExplicitTransactionNotSupportedError(sql));
  const statement = {
    all: reject,
    bind: () => statement,
    first: reject,
    raw: reject,
    run: reject,
  };
  return statement as unknown as D1PreparedStatement;
}

function createExplicitTransactionNotSupportedError(_sql: string): Error {
  return new Error(
    "sqlite D1 harness rejects explicit transaction statements; use batch()"
  );
}

function createPreparedStatement(
  statement: StatementSync,
  params: readonly SqliteBindValue[]
): TestPreparedStatement {
  return {
    __runInTransaction: () => {
      if (statement.columns().length > 0) {
        const results = statement.all(...params);
        return {
          meta: {
            changes: results.length,
          },
          results,
          success: true,
        } as D1Result;
      }
      return toD1RunResult(statement.run(...params));
    },
    all: <TRow>() =>
      Promise.resolve({
        results: statement.all(...params) as TRow[],
        success: true,
      }),
    bind: (...nextParams: unknown[]) =>
      createPreparedStatement(
        statement,
        nextParams as readonly SqliteBindValue[]
      ) as D1PreparedStatement,
    first: <TRow>(columnName?: string) => {
      const row = statement.get(...params) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        return Promise.resolve(null as TRow | null);
      }
      if (columnName) {
        return Promise.resolve((row[columnName] as TRow | undefined) ?? null);
      }
      return Promise.resolve(row as TRow);
    },
    raw: <TRow = unknown[]>() => {
      statement.setReturnArrays(true);
      try {
        return Promise.resolve(statement.all(...params) as TRow[]);
      } finally {
        statement.setReturnArrays(false);
      }
    },
    run: async () => toD1RunResult(statement.run(...params)),
  } as TestPreparedStatement;
}

function runPreparedStatementInTransaction(
  statement: D1PreparedStatement
): unknown {
  const candidate = statement as Partial<TestPreparedStatement>;
  if (typeof candidate.__runInTransaction !== "function") {
    throw new Error("sqlite D1 harness received an unknown prepared statement");
  }

  return candidate.__runInTransaction();
}

function toD1RunResult(
  result: Pick<{ changes: number | bigint }, "changes">
): D1Result {
  return {
    meta: {
      changes: Number(result.changes),
    },
    success: true,
  } as D1Result;
}
