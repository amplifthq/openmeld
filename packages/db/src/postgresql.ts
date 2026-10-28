import { AsyncLocalStorage } from "node:async_hooks";
import { Socket } from "node:net";
import pg, {
  type QueryConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

const HYPERDRIVE_HOST_PATTERN = /^[a-f0-9]{32}\.hyperdrive\.local$/u;
const TLS_OPTION_PATTERN = /^ssl/iu;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

export type PostgreSQLBinding = { connectionString: string };
export type PostgresTransactionRunner = <T>(
  run: () => Promise<T>
) => Promise<T>;
type RequestConnection = {
  binding: PostgreSQLBinding;
  pool: pg.Pool;
  database: PostgresDatabase;
  closed: boolean;
  runTransaction?: PostgresTransactionRunner;
};
const requestConnection = new AsyncLocalStorage<RequestConnection>();
const transactionActive = new AsyncLocalStorage<boolean>();

function requireRuntimeConnectionMode(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("The PostgreSQL runtime connection string is invalid");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const hyperdrive = HYPERDRIVE_HOST_PATTERN.test(url.hostname);
  const requestedTls = [...url.searchParams].some(
    ([key, value]) =>
      TLS_OPTION_PATTERN.test(key) &&
      !(key === "sslmode" && value === "disable")
  );
  if (
    !(
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      (loopback || hyperdrive)
    ) ||
    requestedTls ||
    (process.env.PGSSLMODE && process.env.PGSSLMODE !== "disable")
  ) {
    throw new Error(
      "PostgreSQL runtime connections support only loopback PostgreSQL or a Hyperdrive endpoint without client TLS. Direct TLS connections require the migration tooling."
    );
  }
}

const integerTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === 20 && format !== "binary") {
      return (value: string) => {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) {
          throw new RangeError(
            "PostgreSQL integer exceeds the product's safe integer range"
          );
        }
        return number;
      };
    }
    return pg.types.getTypeParser(oid, format);
  },
};

export async function withPostgresRequest<T>(
  binding: PostgreSQLBinding | undefined,
  callback: () => T | Promise<T>,
  options: {
    reuseConnection?: boolean;
    runTransaction?: PostgresTransactionRunner;
  } = {}
): Promise<T> {
  if (!binding?.connectionString) {
    throw new Error("OPENMELD_POSTGRESQL Hyperdrive binding is required");
  }
  requireRuntimeConnectionMode(binding.connectionString);
  const current = requestConnection.getStore();
  if (
    options.reuseConnection !== false &&
    current?.binding === binding &&
    !current.closed
  ) {
    return callback();
  }
  const pool = new pg.Pool({
    connectionString: binding.connectionString,
    // Limited adaptation for the reproduced pg-cloudflare normal-close error.
    // These endpoints use native TCP; Hyperdrive owns its origin TLS.
    stream: () => new Socket(),
    connectionTimeoutMillis: 10_000,
    types: integerTypes,
    max: 4,
  });
  const scope = {
    binding,
    pool,
    database: new PostgresDatabase(binding),
    closed: false,
    runTransaction:
      options.runTransaction ??
      (options.reuseConnection !== false &&
      current?.binding === binding &&
      current.closed
        ? current.runTransaction
        : undefined),
  };
  try {
    return await requestConnection.run(scope, callback);
  } finally {
    scope.closed = true;
    await pool.end();
  }
}

export function getPostgresRequestPool(): pg.Pool {
  const connection = requestConnection.getStore();
  if (!connection || connection.closed) {
    throw new Error(
      "Authentication database access requires a PostgreSQL request scope"
    );
  }
  return connection.pool;
}

// This owner manages connection lifetime only. Queries and results are native
// node-postgres contracts; SQL is PostgreSQL at its business owner.
export class PostgresDatabase {
  private readonly binding: PostgreSQLBinding;

  constructor(binding: PostgreSQLBinding) {
    this.binding = binding;
  }

  query<T extends QueryResultRow = QueryResultRow>(
    query: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    if (transactionActive.getStore()) {
      throw new Error(
        "Use the explicit transaction client for every query inside a transaction"
      );
    }
    return withPostgresRequest(this.binding, () =>
      getPostgresRequestPool().query<T>(query, values)
    );
  }

  transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (transactionActive.getStore()) {
      throw new Error(
        "Nested PostgreSQL transactions require the owning transaction client"
      );
    }
    return withPostgresRequest(this.binding, () => {
      const execute = async () => {
        const client = await getPostgresRequestPool().connect();
        try {
          await client.query("BEGIN");
          try {
            const result = await transactionActive.run(true, () =>
              callback(client)
            );
            await client.query("COMMIT");
            return result;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        } finally {
          client.release();
        }
      };
      // Admission precedes checkout. The owner can execute directly inside
      // an existing gate or provide a fresh scope without recursive dispatch.
      const runTransaction = requestConnection.getStore()?.runTransaction;
      return runTransaction ? runTransaction(execute) : execute();
    });
  }
}

export function getPostgresDatabase(env: {
  OPENMELD_POSTGRESQL?: PostgreSQLBinding;
}): PostgresDatabase {
  if (!env.OPENMELD_POSTGRESQL) {
    throw new Error("OPENMELD_POSTGRESQL Hyperdrive binding is required");
  }
  const current = requestConnection.getStore();
  if (current?.binding === env.OPENMELD_POSTGRESQL && !current.closed) {
    return current.database;
  }
  return new PostgresDatabase(env.OPENMELD_POSTGRESQL);
}

export type { PoolClient, QueryConfig, QueryResult, QueryResultRow } from "pg";

/** Preserve SQLSTATE across a driver's error or an ORM cause wrapper. */
export function readPostgresErrorCode(error: unknown): string | null {
  let currentError = error;
  const visited = new Set<object>();
  while (
    currentError &&
    typeof currentError === "object" &&
    !visited.has(currentError)
  ) {
    visited.add(currentError);
    if (
      "code" in currentError &&
      typeof currentError.code === "string" &&
      SQLSTATE_PATTERN.test(currentError.code)
    ) {
      return currentError.code;
    }
    currentError = "cause" in currentError ? currentError.cause : undefined;
  }
  return null;
}

/** Match the native server code and constraint, including an ORM's cause. */
export function isPostgresUniqueViolation(
  error: unknown,
  constraint?: string
): boolean {
  return isPostgresConstraintViolation(error, "23505", constraint);
}

export function isPostgresCheckViolation(
  error: unknown,
  constraint: string
): boolean {
  return isPostgresConstraintViolation(error, "23514", constraint);
}

function isPostgresConstraintViolation(
  error: unknown,
  code: string,
  constraint?: string
): boolean {
  let currentError = error;
  const visited = new Set<object>();
  while (
    currentError &&
    typeof currentError === "object" &&
    !visited.has(currentError)
  ) {
    visited.add(currentError);
    if ("code" in currentError && currentError.code === code) {
      return (
        !constraint ||
        ("constraint" in currentError && currentError.constraint === constraint)
      );
    }
    currentError = "cause" in currentError ? currentError.cause : undefined;
  }
  return false;
}
