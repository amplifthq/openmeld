import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { reconcileDeletedAgentProfile } from "../src/agent-profile-binding/application/deleted-profile-reconcile-service";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcProjectSpaceIndexMembershipOverlay } from "../src/space-index/space-index-overlay-rpc";
import { createSplitDomainD1Harness } from "./helpers/sqlite-d1-harness.test-support";

// Physical DB split routing gate (physical-db-split.md Stage B safety net).
//
// The two projections-domain call sites both route through projectionsDb(env).
// Each test binds OPENMELD_PROJECTIONS_DB (loaded with the real openmeld-projections
// baseline) and omits OPENMELD_DB. The overlay write throws `no such table` on a
// misroute; the deleted-profile read is best-effort (swallows errors), so its
// gate asserts the projected space actually surfaces — a misroute would leave
// the swallow path returning no spaces.

const OWNER_USER_ID = "owner-1";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const HEX_SPACE_ID = "0123456789abcdef".repeat(4);
const NOW_MS = Date.parse("2026-05-10T00:00:00.000Z");

function seedActiveMembership(
  database: DatabaseSync,
  input: { profileId: string; spaceId: string }
): void {
  database
    .prepare(
      `
        INSERT INTO space_index_memberships (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          status, member_source, added_at_ms, source_updated_at_ms,
          projected_at_ms, projection_event_id
        )
        VALUES (?, ?, 'agent', 'Codex', 'active', 'space_membership', ?, ?, ?, ?)
      `
    )
    .run(
      input.spaceId,
      input.profileId,
      NOW_MS,
      NOW_MS,
      NOW_MS,
      `evt-${input.profileId}`
    );
}

describe("space index projections route through OPENMELD_PROJECTIONS_DB", () => {
  it("writes the membership overlay against OPENMELD_PROJECTIONS_DB only", async () => {
    const projections = createSplitDomainD1Harness("openmeld-projections");
    try {
      seedActiveMembership(projections.database, {
        profileId: AGENT_PROFILE_ID,
        spaceId: HEX_SPACE_ID,
      });

      const result = await rpcProjectSpaceIndexMembershipOverlay(
        { OPENMELD_PROJECTIONS_DB: projections.db } as unknown as CoreBindings,
        {
          spaceId: HEX_SPACE_ID,
          profileId: AGENT_PROFILE_ID,
          gatewayHost: "gateway.openmeld.invalid",
          active: true,
          pinnedAtMs: null,
          lastJoinedAtMs: null,
          lastSeenTs: null,
          updatedAtMs: NOW_MS,
        }
      );

      // updated:true is only possible if the UPDATE ran against a DB that has
      // space_index_memberships (i.e. openmeld-projections); a misroute would throw.
      expect(result.updated).toBe(true);
    } finally {
      projections.close();
    }
  });

  it("repairs a missing membership row from Space truth before retrying the overlay write", async () => {
    const projections = createSplitDomainD1Harness("openmeld-projections");
    let reprojectCalls = 0;
    try {
      const result = await rpcProjectSpaceIndexMembershipOverlay(
        {
          OPENMELD_PROJECTIONS_DB: projections.db,
          OPENMELD_SPACES: {
            idFromString: () => ({ toString: () => HEX_SPACE_ID }),
            get: () =>
              ({
                rpcReprojectSpaceIndexSnapshot: () => {
                  reprojectCalls += 1;
                  seedActiveMembership(projections.database, {
                    profileId: AGENT_PROFILE_ID,
                    spaceId: HEX_SPACE_ID,
                  });
                  return {
                    memberCount: 1,
                    projected: true,
                    projectionEventId: "evt-repaired",
                    projectionOutboxId: "outbox-repaired",
                    projectionStatus: "completed",
                    spaceId: HEX_SPACE_ID,
                  };
                },
              }) as unknown as DurableObjectStub,
          } as unknown as DurableObjectNamespace,
        } as unknown as CoreBindings,
        {
          spaceId: HEX_SPACE_ID,
          profileId: AGENT_PROFILE_ID,
          gatewayHost: "gateway.openmeld.invalid",
          active: true,
          pinnedAtMs: NOW_MS,
          lastJoinedAtMs: NOW_MS,
          lastSeenTs: null,
          updatedAtMs: NOW_MS,
        }
      );

      expect(result).toEqual({
        repairAttempted: true,
        status: "applied",
        updated: true,
      });
      expect(reprojectCalls).toBe(1);
      expect(
        projections.database
          .prepare(
            `
              SELECT overlay_gateway_host, overlay_pinned_at_ms
              FROM space_index_memberships
              WHERE space_id = ? AND profile_id = ?
            `
          )
          .get(HEX_SPACE_ID, AGENT_PROFILE_ID)
      ).toEqual({
        overlay_gateway_host: "gateway.openmeld.invalid",
        overlay_pinned_at_ms: NOW_MS,
      });
    } finally {
      projections.close();
    }
  });

  it("reads deleted-profile space ids from OPENMELD_PROJECTIONS_DB only", async () => {
    const projections = createSplitDomainD1Harness("openmeld-projections");
    const localState = createSplitDomainD1Harness("openmeld-local-state");
    try {
      seedActiveMembership(projections.database, {
        profileId: AGENT_PROFILE_ID,
        spaceId: HEX_SPACE_ID,
      });

      const response = await reconcileDeletedAgentProfile(
        {
          OPENMELD_PROJECTIONS_DB: projections.db,
          OPENMELD_LOCAL_STATE_DB: localState.db,
          OPENMELD_SPACES: createSpaceNamespaceMock(),
        } as unknown as CoreBindings,
        {
          ownerUserId: OWNER_USER_ID,
          profileId: AGENT_PROFILE_ID,
          spaceIds: [],
        }
      );

      // The projected space id only reaches the outcome if the space-index read
      // routed to openmeld-projections; a misroute is swallowed and yields no spaces.
      expect(response.spaces).toContainEqual({
        spaceId: HEX_SPACE_ID,
        status: "reconciled",
      });
    } finally {
      projections.close();
      localState.close();
    }
  });
});

function createSpaceNamespaceMock(): DurableObjectNamespace {
  return {
    idFromString: (value: string) => ({ toString: () => value }),
    get: () =>
      ({
        rpcReconcileDeletedAgentProfileMember: () =>
          Promise.resolve({ status: "reconciled" as const }),
      }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}
