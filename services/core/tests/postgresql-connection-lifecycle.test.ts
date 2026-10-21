import {
  getPostgresDatabase,
  getPostgresRequestPool,
  PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { env } from "../test-support/worker-env";

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
