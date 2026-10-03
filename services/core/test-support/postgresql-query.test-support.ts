import {
  type PoolClient,
  type PostgreSQLBinding,
  PostgresDatabase,
  type QueryConfig,
  type QueryResult,
  type QueryResultRow,
} from "@openmeld/db/postgresql";
import { onTestFinished, vi } from "vitest";

/** Pure projection fixtures use the vendor result contract, never a SQL emulator. */
export function nativeQueryResult<Row extends QueryResultRow>(
  rows: Row[],
  command = "SELECT"
): QueryResult<Row> {
  return { command, rowCount: rows.length, oid: 0, fields: [], rows };
}

export function createProjectionPostgresDatabase(
  readRows: (query: QueryConfig) => QueryResultRow[]
): PostgresDatabase {
  const db = new PostgresDatabase({
    connectionString:
      "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
  });
  vi.spyOn(db, "query").mockImplementation(async (query, values) =>
    nativeQueryResult(
      readRows(typeof query === "string" ? { text: query, values } : query)
    )
  );
  return db;
}

/** Request owners create a façade from the binding; static projection fixtures follow that contract. */
export function createProjectionPostgresBinding(
  readRows: (query: QueryConfig) => QueryResultRow[]
): PostgreSQLBinding {
  const binding = {
    connectionString:
      "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
  };
  const spy = vi
    .spyOn(PostgresDatabase.prototype, "query")
    .mockImplementation(async (query, values) =>
      nativeQueryResult(
        readRows(typeof query === "string" ? { text: query, values } : query)
      )
    );
  onTestFinished(() => spy.mockRestore());
  return binding;
}

/** Surround real pg queries with a race or fault hook; SQL execution remains native. */
export function observePostgresDatabase(
  db: PostgresDatabase,
  beforeQuery: (query: QueryConfig) => void | Promise<void>
): PostgresDatabase {
  const observeClient = (client: PoolClient) =>
    new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return async (query: string | QueryConfig, values?: unknown[]) => {
            await beforeQuery(
              typeof query === "string" ? { text: query, values } : query
            );
            return target.query(query, values);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(db, {
    get(target, property) {
      if (property === "query") {
        return async (query: string | QueryConfig, values?: unknown[]) => {
          await beforeQuery(
            typeof query === "string" ? { text: query, values } : query
          );
          return target.query(query, values);
        };
      }
      if (property === "transaction") {
        return (callback: (client: PoolClient) => Promise<unknown>) =>
          target.transaction((client) => callback(observeClient(client)));
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
