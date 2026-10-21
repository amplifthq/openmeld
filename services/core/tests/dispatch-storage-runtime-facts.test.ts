import { describe, expect, it } from "vitest";
import { inspectCoreDispatchStorageReadiness } from "../src/db/runtime-facts";
import { env } from "../test-support/worker-env";
import { postgresFixtureOperator } from "./postgresql.test-support";

describe("core dispatch storage runtime facts", () => {
  it("reports ready when all dispatch domains are reachable through PostgreSQL", async () => {
    await expect(
      inspectCoreDispatchStorageReadiness(env)
    ).resolves.toMatchObject({
      ready: true,
      detail: null,
    });
  });

  it("identifies the unavailable domain without trying to repair runtime schema", async () => {
    const operator = postgresFixtureOperator(env);
    await operator.query(
      'ALTER TABLE "openmeld"."openMeldDaemon_dispatch_ledger" RENAME TO "test_dispatch_ledger_offline"'
    );
    try {
      const readiness = await inspectCoreDispatchStorageReadiness(env);
      expect(readiness.ready).toBe(false);
      expect(readiness.detail).toContain("wake-evidence");
      expect(readiness.detail).toContain("openMeldDaemon_dispatch_ledger");
    } finally {
      await operator.query(
        'ALTER TABLE "openmeld"."test_dispatch_ledger_offline" RENAME TO "openMeldDaemon_dispatch_ledger"'
      );
    }
  });

  it("reports not ready when the PostgreSQL binding is missing", async () => {
    await expect(
      inspectCoreDispatchStorageReadiness({})
    ).resolves.toMatchObject({
      ready: false,
      detail: expect.stringContaining("bindings are missing"),
    });
  });
});
