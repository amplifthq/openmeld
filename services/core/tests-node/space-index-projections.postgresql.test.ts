import { describe, expect, it, onTestFinished } from "vitest";
import { reconcileDeletedAgentProfile } from "../src/agent-profile-binding/application/deleted-profile-reconcile-service";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcProjectSpaceIndexMembershipOverlay } from "../src/space-index/space-index-overlay-rpc";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SPACE_ID = "0123456789abcdef".repeat(4);
const NOW_MS = Date.parse("2026-05-10T00:00:00.000Z");
type Harness = Awaited<ReturnType<typeof createPostgresHarness>>;
async function fixture() {
  const harness = await createPostgresHarness();
  onTestFinished(() => harness.close());
  return harness;
}
async function seedActiveMembership(harness: Harness) {
  await harness.query({
    text: `INSERT INTO "openmeld"."space_index_memberships" (
    space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
    status, member_source, added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id
  ) VALUES ($1, $2, 'agent', 'Codex', 'active', 'space_membership', $3, $3, $3, 'evt-membership')`,
    values: [SPACE_ID, PROFILE_ID, NOW_MS],
  });
}
function overlayInput() {
  return {
    spaceId: SPACE_ID,
    profileId: PROFILE_ID,
    gatewayHost: "gateway.openmeld.invalid",
    active: true,
    pinnedAtMs: NOW_MS,
    lastJoinedAtMs: NOW_MS,
    lastSeenTs: null,
    updatedAtMs: NOW_MS,
  };
}
function spaceNamespace(
  methods: Record<string, unknown>
): CoreBindings["OPENMELD_SPACES"] {
  return {
    idFromString: (value: string) => ({ toString: () => value }),
    get: () => methods,
  } as unknown as CoreBindings["OPENMELD_SPACES"];
}

describe("Space index native PostgreSQL projection", () => {
  it("persists the membership overlay through the one product database", async () => {
    const harness = await fixture();
    await seedActiveMembership(harness);
    const result = await rpcProjectSpaceIndexMembershipOverlay(
      { OPENMELD_POSTGRESQL: harness.binding } as CoreBindings,
      overlayInput()
    );
    expect(result).toEqual({
      repairAttempted: false,
      status: "applied",
      updated: true,
    });
    expect(
      await harness.queryFirst({
        text: `SELECT overlay_gateway_host, overlay_pinned_at_ms FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2`,
        values: [SPACE_ID, PROFILE_ID],
      })
    ).toEqual({
      overlay_gateway_host: "gateway.openmeld.invalid",
      overlay_pinned_at_ms: NOW_MS,
    });
  });
  it("repairs a missing membership from canonical Space truth before retrying", async () => {
    const harness = await fixture();
    let repairCalls = 0;
    const env = {
      OPENMELD_POSTGRESQL: harness.binding,
      OPENMELD_SPACES: spaceNamespace({
        rpcReprojectSpaceIndexSnapshot: async () => {
          repairCalls += 1;
          await seedActiveMembership(harness);
          return {
            memberCount: 1,
            projected: true,
            projectionEventId: "evt-repaired",
            projectionOutboxId: "outbox-repaired",
            projectionStatus: "completed",
            spaceId: SPACE_ID,
          };
        },
      }),
    } as CoreBindings;
    expect(
      await rpcProjectSpaceIndexMembershipOverlay(env, overlayInput())
    ).toEqual({ repairAttempted: true, status: "applied", updated: true });
    expect(repairCalls).toBe(1);
    expect(
      await harness.queryFirst({
        text: 'SELECT overlay_pinned_at_ms FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
        values: [SPACE_ID, PROFILE_ID],
      })
    ).toEqual({ overlay_pinned_at_ms: NOW_MS });
  });
  it("discovers a deleted Profile's projected Spaces without another database binding", async () => {
    const harness = await fixture();
    await seedActiveMembership(harness);
    const response = await reconcileDeletedAgentProfile(
      {
        OPENMELD_POSTGRESQL: harness.binding,
        OPENMELD_SPACES: spaceNamespace({
          rpcReconcileDeletedAgentProfileMember: async () => ({
            status: "reconciled",
          }),
        }),
      } as CoreBindings,
      { ownerUserId: "owner-1", profileId: PROFILE_ID, spaceIds: [] }
    );
    expect(response.spaces).toContainEqual({
      spaceId: SPACE_ID,
      status: "reconciled",
    });
  });
});
