import { runInDurableObject } from "cloudflare:test";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { reconcileDeletedAgentProfile } from "../src/agent-profile-binding/application/deleted-profile-reconcile-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  addSpaceMembersUseCase,
  listSpaceMembersSnapshotUseCase,
} from "../src/space/application/space-members-service";
import {
  listDueMemberProfileLivenessEvidence,
  recordMemberProfileNotFoundObservation,
} from "../src/space/infrastructure/sql/space-member-liveness-repo";
import {
  isSpaceMemberProjectionDirty,
  readSpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

const NOW_ISO = "2026-06-12T08:00:00.000Z";
function createSpaceShard(): {
  shard: DurableObjectStub<Space>;
  spaceId: string;
} {
  const spaceEnv = env as unknown as {
    OPENMELD_SPACES: DurableObjectNamespace<Space>;
  };
  const id = spaceEnv.OPENMELD_SPACES.newUniqueId();
  return {
    shard: spaceEnv.OPENMELD_SPACES.get(id),
    spaceId: id.toString(),
  };
}
function createAuthRpcStub(state: { deleted: boolean }) {
  return {
    resolveProfileById(input: { openMeldProfileId?: string | null }) {
      if (state.deleted) {
        return Promise.resolve({
          ok: false as const,
          code: "profile.not_found",
          message: "profile not found",
        });
      }
      return Promise.resolve({
        ok: true as const,
        profile: {
          ownerUserId: "owner-1",
          profileHandle: "gone-bot",
          profileId: input.openMeldProfileId ?? "agt_gone",
          profileKind: "agent" as const,
          profileName: "Gone Bot",
          status: "active" as const,
        },
      });
    },
  };
}
async function seedMember(input: {
  profileId: string;
  profileKind?: "agent" | "human";
  shard: DurableObjectStub<Space>;
  spaceId: string;
}): Promise<void> {
  await runInDurableObject(input.shard, (_instance, state) => {
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId: input.spaceId,
      organizationId: "org-1",
      visibility: "private",
      accessMode: "public",
      name: "Deleted Profile Reconcile",
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    addSpaceMembersUseCase({
      sql: state.storage.sql,
      env: {} as CoreBindings,
      spaceId: input.spaceId,
      members: [
        {
          profileId: input.profileId,
          profileName: "Gone Bot",
          profileKind: input.profileKind ?? "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef:
            input.profileKind === "human" ? null : "builtin:codex",
        },
      ],
      actorProfileId: "hum-reconcile-host",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: NOW_ISO,
    });
  });
}
describe("deleted agent profile reconcile", () => {
  it("removes the deleted agent member via the fan-out RPC and posts a system notice", async () => {
    const { shard, spaceId } = createSpaceShard();
    const profileId = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await seedMember({ profileId, shard, spaceId });
    const outcome = await shard.rpcReconcileDeletedAgentProfileMember({
      profileId,
      spaceId,
    });
    expect(outcome).toEqual({ status: "removed" });
    await runInDurableObject(shard, (_instance, state) => {
      const record = readSpaceMemberRecord(state.storage.sql, profileId);
      expect(record?.status).toBe("removed");
      expect(record?.removedByProfileId).toBe("openmeld-system");
      const signalRows = state.storage.sql
        .exec<{
          payload_json: string;
        }>("SELECT payload_json FROM space_signals")
        .toArray();
      expect(
        signalRows.some((row) =>
          String(row.payload_json).includes(
            "was removed from this Space because its Agent Profile was deleted"
          )
        )
      ).toBe(true);
    });
    await expect(
      shard.rpcReconcileDeletedAgentProfileMember({ profileId, spaceId })
    ).resolves.toEqual({ status: "noop" });
  });
  it("removes a deleted human profile member with the human notice copy", async () => {
    const { shard, spaceId } = createSpaceShard();
    const profileId = "hum_reconcile_gone_1";
    await seedMember({ profileId, profileKind: "human", shard, spaceId });
    const outcome = await shard.rpcReconcileDeletedAgentProfileMember({
      profileId,
      spaceId,
    });
    expect(outcome).toEqual({ status: "removed" });
    await runInDurableObject(shard, (_instance, state) => {
      const record = readSpaceMemberRecord(state.storage.sql, profileId);
      expect(record?.status).toBe("removed");
      expect(record?.removalReason).toBe("profile_deleted");
      const signalRows = state.storage.sql
        .exec<{
          payload_json: string;
        }>("SELECT payload_json FROM space_signals")
        .toArray();
      expect(
        signalRows.some((row) =>
          String(row.payload_json).includes(
            "was removed from this Space because its Profile was deleted"
          )
        )
      ).toBe(true);
    });
  });
  it("fans out through the orchestration service used by the auth entrypoint", async () => {
    const { shard, spaceId } = createSpaceShard();
    const profileId = "agt_418831cf-a76d-4073-b606-de76b2f315ce";
    await seedMember({ profileId, shard, spaceId });
    const coreEnv = env as unknown as CoreBindings;
    const db = getPostgresDatabase(coreEnv);
    if (!db) {
      throw new Error("test env is missing OPENMELD_DB");
    }
    await db.query({
      ...{
        text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner-1', 'Owner One', 'owner-one@example.com', 1, $1, $2)",
        values: [],
      },
      values: [Date.now(), Date.now()],
    });
    await db.query({
      ...{
        text: "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org-1', 'Deleted Profile Org', 'deleted-profile-org', $1)",
        values: [],
      },
      values: [Date.now()],
    });
    await db.query({
      ...{
        text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind,
          is_default, status, organization_id, owner_user_id, source,
          created_at, updated_at
        )
        VALUES ($1, 'Gone Bot', 'gone-bot', 'agent', 0, 'active',
          'org-1', 'owner-1', 'migration', $2, $3)
      `,
        values: [],
      },
      values: [profileId, Date.now(), Date.now()],
    });
    await db.query({
      ...{
        text: `
        INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
          binding_id, owner_kind, owner_id, agent_profile_id,
          openmeld_service_runtime_id, agent_controller_ref,
          binding_state, created_at_ms, updated_at_ms
        )
        VALUES ($1, 'owner_account', $2, $3, $4, 'builtin:codex',
          'enabled_primary', $5, $6)
      `,
        values: [],
      },
      values: [
        `binding-${profileId}`,
        "owner-1",
        profileId,
        "runtime-1",
        Date.now(),
        Date.now(),
      ],
    });
    await db.query({
      ...{
        text: `
        INSERT INTO "openmeld"."space_index_memberships" (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          status, member_source, added_at_ms, source_updated_at_ms,
          projected_at_ms, projection_event_id
        )
        VALUES ($1, $2, 'agent', 'Gone Bot', 'active', 'added_by_member', $3, $4, $5, $6)
        ON CONFLICT(space_id, profile_id) DO NOTHING
      `,
        values: [],
      },
      values: [
        spaceId,
        profileId,
        Date.now(),
        Date.now(),
        Date.now(),
        `evt-reconcile-${profileId}`,
      ],
    });
    // The Auth lifecycle fanout runs after the Profile row is gone. The old
    // user-command cleanup revalidated this missing row and therefore left the
    // Binding enabled forever.
    await db.query({
      ...{
        text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1',
        values: [],
      },
      values: [profileId],
    });
    // spaceIds is intentionally empty: core must resolve the affected
    // Spaces from the space-index membership projection itself.
    const response = await reconcileDeletedAgentProfile(coreEnv, {
      ownerUserId: "owner-1",
      profileId,
      spaceIds: [],
    });
    expect(response.profileId).toBe(profileId);
    expect(response.complete).toBe(true);
    expect(response.spaces).toEqual([{ spaceId, status: "removed" }]);
    expect(response.bindingDisabled).toBe(true);
    await expect(
      db
        .query({
          ...{
            text: `
          SELECT binding_state, reason_code
          FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
          WHERE binding_id = $1
        `,
            values: [],
          },
          values: [`binding-${profileId}`],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toMatchObject({
      binding_state: "disabled_historical",
      reason_code: "agent_profile_binding.profile_deleted",
    });
  });
  it("keeps deletion reconciliation retryable when Space discovery is unavailable", async () => {
    const response = await reconcileDeletedAgentProfile({} as CoreBindings, {
      ownerUserId: "owner-1",
      profileId: "33333333-3333-4333-8333-333333333333",
      profileKind: "human",
      spaceIds: [],
    });
    expect(response.complete).toBe(false);
    expect(response.spaces).toEqual([]);
  });
  it("keeps the member and records retry evidence when Wake cancellation is not confirmed", async () => {
    const { shard, spaceId } = createSpaceShard();
    const profileId = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await seedMember({ profileId, shard, spaceId });
    await expect(
      shard.rpcReconcileDeletedAgentProfileMember({
        ownerUserId: "different-owner",
        profileId,
        spaceId,
        wakeCancellationConfirmed: false,
      })
    ).resolves.toEqual({ status: "deferred" });
    await runInDurableObject(shard, (_instance, state) => {
      expect(readSpaceMemberRecord(state.storage.sql, profileId)?.status).toBe(
        "active"
      );
      expect(
        listDueMemberProfileLivenessEvidence(state.storage.sql, {
          minAgeMs: 30 * 60_000,
          minObservations: 2,
          nowMs: Date.now(),
        })
      ).toMatchObject([
        {
          observationCount: 2,
          profileId,
        },
      ]);
    });
  });
  it("records liveness evidence on snapshot reads and removes only after the alarm re-verifies", async () => {
    const { shard, spaceId } = createSpaceShard();
    const profileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await seedMember({ profileId, shard, spaceId });
    const authState = { deleted: true };
    await runInDurableObject(shard, async (instance, state) => {
      const snapshotEnv = {
        ...env,
        OPENMELD_AUTH_WORKER: createAuthRpcStub(authState),
      } as unknown as CoreBindings;
      const snapshot = await listSpaceMembersSnapshotUseCase({
        sql: state.storage.sql,
        env: snapshotEnv,
        spaceId,
        viewerOwnerUserId: "owner-1",
        viewerProfileId: "hum-reconcile-host",
        liveSessions: [],
        nowIso: NOW_ISO,
      });
      expect(snapshot.agents[0]?.agentWakeAvailability?.reasonCode).toBe(
        "agent_profile.not_found"
      );
      // One observation is not enough evidence for the alarm to act on.
      expect(
        listDueMemberProfileLivenessEvidence(state.storage.sql, {
          minAgeMs: 30 * 60_000,
          minObservations: 2,
          nowMs: Date.parse(NOW_ISO) + 31 * 60_000,
        })
      ).toEqual([]);
      // Backdate the first observation and add the second one so the
      // threshold is met without waiting 30 minutes.
      state.storage.sql.exec(
        "UPDATE space_member_profile_liveness SET first_not_found_at_ms = ?",
        Date.parse(NOW_ISO) - 31 * 60_000
      );
      recordMemberProfileNotFoundObservation(state.storage.sql, {
        nowMs: Date.parse(NOW_ISO),
        profileId,
      });
      const internal = instance as unknown as {
        bindings: CoreBindings;
        reconcileDeletedAgentProfileMemberLiveness: () => Promise<void>;
      };
      const originalBindings = internal.bindings;
      try {
        // Transient auth failure keeps the evidence and the member.
        internal.bindings = {
          ...originalBindings,
          OPENMELD_AUTH_WORKER: {
            resolveProfileById() {
              return Promise.reject(new Error("auth briefly down"));
            },
          },
        } as unknown as CoreBindings;
        await internal.reconcileDeletedAgentProfileMemberLiveness();
        expect(
          readSpaceMemberRecord(state.storage.sql, profileId)?.status
        ).toBe("active");
        // Fresh authoritative not_found removes the member and clears the
        // evidence.
        internal.bindings = {
          ...originalBindings,
          OPENMELD_AUTH_WORKER: createAuthRpcStub(authState),
        } as unknown as CoreBindings;
        await internal.reconcileDeletedAgentProfileMemberLiveness();
      } finally {
        internal.bindings = originalBindings;
      }
      expect(readSpaceMemberRecord(state.storage.sql, profileId)?.status).toBe(
        "removed"
      );
      expect(
        state.storage.sql
          .exec("SELECT profile_id FROM space_member_profile_liveness")
          .toArray()
      ).toEqual([]);
    });
  });
  it("projects the index from the dirty mark when a member write skipped the explicit projection", async () => {
    const { shard, spaceId } = createSpaceShard();
    const profileId = "agt_dirty_projection_1";
    await seedMember({ profileId, shard, spaceId });
    const coreEnv = env as unknown as CoreBindings;
    const db = getPostgresDatabase(coreEnv);
    if (!db) {
      throw new Error("test env is missing OPENMELD_DB");
    }
    await runInDurableObject(shard, async (instance, state) => {
      upsertSpaceMetaRecord(state.storage.sql, {
        v: 1,
        spaceId,
        organizationId: "org-1",
        visibility: "private",
        accessMode: "public",
        name: "Dirty Projection Smoke",
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      });
      const record = readSpaceMemberRecord(state.storage.sql, profileId);
      if (!record) {
        throw new Error("seeded member is missing");
      }
      // Mutate through the repo directly to simulate a call site that
      // forgets the explicit projection call.
      upsertSpaceMemberRecord(state.storage.sql, {
        ...record,
        status: "removed",
        removedAt: NOW_ISO,
        removalReason: "test_direct_write",
        updatedAt: NOW_ISO,
      });
      expect(isSpaceMemberProjectionDirty(state.storage.sql)).toBe(true);
      const internal = instance as unknown as {
        flushDirtyMemberProjection: () => Promise<void>;
      };
      await internal.flushDirtyMemberProjection();
      expect(isSpaceMemberProjectionDirty(state.storage.sql)).toBe(false);
    });
    const projected = await db
      .query<{
        status: string;
      }>({
        ...{
          text: 'SELECT status FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
          values: [],
        },
        values: [spaceId, profileId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(projected?.status).toBe("removed");
  });
  it("clears liveness evidence when the profile is alive again", async () => {
    const { shard, spaceId } = createSpaceShard();
    const profileId = "agt_reconcile_alive_1";
    await seedMember({ profileId, shard, spaceId });
    const authState = { deleted: true };
    await runInDurableObject(shard, async (_instance, state) => {
      const snapshotEnv = {
        ...env,
        OPENMELD_AUTH_WORKER: createAuthRpcStub(authState),
      } as unknown as CoreBindings;
      await listSpaceMembersSnapshotUseCase({
        sql: state.storage.sql,
        env: snapshotEnv,
        spaceId,
        viewerOwnerUserId: "owner-1",
        viewerProfileId: "hum-reconcile-host",
        liveSessions: [],
        nowIso: NOW_ISO,
      });
      expect(
        state.storage.sql
          .exec("SELECT profile_id FROM space_member_profile_liveness")
          .toArray()
      ).toHaveLength(1);
      authState.deleted = false;
      await listSpaceMembersSnapshotUseCase({
        sql: state.storage.sql,
        env: snapshotEnv,
        spaceId,
        viewerOwnerUserId: "owner-1",
        viewerProfileId: "hum-reconcile-host",
        liveSessions: [],
        nowIso: NOW_ISO,
      });
      expect(
        state.storage.sql
          .exec("SELECT profile_id FROM space_member_profile_liveness")
          .toArray()
      ).toEqual([]);
    });
  });
});
