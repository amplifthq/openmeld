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
const CLIENT_DISPOSAL_TIMEOUT_MS = 2000;
const TRANSACTION_CLEANUP_GRACE_MS = 1000;

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
  transactionTimeoutMs?: number;
};
const requestConnection = new AsyncLocalStorage<RequestConnection>();
const transactionActive = new AsyncLocalStorage<boolean>();

function isFatalPostgresError(error: unknown): error is Error {
  return (
    error instanceof Error && "severity" in error && error.severity === "FATAL"
  );
}

function waitForClientRemoval(pool: pg.Pool, client: pg.PoolClient) {
  return new Promise<boolean>((resolve) => {
    const removed = (removedClient: pg.PoolClient) => {
      if (removedClient === client) {
        clearTimeout(timeout);
        pool.removeListener("remove", removed);
        resolve(true);
      }
    };
    const timeout = setTimeout(() => {
      pool.removeListener("remove", removed);
      resolve(false);
    }, CLIENT_DISPOSAL_TIMEOUT_MS);
    pool.on("remove", removed);
  });
}

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
    transactionTimeoutMs?: number;
  } = {}
): Promise<T> {
  if (!binding?.connectionString) {
    throw new Error("OPENMELD_POSTGRESQL Hyperdrive binding is required");
  }
  requireRuntimeConnectionMode(binding.connectionString);
  if (
    options.transactionTimeoutMs !== undefined &&
    (!Number.isInteger(options.transactionTimeoutMs) ||
      options.transactionTimeoutMs < 1 ||
      options.transactionTimeoutMs >
        2_147_483_647 - TRANSACTION_CLEANUP_GRACE_MS)
  ) {
    throw new Error(
      "PostgreSQL transaction timeout must be a positive timer interval"
    );
  }
  const current = requestConnection.getStore();
  if (
    options.reuseConnection !== false &&
    current?.binding === binding &&
    !current.closed
  ) {
    return callback();
  }
  const inherited =
    options.reuseConnection !== false &&
    current?.binding === binding &&
    current.closed
      ? current
      : undefined;
  const transactionTimeoutMs =
    options.transactionTimeoutMs ?? inherited?.transactionTimeoutMs;
  const pool = new pg.Pool({
    connectionString: binding.connectionString,
    // Limited adaptation for the reproduced pg-cloudflare normal-close error.
    // These endpoints use native TCP; Hyperdrive owns its origin TLS.
    stream: () => new Socket(),
    connectionTimeoutMillis: Math.min(10_000, transactionTimeoutMs ?? 10_000),
    types: integerTypes,
    max: 4,
  });
  const scope = {
    binding,
    pool,
    database: new PostgresDatabase(binding),
    closed: false,
    runTransaction: options.runTransaction ?? inherited?.runTransaction,
    transactionTimeoutMs,
  };
  try {
    return await requestConnection.run(scope, callback);
  } finally {
    scope.closed = true;
    await pool.end();
  }
}

export function getPostgresRequestPool(): pg.Pool {
  return requirePostgresRequestConnection().pool;
}

function requirePostgresRequestConnection(): RequestConnection {
  const connection = requestConnection.getStore();
  if (!connection || connection.closed) {
    throw new Error(
      "Authentication database access requires a PostgreSQL request scope"
    );
  }
  return connection;
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
        const connection = requirePostgresRequestConnection();
        const timeoutMs = connection.transactionTimeoutMs;
        const startedAt = Date.now();
        let client: pg.PoolClient | undefined;
        let interrupted: Error | undefined;
        let released = false;
        let disposal: Promise<boolean> | undefined;
        const ended = Promise.withResolvers<void>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const interruption =
          timeoutMs === undefined ? null : Promise.withResolvers<never>();
        const release = (destroy = false) => {
          if (released || !client) {
            return;
          }
          released = true;
          if (destroy) {
            disposal = waitForClientRemoval(connection.pool, client);
          }
          client.release(destroy);
        };
        const interrupt = (error: Error) => {
          if (released) {
            return;
          }
          interrupted ??= error;
          interruption?.reject(interrupted);
          // Remove the client through pg's public API so a late callback
          // cannot resume its transaction after the deadline.
          release(true);
        };
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            const error = new Error(
              `PostgreSQL transaction exceeded its ${timeoutMs}ms budget`
            );
            error.name = "PostgresTransactionTimeoutError";
            interrupt(error);
          }, timeoutMs + TRANSACTION_CLEANUP_GRACE_MS);
        }
        const rollbackAfterFailure = async (
          error: unknown,
          acquired: pg.PoolClient
        ): Promise<never> => {
          if (isFatalPostgresError(error)) {
            // A server transaction timeout has already ended the session.
            // Wait for its close before release: sending ROLLBACK or Terminate
            // into a closing socket can produce a second transport failure.
            interrupted = error;
            await ended.promise;
            throw error;
          }
          if (released) {
            throw error;
          }
          try {
            await acquired.query("ROLLBACK");
          } catch (rollbackError) {
            release(true);
            throw rollbackError;
          }
          throw error;
        };
        const operation = async () => {
          const acquired = await connection.pool.connect();
          client = acquired;
          acquired.once("end", ended.resolve);
          if (interrupted) {
            release(true);
            throw interrupted;
          }
          if (timeoutMs !== undefined) {
            acquired.on("error", interrupt);
          }
          try {
            // The validated integer is sent with BEGIN in one protocol message:
            // origin protection does not depend on a later client round trip.
            await acquired.query(
              timeoutMs === undefined
                ? "BEGIN"
                : `BEGIN; SET LOCAL transaction_timeout = '${Math.max(1, timeoutMs - (Date.now() - startedAt))}ms'`
            );
            const result = await transactionActive.run(true, () =>
              callback(acquired)
            );
            await acquired.query("COMMIT");
            return result;
          } catch (error) {
            return await rollbackAfterFailure(error, acquired);
          }
        };
        const outcome = await (interruption
          ? Promise.race([operation(), interruption.promise])
          : operation()
        ).then(
          (value) => ({ value }),
          (error: unknown) => ({ error })
        );
        clearTimeout(timer);
        release(timeoutMs !== undefined);
        const disposed = await disposal;
        if (disposed === false) {
          throw new Error(
            "PostgreSQL connection disposal exceeded its budget",
            {
              cause: "error" in outcome ? outcome.error : undefined,
            }
          );
        }
        client?.removeListener("error", interrupt);
        if ("error" in outcome) {
          throw outcome.error;
        }
        return outcome.value;
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
