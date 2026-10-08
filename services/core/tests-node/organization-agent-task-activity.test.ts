import { describe, expect, it } from "vitest";
import { readRemoteAgentTaskActivity } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readRuntimeCoordinatorTaskActivity } from "../src/runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("directory task activity", () => {
  it("reads only authorized profiles and real lifecycle timestamps within retention", async () => {
    const harness = await createPostgresHarness();
    try {
      const local = async (
        id: string,
        profile: string,
        status: string,
        created: number,
        updated: number
      ) =>
        await harness.query({
          text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions"
          (runtime_coordinator_execution_id, model_version, space_id, dispatch_id, target_profile_id, openmeld_service_runtime_id_source, openmeld_service_runtime_id, binding_id, agent_controller_ref, status, created_at_ms, updated_at_ms)
          VALUES ($1, '1', 'space', $2, $3, 'runtime', 'runtime', 'binding', 'codex', $4, $5, $6)`,
          values: [id, id, profile, status, created, updated],
        });
      await local("run", "allowed", "running", 100, 300);
      await local("retry", "allowed", "delivery_pending", 150, 900);
      await local("private", "other", "running", 100, 950);
      await local("old", "expired", "reply_published", 10, 50);
      expect([
        ...(await readRuntimeCoordinatorTaskActivity({
          db: harness.db,
          authorizedProfileIds: ["allowed", "expired"],
          sinceMs: 100,
        })),
      ]).toEqual([["allowed", 300]]);
      const remote = async (
        id: string,
        org: string,
        profile: string,
        evidence: number
      ) =>
        await harness.query({
          text: `INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          (delivery_id, organization_id, space_id, profile_id, binding_id, trigger_message_id, dispatch_id, idempotency_key, status, created_at_ms, updated_at_ms, execution_evidence_at_ms)
          VALUES ($1, $2, 'space', $3, 'binding', $4, $5, $6, 'accepted', 100, 999, $7)`,
          values: [id, org, profile, id, id, id, evidence],
        });
      await remote("remote", "org", "allowed", 400);
      await remote("foreign", "foreign-org", "allowed", 900);
      await remote("hidden", "org", "hidden", 950);
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
      await harness.close();
    }
  });
});
