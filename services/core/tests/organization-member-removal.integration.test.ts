import { runInDurableObject } from "cloudflare:test";
import { getPostgresDatabase, PostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { GatewayRpcEntrypoint } from "../src/index";
import type { CoreBindings } from "../src/lib/bindings";
import {
  prepareOrganizationMemberRemoval,
  previewOrganizationMemberRemoval,
} from "../src/organizations/member-removal";
import {
  removeSpaceMembersUseCase,
  upsertJoinedSpaceMember,
  upsertSpaceCreatorMember,
} from "../src/space/application/space-members-service";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { listSpaceMemberRecords } from "../src/space/infrastructure/sql/space-member-repo";
import {
  readSpaceMetaRecordFromSql,
  upsertSpaceMetaRecord,
} from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

const core = env as unknown as CoreBindings;

describe("Organization member removal Space preparation", () => {
  it("lets an Organization manager outside a solo Space close it without deleting its history", async () => {
    const f = await fixture();
    await expect(f.deleteDepartingMembership()).rejects.toThrow();
    const plan = await f.preview();
    expect(plan).toMatchObject({
      memberId: f.departing.memberId,
      userId: f.departing.userId,
      spaces: [{ spaceId: f.spaceId, name: "Welcome Space", action: "close" }],
    });
    expect((await f.state()).meta?.deletedAt).toBeUndefined();
    await expect(f.prepare(plan.spaces)).resolves.toEqual({ prepared: true });
    const retained = await f.state();
    expect(retained.meta?.deletedAt).toEqual(expect.any(String));
    expect(retained.history?.data.text).toBe(f.message);
    expect(
      retained.members.some(
        (member) => member.ownerUserIdSnapshot === f.manager.userId
      )
    ).toBe(false);
    expect(await f.departingMembershipExists()).toBe(true);
    await f.deleteDepartingMembership();
    expect(await f.departingMembershipExists()).toBe(false);
    expect((await f.state()).history?.data.text).toBe(f.message);
  });

  it.each([
    "active",
    "removed",
  ] as const)("transfers a Space with a %s collaborator to the selected successor, without admitting the manager", async (status) => {
    const f = await fixture();
    await f.addCollaborator(status);
    const plan = await f.preview();
    expect(plan.spaces).toEqual([
      { spaceId: f.spaceId, name: "Welcome Space", action: "transfer" },
    ]);
    await expect(f.prepare(plan.spaces)).rejects.toThrow(
      "organization.member_removal_successor_required"
    );
    expect((await f.state()).meta?.ownerUserIds).toEqual([f.departing.userId]);
    await f.prepare(plan.spaces, f.successor.userId);
    const retained = await f.state();
    expect(retained.meta?.deletedAt).toBeUndefined();
    expect(retained.meta?.ownerUserIds).toEqual([f.successor.userId]);
    expect(retained.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: f.successor.profileId,
          status: "active",
        }),
        expect.objectContaining({
          profileId: f.collaborator.profileId,
          status,
        }),
      ])
    );
    expect(
      retained.members.some(
        (member) => member.ownerUserIdSnapshot === f.manager.userId
      )
    ).toBe(false);
    expect(retained.history?.data.text).toBe(f.message);
    await expect(
      (async () =>
        await f.stub.rpcGetMeta({
          spaceId: f.spaceId,
          context: f.context(f.manager),
        }))()
    ).rejects.toThrow("space.membership_required");
    await expect(
      f.db.query({
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [f.successor.memberId],
      })
    ).rejects.toThrow();
    await f.deleteDepartingMembership();
    expect(await f.departingMembershipExists()).toBe(false);
  });

  it("keeps the existing successor when the departing person is one of multiple owners", async () => {
    const f = await fixture();
    await f.addCollaborator("active");
    await runInDurableObject(f.stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE space_meta SET owner_user_ids_json = ? WHERE space_id = ?",
        JSON.stringify([f.departing.userId, f.collaborator.userId]),
        f.spaceId
      );
    });
    await f.db.query({
      text: 'INSERT INTO "openmeld"."space_owner_member_references" (space_id, member_id) VALUES ($1, $2)',
      values: [f.spaceId, f.collaborator.memberId],
    });
    const plan = await f.preview();
    expect(plan.spaces).toEqual([
      { spaceId: f.spaceId, name: "Welcome Space", action: "demote" },
    ]);
    await f.prepare(plan.spaces);
    expect((await f.state()).meta?.ownerUserIds).toEqual([
      f.collaborator.userId,
    ]);
    expect((await f.state()).meta?.deletedAt).toBeUndefined();
    await f.deleteDepartingMembership();
    expect(await f.departingMembershipExists()).toBe(false);
  });

  it("preserves successor discovery when departing-owner reference cleanup fails", async () => {
    const f = await fixture();
    await f.addCollaborator("active");
    const plan = await f.preview();
    const operator = new PostgresDatabase(env.TEST_POSTGRESQL_OWNER);
    const trigger = `test_departure_ref_${crypto.randomUUID().replaceAll("-", "")}`;
    await operator.query(`
      CREATE FUNCTION openmeld.${trigger}()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced departing owner reference cleanup failure';
      END
      $$;
      CREATE TRIGGER ${trigger}
      BEFORE DELETE ON openmeld.space_owner_member_references
      FOR EACH ROW WHEN (OLD.member_id = '${f.departing.memberId}' AND OLD.space_id = '${f.spaceId}')
      EXECUTE FUNCTION openmeld.${trigger}();
    `);
    try {
      await expect(f.prepare(plan.spaces, f.successor.userId)).rejects.toThrow(
        "forced departing owner reference cleanup failure"
      );
      expect(
        (
          await f.db.query({
            text: 'SELECT profile_id, status FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
            values: [f.spaceId, f.successor.profileId],
          })
        ).rows
      ).toEqual([{ profile_id: f.successor.profileId, status: "active" }]);
      expect((await f.state()).meta?.ownerUserIds).toEqual([
        f.successor.userId,
      ]);
      expect(await f.departingMembershipExists()).toBe(true);
    } finally {
      await operator.query(`
        DROP TRIGGER ${trigger} ON openmeld.space_owner_member_references;
        DROP FUNCTION openmeld.${trigger}();
      `);
    }
    expect((await f.preview()).spaces).toEqual([]);
    expect(
      await f.stub.rpcCheckSpaceOwnerDeparture({
        organizationId: f.organizationId,
        spaceId: f.spaceId,
        userId: f.departing.userId,
      })
    ).toBeNull();
    await f.deleteDepartingMembership();
    expect(await f.departingMembershipExists()).toBe(false);
    expect((await f.state()).history?.data.text).toBe(f.message);
  });

  it("rejects a reviewed closure after another person joins, preserving ownership and history", async () => {
    const f = await fixture();
    const plan = await f.preview();
    expect(plan.spaces[0]?.action).toBe("close");
    const expectedSpace = plan.spaces[0];
    if (!expectedSpace) {
      throw new Error("Missing fixture removal plan");
    }
    await expect(
      (async () =>
        await f.stub.rpcPrepareOrganizationMemberRemovalSpace({
          context: f.context(f.manager),
          memberId: f.departing.memberId,
          spaceId: f.spaceId,
          expected: { ...expectedSpace, spaceId: crypto.randomUUID() },
        }))()
    ).rejects.toThrow("organization.member_removal_changed");
    await f.addCollaborator("active");
    await expect(f.prepare(plan.spaces)).rejects.toThrow(
      "organization.member_removal_changed"
    );
    const retained = await f.state();
    expect(retained.meta?.deletedAt).toBeUndefined();
    expect(retained.meta?.ownerUserIds).toEqual([f.departing.userId]);
    expect(retained.history?.data.text).toBe(f.message);
    expect(await f.departingMembershipExists()).toBe(true);
    expect((await f.preview()).spaces[0]?.action).toBe("transfer");
  });

  it("rechecks manager, tenant, and successor authority at preparation", async () => {
    const f = await fixture();
    await f.addCollaborator("active");
    const plan = await f.preview();
    const expectedSpace = plan.spaces[0];
    if (!expectedSpace) {
      throw new Error("Missing fixture removal plan");
    }
    const memberContext = f.context(f.collaborator);
    const otherOrganizationId = crypto.randomUUID();
    await f.db.query({
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Other organization\', $1, $2)',
      values: [otherOrganizationId, Date.now()],
    });
    await f.db.query({
      text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'owner\', $4)',
      values: [
        crypto.randomUUID(),
        otherOrganizationId,
        f.manager.userId,
        Date.now(),
      ],
    });
    const otherOrganizationContext = {
      ...f.context(f.manager),
      activeOrganizationId: otherOrganizationId,
    };
    for (const context of [memberContext, otherOrganizationContext]) {
      await expect(
        previewOrganizationMemberRemoval(core, {
          context,
          memberId: f.departing.memberId,
        })
      ).rejects.toThrow();
      await expect(
        prepareOrganizationMemberRemoval(core, {
          context,
          memberId: f.departing.memberId,
          spaces: plan.spaces,
          successorUserId: f.successor.userId,
        })
      ).rejects.toThrow();
      await expect(
        (async () =>
          await f.stub.rpcPrepareOrganizationMemberRemovalSpace({
            context,
            memberId: f.departing.memberId,
            spaceId: f.spaceId,
            expected: expectedSpace,
            successorUserId: f.successor.userId,
          }))()
      ).rejects.toThrow();
    }
    await expect(f.prepare(plan.spaces, crypto.randomUUID())).rejects.toThrow();
    await expect(f.prepare(plan.spaces, f.departing.userId)).rejects.toThrow();
    const retained = await f.state();
    expect(retained.meta?.ownerUserIds).toEqual([f.departing.userId]);
    expect(retained.meta?.deletedAt).toBeUndefined();
    expect(await f.departingMembershipExists()).toBe(true);
  });

  it.each([
    "pending Wake",
    "pending invitation",
  ] as const)("requires transfer for a solo Space with a %s", async (pending) => {
    const f = await fixture();
    if (pending === "pending Wake") {
      await runInDurableObject(f.stub, (_instance, state) => {
        insertDispatchOutboxRecord(
          state.storage.sql,
          createDispatchOutboxRecord({
            bindingEnabled: true,
            bindingState: "bound",
            dispatchPolicy: "mention_only",
            nowMs: Date.now(),
            ruleId: "wake_explicit_activation",
            ruleReason: "Explicit Wake target",
            ruleSource: "registry",
            senderProfileId: f.departing.profileId,
            sourceEventId: f.signalId,
            sourceSignalSnapshot: {
              profileId: f.departing.profileId,
              profileKind: "human",
              text: f.message,
            },
            spaceId: f.spaceId,
            targetProfileId: `agt_${crypto.randomUUID()}`,
          })
        );
      });
    } else {
      await f.db.query({
        text: 'INSERT INTO "openmeld"."space_invitations" (id, organization_id, space_id, email, inviter_user_id, status, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, \'pending\', $6, $7)',
        values: [
          crypto.randomUUID(),
          f.organizationId,
          f.spaceId,
          `${f.successor.userId}@example.com`,
          f.departing.userId,
          Date.now(),
          Date.now() + 60_000,
        ],
      });
    }
    expect((await f.preview()).spaces).toEqual([
      { spaceId: f.spaceId, name: "Welcome Space", action: "transfer" },
    ]);
    expect((await f.state()).meta?.deletedAt).toBeUndefined();
  });
});

