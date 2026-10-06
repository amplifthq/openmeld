import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  resolveAccountSpaceActiveWakeGatewayHost,
  rpcListAccountSpaceActiveWakeSummary,
} from "../src/rpc/methods";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

describe("account Space active Wake summary RPC", () => {
  it("keeps an older Gateway request scoped by Core configuration", async () => {
    const harness = await createPostgresHarness();

    try {
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
        OPENMELD_GATEWAY_URL: "https://GATEWAY.OPENMELD.TEST/path",
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
      await harness.close();
    }
  });

  it("attributes a live Wake from the removed target membership snapshot", async () => {
    const harness = await createPostgresHarness();

    const nowMs = Date.now();
    const deletedProfileId = "agt_418831cf-a76d-4073-b606-de76b2f315ce";
    try {
      await harness.query({
        values: [nowMs, nowMs, "space-projection"],
        text: `
          INSERT INTO "openmeld"."space_index_spaces" (
            space_id,
            organization_id,
            organization_visibility,
            status,
            space_name,
            source_updated_at_ms,
            projected_at_ms,
            projection_event_id
          )
          VALUES ('space-1', 'org-1', 'private', 'active', 'SEO Tracker', $1, $2, $3)
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
        await harness.query({
          values: [
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
          text: `
            INSERT INTO "openmeld"."space_index_memberships" (
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
            VALUES ('space-1', $1, $2, $3, $4, $5, 'member', $6, $7, $8, $9, $10)
          `,
        });
      }
      await harness.query({
        values: [deletedProfileId, nowMs - 1000, nowMs],
        text: `
          INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions" (
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
            $1,
            'client-live',
            'runtime_registry_authority',
            'runtime-1',
            'binding-1',
            'builtin:codex',
            'running',
            $2,
            $3
          )
        `,
      });

      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
        OPENMELD_GATEWAY_URL: "https://gateway.openmeld.test",
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
      const renamedEnv = {
        ...env,
        OPENMELD_AUTH_WORKER: {
          resolveProfileById: async () => ({
            ok: true,
            profile: {
              profileId: deletedProfileId,
              profileKind: "agent",
              profileName: "Renamed Agent",
              profileHandle: "renamed-agent",
              ownerUserId: "owner-clico",
              status: "active",
            },
          }),
        },
      } as unknown as CoreBindings;
      const renamed = await rpcListAccountSpaceActiveWakeSummary(renamedEnv, {
        ownerUserId: "owner-viewer",
        selectedProfileId: "viewer-profile",
      });
      expect(renamed.items[0]?.activeTargets?.[0]?.profileName).toBe(
        "Renamed Agent"
      );
      const startedAt = Date.now();
      const stalled = await rpcListAccountSpaceActiveWakeSummary(
        {
          ...env,
          OPENMELD_AUTH_WORKER: {
            resolveProfileById: () =>
              new Promise(() => {
                /* Simulate an Auth RPC that never settles. */
              }),
          },
        } as unknown as CoreBindings,
        {
          ownerUserId: "owner-viewer",
          selectedProfileId: "viewer-profile",
        }
      );
      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(stalled.items[0]?.activeTargets?.[0]?.profileName).toBe(
        "Clico Codex"
      );
    } finally {
      await harness.close();
    }
  });
});
