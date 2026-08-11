import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const APPLICATION_TABLES_QUERY = `
  SELECT name FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '_cf_%'
    AND name <> 'd1_migrations'
  ORDER BY name
`;

async function tableNames(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(APPLICATION_TABLES_QUERY)
    .all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

// Proves the safety net itself is sound BEFORE it is used to validate routing:
// each per-domain D1 holds exactly its own baseline tables, cross-domain tables
// are absent (so a misroute would fail), and OPENMELD_DB is a schema-less trap.
describe("split-gate harness", () => {
  it("seeds OPENMELD_LOCAL_STATE_DB with local-state tables only", async () => {
    const names = await tableNames(env.OPENMELD_LOCAL_STATE_DB as D1Database);
    expect(names).toContain("openMeldDaemon_agent_profile_bindings");
    expect(names).toContain("openMeldDaemon_runtime_registry_records");
    expect(names).toContain("openMeldDaemon_space_diagnostic_reports");
    // wake-evidence + projections tables must be absent here
    expect(names).not.toContain("openMeldDaemon_start_sessions");
    expect(names).not.toContain("openMeldDaemon_dispatch_ledger");
    expect(names).not.toContain("openMeldDaemon_ops_decisions");
    expect(names).not.toContain("space_index_memberships");
    expect(names).toHaveLength(14);
  });

  it("seeds OPENMELD_WAKE_EVIDENCE_DB with wake-evidence tables only", async () => {
    const names = await tableNames(env.OPENMELD_WAKE_EVIDENCE_DB as D1Database);
    expect(names).toContain("openMeldDaemon_dispatch_ledger");
    expect(names).toContain("openMeldDaemon_dispatch_attempts");
    expect(names).toContain("openMeldDaemon_dispatch_results");
    expect(names).toContain("openMeldDaemon_dispatch_result_inbox");
    expect(names).toContain("openMeldDaemon_ops_decisions");
    expect(names).toContain("openMeldDaemon_runtime_coordinator_executions");
    // local-state + projections tables must be absent here
    expect(names).not.toContain("openMeldDaemon_start_sessions");
    expect(names).not.toContain("space_index_memberships");
    expect(names).toHaveLength(9);
  });

  it("seeds OPENMELD_PROJECTIONS_DB with projections tables only", async () => {
    const names = await tableNames(env.OPENMELD_PROJECTIONS_DB as D1Database);
    expect(names).toContain("space_index_memberships");
    expect(names).toContain("space_index_spaces");
    expect(names).toContain("space_index_projection_events");
    expect(names).not.toContain("openMeldDaemon_dispatch_ledger");
    expect(names).not.toContain("openMeldDaemon_start_sessions");
    expect(names).toHaveLength(3);
  });

  it("leaves OPENMELD_DB as an empty trap (zero application tables)", async () => {
    const names = await tableNames(env.OPENMELD_DB);
    expect(names).toHaveLength(0);
  });
});