async function fixture() {
  const db = getPostgresDatabase(env);
  const organizationId = crypto.randomUUID();
  const now = Date.now();
  const people = ["manager", "departing", "successor", "collaborator"].map(
    (name) => ({
      name,
      userId: crypto.randomUUID(),
      profileId: crypto.randomUUID(),
      memberId: crypto.randomUUID(),
    })
  );
  const [manager, departing, successor, collaborator] = people as [
    (typeof people)[number],
    (typeof people)[number],
    (typeof people)[number],
    (typeof people)[number],
  ];
  await db.transaction(async (client) => {
    await client.query({
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Departure fixture\', $1, $2)',
      values: [organizationId, now],
    });
    for (const person of people) {
      await client.query({
        text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $4)',
        values: [
          person.userId,
          person.name,
          `${person.userId}@example.com`,
          now,
        ],
      });
      await client.query({
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $1, 'human', 1, 'active', $3, $3, 'auth_bootstrap', $4, $4)",
        values: [person.profileId, person.name, person.userId, now],
      });
      await client.query({
        text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        values: [
          person.memberId,
          organizationId,
          person.userId,
          person === manager ? "owner" : "member",
          now,
        ],
      });
    }
  });
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const objectId = namespace.newUniqueId();
  const spaceId = objectId.toString();
  const stub = namespace.get(objectId);
  const signalId = crypto.randomUUID();
  const message = "A retained personal onboarding conversation.";
  await runInDurableObject(stub, (_instance, state) => {
    const creator = {
      profileId: departing.profileId,
      kind: "human" as const,
      ownerUserId: departing.userId,
      profileName: departing.name,
    };
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId,
      name: "Welcome Space",
      organizationId,
      creator,
      ownerUserIds: [departing.userId],
      allowGuests: false,
      visibility: "private",
      accessMode: "members_only",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    upsertSpaceCreatorMember({ sql: state.storage.sql, spaceId, creator });
    insertSignalRecord(state.storage.sql, {
      v: 1,
      id: signalId,
      spaceId,
      ts: now,
      type: "signal.text",
      profile: creator,
      data: { text: message },
    });
  });
  await db.query({
    text: 'INSERT INTO "openmeld"."space_owner_member_references" (space_id, member_id) VALUES ($1, $2)',
    values: [spaceId, departing.memberId],
  });
  const context = (person: typeof manager) => ({
    activeOrganizationId: organizationId,
    actorContext: {
      requestId: crypto.randomUUID(),
      callerPrincipalId: person.userId,
      ownerUserId: person.userId,
      openMeldProfileId: person.profileId,
      profileKind: "human" as const,
      profileName: person.name,
    },
  });
  const preview = () =>
    previewOrganizationMemberRemoval(core, {
      context: context(manager),
      memberId: departing.memberId,
    });
  const gateway = Object.create(GatewayRpcEntrypoint.prototype) as InstanceType<
    typeof GatewayRpcEntrypoint
  >;
  Reflect.set(gateway, "env", env);
  const prepare = (
    spaces: Awaited<ReturnType<typeof preview>>["spaces"],
    successorUserId?: string
  ) =>
    gateway.prepareOrganizationMemberRemoval({
      context: context(manager),
      memberId: departing.memberId,
      requestCredential: { kind: "interactive_session" },
      spaces,
      ...(successorUserId ? { successorUserId } : {}),
    });
  return {
    db,
    organizationId,
    manager,
    departing,
    successor,
    collaborator,
    spaceId,
    stub,
    signalId,
    message,
    context,
    preview,
    prepare,
    deleteDepartingMembership: () =>
      db.query({
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [departing.memberId],
      }),
    departingMembershipExists: async () =>
      (
        await db.query({
          text: 'SELECT id FROM "openmeld"."members" WHERE id = $1',
          values: [departing.memberId],
        })
      ).rows.length === 1,
    state: () =>
      runInDurableObject(stub, (_instance, state) => {
        const row = state.storage.sql
          .exec<{ payload_json: string }>(
            "SELECT payload_json FROM space_signals WHERE id = ?",
            signalId
          )
          .toArray()[0];
        return {
          meta: readSpaceMetaRecordFromSql(state.storage.sql, spaceId),
          members: listSpaceMemberRecords(state.storage.sql),
          history: row
            ? (JSON.parse(row.payload_json) as { data: { text: string } })
            : null,
        };
      }),
    addCollaborator: (status: "active" | "removed") =>
      runInDurableObject(stub, (_instance, state) => {
        upsertJoinedSpaceMember({
          sql: state.storage.sql,
          spaceId,
          ownerUserId: collaborator.userId,
          profile: {
            profileId: collaborator.profileId,
            kind: "human",
            profileName: collaborator.name,
          },
        });
        if (status === "removed") {
          removeSpaceMembersUseCase({
            sql: state.storage.sql,
            spaceId,
            memberProfileIds: [collaborator.profileId],
            actorProfileId: departing.profileId,
            actorOwnerUserId: departing.userId,
            metaRecord: readSpaceMetaRecordFromSql(state.storage.sql, spaceId),
          });
        }
      }),
  };
}
