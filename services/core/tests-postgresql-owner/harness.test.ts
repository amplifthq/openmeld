import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { env } from "../test-support/worker-env";

describe("native PostgreSQL owner gate", () => {
  it("uses the runtime role against the complete immutable product journal", async () => {
    const db = getPostgresDatabase(env);
    expect((await db.query("SELECT current_user AS role")).rows).toEqual([
      { role: "openmeld_pg_runtime" },
    ]);
    const tables = (
      await db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'openmeld' ORDER BY tablename`
      )
    ).rows.map((row) => row.tablename);
    expect(tables).toHaveLength(159);
    for (const table of [
      "users",
      "openMeldDaemon_agent_profile_bindings",
      "openMeldDaemon_runtime_registry_records",
      "openMeldDaemon_dispatch_ledger",
      "openMeldDaemon_dispatch_attempts",
      "space_index_memberships",
    ]) {
      expect(tables).toContain(table);
    }
  });
  it("denies runtime DDL and fails closed without its binding", async () => {
    await expect(
      getPostgresDatabase(env).query(
        `CREATE TABLE "openmeld"."runtime_ddl_must_be_denied" (id text)`
      )
    ).rejects.toMatchObject({ code: "42501" });
    expect(() => getPostgresDatabase({})).toThrow(
      "OPENMELD_POSTGRESQL Hyperdrive binding is required"
    );
  });
});
