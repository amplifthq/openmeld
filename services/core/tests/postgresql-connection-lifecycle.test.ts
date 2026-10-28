import {
  getPostgresDatabase,
  getPostgresRequestPool,
  type PoolClient,
  PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { env } from "../test-support/worker-env";

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
