import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  resolveAccountSpaceActiveWakeGatewayHost,
  rpcListAccountSpaceActiveWakeSummary,
} from "../src/rpc/methods";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("account Space active Wake summary RPC", () => {
  it("keeps an older Gateway request scoped by Core configuration", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationsForTables(harness, [
      "space_index_spaces",
      "space_index_memberships",
    ]);
    try {
      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_GATEWAY_URL: "https://GATEWAY.OPENMELD.TEST/path",
        OPENMELD_LOCAL_STATE_DB: harness.db,
        OPENMELD_WAKE_EVIDENCE_DB: harness.db,
      } as CoreBindings;
      await expect(
        rpcListAccountSpaceActiveWakeSummary(env, {
          ownerUserId: "owner-one",
          selectedProfileId: "profile-one",
        })
      ).resolves.toMatchObject({ items: [] });
      expect(
        resolveAccountSpaceActiveWakeGatewayHost({
          configuredGatewayUrl: env.OPENMELD_GATEWAY_URL,
        })
      ).toBe("gateway.openmeld.test");
    } finally {
      harness.close();
    }
  });

  it("attributes a live Wake from the removed target membership snapshot", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationsForTables(harness, [
      "space_index_spaces",
      "space_index_memberships",
      "openMeldDaemon_runtime_coordinator_executions",
      "openMeldRemoteAgent_native_delivery_ledger",
    ]);
    const nowMs = Date.now();
    const deletedProfileId = "agt_418831cf-a76d-4073-b606-de76b2f315ce";
    try {
      harness.run({
        params: [nowMs, nowMs, "space-projection"],
        sql: `
          INSERT INTO space_index_spaces (
            space_id,
            organization_id,
            organization_visibility,
            status,
            space_name,
            source_updated_at_ms,
            projected_at_ms,
            projection_event_id
          )
          VALUES ('space-1', 'org-1', 'private', 'active', 'SEO Tracker', ?, ?, ?)
        `,
      });
      for (const membership of [
        {
          profileId: "viewer-profile",
          profileKind: "human",
          profileName: "Felix",
          ownerUserId: "owner-viewer",
          removedAtMs: null,
          status: "active",
        },
        {
          profileId: deletedProfileId,
          profileKind: "agent",
          profileName: "Clico Codex",
          ownerUserId: "owner-clico",
          removedAtMs: nowMs,
          status: "removed",
        },
      ]) {
        harness.run({
          params: [
            membership.profileId,
            membership.profileKind,
            membership.profileName,
            membership.ownerUserId,
            membership.status,
            nowMs - 1000,
            membership.removedAtMs,
            nowMs,
            nowMs,
            `membership-${membership.profileId}`,
          ],
          sql: `
            INSERT INTO space_index_memberships (
              space_id,
              profile_id,
              profile_kind_snapshot,
              profile_name_snapshot,
              owner_user_id_snapshot,
              status,
              member_source,
              added_at_ms,
              removed_at_ms,
              source_updated_at_ms,
              projected_at_ms,
              projection_event_id
            )
            VALUES ('space-1', ?, ?, ?, ?, ?, 'member', ?, ?, ?, ?, ?)
          `,
        });
      }
      harness.run({
        params: [deletedProfileId, nowMs - 1000, nowMs],
        sql: `
          INSERT INTO openMeldDaemon_runtime_coordinator_executions (
            runtime_coordinator_execution_id,
            model_version,
            space_id,
            dispatch_id,
            target_profile_id,
            source_client_message_id,
            openmeld_service_runtime_id_source,
            openmeld_service_runtime_id,
            binding_id,
            agent_controller_ref,
            status,
            created_at_ms,
            updated_at_ms
          )
          VALUES (
            'rce-live',
            'runtime_coordinator_execution.v1',
            'space-1',
            'dispatch-live',
            ?,
            'client-live',
            'runtime_registry_authority',
            'runtime-1',
            'binding-1',
            'builtin:codex',
            'running',
            ?,
            ?
          )
        `,
      });

      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_GATEWAY_URL: "https://gateway.openmeld.test",
        OPENMELD_LOCAL_STATE_DB: harness.db,
        OPENMELD_PROJECTIONS_DB: harness.db,
        OPENMELD_WAKE_EVIDENCE_DB: harness.db,
      } as CoreBindings;
      await expect(
        rpcListAccountSpaceActiveWakeSummary(env, {
          ownerUserId: "owner-viewer",
          selectedProfileId: "viewer-profile",
        })
      ).resolves.toMatchObject({
        items: [
          {
            activeTargets: [
              {
                activeWakeCount: 1,
                profileId: deletedProfileId,
                profileName: "Clico Codex",
              },
            ],
            activeWakeCount: 1,
            spaceId: "space-1",
          },
        ],
      });
    } finally {
      harness.close();
    }
  });
});
