import {
  type PoolClient,
  type PostgreSQLBinding,
  PostgresDatabase,
  type QueryConfig,
  type QueryResult,
  type QueryResultRow,
} from "@openmeld/db/postgresql";
import { onTestFinished, vi } from "vitest";
import {
  postgresTestBinding as nativePostgresTestBinding,
  registerTestDatabaseBinding,
} from "../../../../tooling/postgresql/test-harness";

// biome-ignore lint/performance/noBarrelFile: All Core fixtures share the native journal and fault owner.
export {
  createPostgresHarness,
  installPostgresWriteFailure,
  preparePostgresTestTemplate,
} from "../../../../tooling/postgresql/test-harness";

export function postgresTestBinding(db: PostgresDatabase): PostgreSQLBinding {
  if (db instanceof ObservedPostgresDatabase) {
    db.observeRequests();
  }
  return nativePostgresTestBinding(db);
}

type QueryHook = (query: QueryConfig) => void | Promise<void>;
/** Request façades are recreated from bindings; observe their native calls without replacing SQL behavior. */
export function observeNativePostgresQueries(beforeQuery: QueryHook) {
  const nativeQuery = PostgresDatabase.prototype.query;
  return vi
    .spyOn(PostgresDatabase.prototype, "query")
    .mockImplementation(async function (this: PostgresDatabase, query, values) {
      await beforeQuery(
        typeof query === "string" ? { text: query, values } : query
      );
      return nativeQuery.call(this, query, values);
    });
}
type TransactionHooks = {
  beforeQuery?: QueryHook;
  afterTransaction?: () => Promise<void>;
  repeatTransaction?: () => boolean;
};

/** Fault/race controls surround native calls; they never translate SQL or emulate a backend. */
class ObservedPostgresDatabase extends PostgresDatabase {
  private requestObserverInstalled = false;
  private readonly delegate: PostgresDatabase;
  private readonly hooks: TransactionHooks;
  constructor(delegate: PostgresDatabase, hooks: TransactionHooks) {
    super(postgresTestBinding(delegate));
    this.delegate = delegate;
    this.hooks = hooks;
    registerTestDatabaseBinding(this, postgresTestBinding(delegate));
  }

  /** Request façades lose object identity; observe the native request entrypoints as well. */
  observeRequests(): void {
    if (this.requestObserverInstalled) {
      return;
    }
    this.requestObserverInstalled = true;
    const hooks = this.hooks;
    const nativeQuery = PostgresDatabase.prototype.query;
    const nativeTransaction = PostgresDatabase.prototype.transaction;
    const querySpy = vi
      .spyOn(PostgresDatabase.prototype, "query")
      .mockImplementation(async function (
        this: PostgresDatabase,
        query,
        values
      ) {
        await hooks.beforeQuery?.(
          typeof query === "string" ? { text: query, values } : query
        );
        return nativeQuery.call(this, query, values);
      });
    const transactionSpy = vi
      .spyOn(PostgresDatabase.prototype, "transaction")
      .mockImplementation(async function (this: PostgresDatabase, callback) {
        const observedCallback = (client: PoolClient) =>
          callback(
            new Proxy(client, {
              get(target, property) {
                if (property === "query") {
                  return async (
                    query: string | QueryConfig,
                    values?: unknown[]
                  ) => {
                    await hooks.beforeQuery?.(
                      typeof query === "string"
                        ? { text: query, values }
                        : query
                    );
                    return target.query(query, values);
                  };
                }
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
              },
            })
          );
        const result = await nativeTransaction.call(this, observedCallback);
        await hooks.afterTransaction?.();
        if (hooks.repeatTransaction?.()) {
          await nativeTransaction.call(this, observedCallback);
        }
        return result;
      });
    onTestFinished(() => {
      transactionSpy.mockRestore();
      querySpy.mockRestore();
    });
  }

  override async query<Row extends QueryResultRow = QueryResultRow>(
    query: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<Row>> {
    const config = typeof query === "string" ? { text: query, values } : query;
    if (!this.requestObserverInstalled) {
      await this.hooks.beforeQuery?.(config);
    }
    return this.delegate.query<Row>(query, values);
  }

  override async transaction<Result>(
    callback: (client: PoolClient) => Promise<Result>
  ): Promise<Result> {
    if (this.requestObserverInstalled) {
      return this.delegate.transaction(callback);
    }
    const observe = (client: PoolClient) =>
      callback(
        new Proxy(client, {
          get: (target, property) => {
            if (property !== "query") {
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return async (query: string | QueryConfig, values?: unknown[]) => {
              await this.hooks.beforeQuery?.(
                typeof query === "string" ? { text: query, values } : query
              );
              return target.query(query, values);
            };
          },
        })
      );
    const result = await this.delegate.transaction(observe);
    await this.hooks.afterTransaction?.();
    if (this.hooks.repeatTransaction?.()) {
      await this.delegate.transaction(observe);
    }
    return result;
  }
}

export function createFaultInjectingPostgresDatabase(input: {
  db: PostgresDatabase;
  failureCount?: number;
  matches: (sql: string) => boolean;
}): PostgresDatabase {
  let remaining = input.failureCount ?? 1;
  return new ObservedPostgresDatabase(input.db, {
    beforeQuery: (query) => {
      if (remaining > 0 && input.matches(query.text)) {
        remaining -= 1;
        throw new Error("injected PostgreSQL query failure");
      }
    },
  });
}

export function createBeforeMatchingPostgresTransaction(input: {
  beforeTransaction: () => void | Promise<void>;
  db: PostgresDatabase;
  matches: (sql: string) => boolean;
}): PostgresDatabase {
  let ran = false;
  return new ObservedPostgresDatabase(input.db, {
    beforeQuery: async (query) => {
      if (!ran && input.matches(query.text)) {
        ran = true;
        await input.beforeTransaction();
      }
    },
  });
}

export function createAfterMatchingPostgresTransaction(input: {
  afterTransaction: () => void | Promise<void>;
  db: PostgresDatabase;
  matches: (sql: string) => boolean;
}): PostgresDatabase {
  let matched = false;
  let ran = false;
  return new ObservedPostgresDatabase(input.db, {
    beforeQuery: (query) => {
      matched ||= input.matches(query.text);
    },
    afterTransaction: async () => {
      if (matched && !ran) {
        ran = true;
        await input.afterTransaction();
      }
    },
  });
}

export function createDuplicateMatchingPostgresTransaction(input: {
  db: PostgresDatabase;
  matches: (sql: string) => boolean;
}): PostgresDatabase {
  let matched = false;
  let repeated = false;
  return new ObservedPostgresDatabase(input.db, {
    beforeQuery: (query) => {
      matched ||= input.matches(query.text);
    },
    repeatTransaction: () => {
      if (!matched || repeated) {
        return false;
      }
      repeated = true;
      return true;
    },
  });
}
