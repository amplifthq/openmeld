import { describe, expect, it } from "vitest";
import { readRemoteAgentTaskActivity } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { readRuntimeCoordinatorTaskActivity } from "../src/runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("directory task activity", () => {
  it("reads only authorized profiles and real lifecycle timestamps within retention", async () => {
    const harness = createSqliteD1Harness();
    try {
      applyDrizzleMigrationsForTables(harness, [
        "openMeldDaemon_runtime_coordinator_executions",
        "openMeldRemoteAgent_native_delivery_ledger",
      ]);
      const local = (
        id: string,
        profile: string,
        status: string,
        created: number,
        updated: number
      ) =>
        harness.run({
          sql: `INSERT INTO openMeldDaemon_runtime_coordinator_executions
          (runtime_coordinator_execution_id, model_version, space_id, dispatch_id, target_profile_id, openmeld_service_runtime_id_source, openmeld_service_runtime_id, binding_id, agent_controller_ref, status, created_at_ms, updated_at_ms)
          VALUES (?, '1', 'space', ?, ?, 'runtime', 'runtime', 'binding', 'codex', ?, ?, ?)`,
          params: [id, id, profile, status, created, updated],
        });
      local("run", "allowed", "running", 100, 300);
      local("retry", "allowed", "delivery_pending", 150, 900);
      local("private", "other", "running", 100, 950);
      local("old", "expired", "reply_published", 10, 50);
      expect([
        ...(await readRuntimeCoordinatorTaskActivity({
          db: harness.db,
          authorizedProfileIds: ["allowed", "expired"],
          sinceMs: 100,
        })),
      ]).toEqual([["allowed", 300]]);
      const remote = (
        id: string,
        org: string,
        profile: string,
        evidence: number
      ) =>
        harness.run({
          sql: `INSERT INTO openMeldRemoteAgent_native_delivery_ledger
          (delivery_id, organization_id, space_id, profile_id, binding_id, trigger_message_id, dispatch_id, idempotency_key, status, created_at_ms, updated_at_ms, execution_evidence_at_ms)
          VALUES (?, ?, 'space', ?, 'binding', ?, ?, ?, 'accepted', 100, 999, ?)`,
          params: [id, org, profile, id, id, id, evidence],
        });
      remote("remote", "org", "allowed", 400);
      remote("foreign", "foreign-org", "allowed", 900);
      remote("hidden", "org", "hidden", 950);
      expect([
        ...(await readRemoteAgentTaskActivity({
          db: harness.db,
          organizationId: "org",
          authorizedProfileIds: ["allowed"],
          sinceMs: 100,
        })),
      ]).toEqual([["allowed", 400]]);
      expect(
        await readRemoteAgentTaskActivity({
          db: harness.db,
          organizationId: "org",
          authorizedProfileIds: [],
          sinceMs: 100,
        })
      ).toEqual(new Map());
    } finally {
      harness.close();
    }
  });
});
