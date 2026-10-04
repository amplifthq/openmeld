import { describe, expect, it } from "vitest";
import { recordCenterAgentLocalAgentRequest } from "../src/center-agent/application/center-agent-interaction-audit-service";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("recordCenterAgentLocalAgentRequest", () => {
  it("persists stable requester and client attribution without the private local session", async () => {
    const harness = await createPostgresHarness();
    const actorProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const humanProfileId = "22222222-2222-4222-8222-222222222222";
    try {
      await harness.query(`INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
        VALUES ('org-1', 'Organization', 'organization', 1)`);
      await harness.query(`INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at)
        VALUES ('user-1', 'Mira', 'mira@example.test', 1, 1)`);
      await harness.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles"
          (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source)
          VALUES ($1, 'Agent', 'agent', 'agent', 'org-1', 'user-1', 'cli_create'),
            ($2, 'Mira', 'mira', 'human', NULL, 'user-1', 'cli_create')`,
        values: [actorProfileId, humanProfileId],
      });
      await recordCenterAgentLocalAgentRequest({
        actorProfileId,
        db: harness.db,
        deliveryId: "delivery-1",
        nowMs: 123,
        organizationId: "org-1",
        representedMember: {
          displayName: "Mira",
          profileId: humanProfileId,
          userId: "user-1",
        },
        source: {
          client: "codex",
          kind: "local_agent",
          sessionId: "private-thread-id",
        },
      });

      const rows = await harness.queryAll({
        text: 'SELECT * FROM "openmeld"."center_agent_audit_journal"',
      });
      expect(rows).toEqual([
        {
          id: "local-agent-request:delivery-1",
          organization_id: "org-1",
          actor_profile_id: actorProfileId,
          action: "receive_local_agent_request",
          on_behalf_of_profile_id: humanProfileId,
          on_behalf_of_user_id: "user-1",
          on_behalf_of_display_name: "Mira",
          resource_type: "local_agent_client",
          resource_id: "codex",
          source_native_delivery_id: "delivery-1",
          source_space_id: null,
          created_at: 123,
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain("private-thread-id");
    } finally {
      await harness.close();
    }
  });
});
