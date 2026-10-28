import {
  getPostgresDatabase,
  getPostgresRequestPool,
  type PoolClient,
  PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import { describe, expect, it, vi } from "vitest";
import { env } from "../test-support/worker-env";
import { postgresFixtureOperator } from "./postgresql.test-support";

const TRANSACTION_TIMEOUT_MESSAGE = /transaction.*(?:timeout|budget)/iu;

describe("PostgreSQL runtime connection lifecycle", () => {
  it("closes the native request pool after a successful query", async () => {
    const pool = await withPostgresRequest(
      env.OPENMELD_POSTGRESQL,
      async () => {
        const current = getPostgresRequestPool();
        expect(
          (await getPostgresDatabase(env).query("SELECT 42 AS answer")).rows
        ).toEqual([{ answer: 42 }]);
        expect(current.totalCount).toBe(1);
        return current;
      }
    );
    expect(pool.totalCount).toBe(0);
  });

  it("propagates native query and connection failures", async () => {
    await expect(
      getPostgresDatabase(env).query("SELECT 1 / 0")
    ).rejects.toMatchObject({
      code: "22012",
    });
    const unavailable = new PostgresDatabase({
      connectionString: "postgresql://127.0.0.1:1/unavailable",
    });
    await expect(unavailable.query("SELECT 1")).rejects.toBeInstanceOf(Error);
  });

  it("preserves the original SQLSTATE when the connection closes before rollback", async () => {
    const failed = Promise.withResolvers<{ pid: number; error: unknown }>();
    const connectionErrors: unknown[] = [];
    const outcome = getPostgresDatabase(env)
      .transaction(async (client) => {
        const ended = new Promise<void>((resolve) =>
          client.once("end", resolve)
        );
        client.on("error", (error) => connectionErrors.push(error));
        const pid = Number(
          (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid
        );
        const error = await client
          .query(
            "DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = '53300', MESSAGE = 'fixture overload'; END $$"
          )
          .then(
            () => {
              throw new Error("Expected the native overload error");
            },
            (cause: unknown) => cause
          );
        failed.resolve({ pid, error });
        await ended;
        throw error;
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    const original = await failed.promise;
    await postgresFixtureOperator(env).query(
      "SELECT pg_terminate_backend($1)",
      [original.pid]
    );
    expect(await outcome).toBe(original.error);
    expect(await outcome).toMatchObject({ code: "53300" });
    expect(connectionErrors.length).toBeGreaterThan(0);
  });

  it("returns an acknowledged commit when connection disposal times out", async () => {
    const operator = postgresFixtureOperator(env);
    const table = `committed_cleanup_${crypto.randomUUID().replaceAll("-", "")}`;
    await operator.query(`CREATE TABLE public.${table} (value integer NOT NULL);
      GRANT SELECT, INSERT ON public.${table} TO openmeld_pg_runtime;`);
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    let restoreEvents: (() => void) | undefined;
    try {
      const result = await withPostgresRequest(
        env.OPENMELD_POSTGRESQL,
        () => {
          const pool = getPostgresRequestPool();
          const emit = pool.emit;
          // Delay only the driver's documented removal notification. SQL and
          // COMMIT still use the real client and PostgreSQL server.
          const events = vi
            .spyOn(pool, "emit")
            .mockImplementation((event, ...args) =>
              event === "remove"
                ? false
                : Reflect.apply(emit, pool, [event, ...args])
            );
          restoreEvents = () => events.mockRestore();
          return getPostgresDatabase(env).transaction((client) =>
            client.query(
              `INSERT INTO public.${table} VALUES (42) RETURNING value`
            )
          );
        },
        { transactionTimeoutMs: 1000 }
      );
      expect(result.rows).toEqual([{ value: 42 }]);
      expect(
        (await operator.query(`SELECT value FROM public.${table}`)).rows
      ).toEqual([{ value: 42 }]);
      expect(warning).toHaveBeenCalledWith(
        "[postgresql.connection_disposal_timeout]",
        { committed: true }
      );
    } finally {
      restoreEvents?.();
      warning.mockRestore();
      await operator.query(`DROP TABLE public.${table}`);
    }
  });

  it.each([
    "query",
    "callback",
  ] as const)("ends an expired transaction and releases its locks during a stalled %s", async (stall) => {
    const db = getPostgresDatabase(env);
    const blockingKey = Number.parseInt(crypto.randomUUID().slice(0, 8), 16);
    const heldKey = blockingKey + 0x1_00_00_00_00;
    const blockerReady = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        blockingKey,
      ]);
      blockerReady.resolve();
      await release.promise;
    });
    await blockerReady.promise;
    let expiredClient: PoolClient | undefined;
    let expiredPool: ReturnType<typeof getPostgresRequestPool> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const pending = withPostgresRequest(
      env.OPENMELD_POSTGRESQL,
      () => {
        expiredPool = getPostgresRequestPool();
        return db.transaction(async (client) => {
          expiredClient = client;
          await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
            heldKey,
          ]);
          if (stall === "query") {
            await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
              blockingKey,
            ]);
          } else {
            await release.promise;
          }
          return client.query("SELECT 42 AS answer");
        });
      },
      { transactionTimeoutMs: 150 }
    );
    try {
      const result = await Promise.race([
        pending.then(
          () => "unexpected completion",
          (error: unknown) => error
        ),
        new Promise<string>((resolve) => {
          // A failure watchdog also lets the baseline fixture clean up.
          watchdog = setTimeout(
            () => resolve("deadline was not enforced"),
            1500
          );
        }),
      ]);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(TRANSACTION_TIMEOUT_MESSAGE);
      expect(expiredPool?.totalCount).toBe(0);
      expect(
        (
          await db.query(
            "SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired",
            [heldKey]
          )
        ).rows
      ).toEqual([{ acquired: true }]);
      await expect(expiredClient?.query("SELECT 1")).rejects.toBeInstanceOf(
        Error
      );
      expect(
        (await db.transaction((client) => client.query("SELECT 42 AS answer")))
          .rows
      ).toEqual([{ answer: 42 }]);
    } finally {
      clearTimeout(watchdog);
      release.resolve();
      await Promise.allSettled([pending, blocker]);
    }
  });

  it.each([
    "postgresql://127.0.0.1:5432/local?sslmode=require",
    "postgresql://remote.example:5432/database?sslmode=verify-full",
    "postgresql://remote.example:5432/database?sslmode=disable",
    "postgresql://127.0.0.1:5432/local?sslcert=client.pem",
  ])("rejects unsupported direct or TLS connection modes before connecting: %s", async (connectionString) => {
    await expect(
      new PostgresDatabase({ connectionString }).query("SELECT 1")
    ).rejects.toThrow(
      "PostgreSQL runtime connections support only loopback PostgreSQL or a Hyperdrive endpoint without client TLS"
    );
  });
});
