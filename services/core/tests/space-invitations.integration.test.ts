import { env, runInDurableObject } from "cloudflare:test";
import type {
  OrganizationJoinRequestRpcInput,
  SpaceInvitationRpcInput,
  SpaceInvitationRpcResult,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { organizationJoinRequest } from "../src/organizations/organization-join-requests";
import { spaceInvitation } from "../src/organizations/space-invitations";
import { upsertSpaceCreatorMember } from "../src/space/application/space-members-service";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import type { Space } from "../src/space/transport/do/space";

const core = env as unknown as CoreBindings;

// First-party Auth directory contract; membership decisions still exercise D1.
const requestCore: CoreBindings = {
  ...core,
  OPENMELD_AUTH_WORKER: {
    resolveOrganizationDirectoryMembers: async ({ organizationId }) => {
      const rows = await env.OPENMELD_DB.prepare(
        "SELECT m.id, m.user_id, m.role, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?"
      )
        .bind(organizationId)
        .all<{
          id: string;
          user_id: string;
          role: string;
          email: string;
          name: string;
        }>();
      return {
        ok: true,
        organizationId,
        members: rows.results.map((row) => ({
          memberId: row.id,
          organizationId,
          userId: row.user_id,
          role: row.role,
          joinedAt: new Date().toISOString(),
          humanProfile: null,
          user: {
            id: row.user_id,
            email: row.email,
            name: row.name,
            image: null,
          },
        })),
      };
    },
  },
};

describe("invitation approval boundary", () => {
  it("keeps requests separate from membership, blocks member approval, and queues one review email", async () => {
    const f = await fixture();
    await f.joinOrganization();
    const call = (
      userId: string,
      request: OrganizationJoinRequestRpcInput["request"]
    ) =>
      organizationJoinRequest(requestCore, {
        userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        request,
      });
    const create = () =>
      call(f.recipientId, {
        action: "create",
        organizationId: f.organizationId,
        email: "new-person@example.com",
      });
    const result = await create();
    if (!(result.ok && result.requests[0])) {
      throw new Error(JSON.stringify(result));
    }
    const requestId = result.requests[0].id;
    expect(result.requests[0].status).toBe("pending");
    expect(await create()).toMatchObject({
      ok: true,
      requests: [{ id: requestId }],
    });
    expect(
      await call(f.recipientId, { action: "approve", requestId })
    ).toMatchObject({ ok: false, code: "organization.join_request.forbidden" });
    const counts = await env.OPENMELD_DB.prepare(
      "SELECT (SELECT count(*) FROM inbox_items WHERE organization_id = ?) AS inbox, (SELECT count(*) FROM inbox_email_deliveries WHERE inbox_item_id IN (SELECT id FROM inbox_items WHERE organization_id = ?)) AS emails, (SELECT count(*) FROM invitations WHERE organization_id = ?) AS invitations"
    )
      .bind(f.organizationId, f.organizationId, f.organizationId)
      .first();
    expect(counts).toEqual({ inbox: 1, emails: 1, invitations: 0 });
    expect(
      await call(f.ownerId, { action: "approve", requestId })
    ).toMatchObject({
      ok: true,
      requests: [{ status: "approved", invitationSentAt: null }],
    });
    const reviewState = () =>
      env.OPENMELD_DB.prepare(
        "SELECT resolution_status FROM inbox_items WHERE organization_id = ? AND source_key = ?"
      )
        .bind(f.organizationId, `invitation:${requestId}`)
        .first();
    // Approval is not delivery: keep the actionable item until Auth confirms sending.
    expect(await reviewState()).toEqual({ resolution_status: "open" });
    expect(
      await call(f.recipientId, { action: "delivery_complete", requestId })
    ).toMatchObject({ ok: false, code: "organization.join_request.forbidden" });
    expect(
      await call(f.ownerId, { action: "delivery_complete", requestId })
    ).toMatchObject({
      ok: true,
      requests: [{ invitationSentAt: expect.any(Number) }],
    });
    expect(await reviewState()).toEqual({ resolution_status: "resolved" });
    expect(
      await call(f.ownerId, { action: "reject", requestId })
    ).toMatchObject({
      ok: false,
      code: "organization.join_request.already_reviewed",
    });
    expect(
      await env.OPENMELD_DB.prepare(
        "SELECT count(*) AS count FROM members WHERE organization_id = ?"
      )
        .bind(f.organizationId)
        .first()
    ).toEqual({ count: 2 });
  });

  it("does not let an unverified applicant or a non-Space sponsor create a request", async () => {
    const f = await fixture();
    await f.joinOrganization();
    const input = {
      userId: f.recipientId,
      email: f.email,
      emailVerified: true,
      request: {
        action: "create" as const,
        organizationId: f.organizationId,
        spaceId: f.spaceId,
        email: "another@example.com",
      },
    };
    expect(await organizationJoinRequest(requestCore, input)).toMatchObject({
      ok: false,
      code: "space.invitation.forbidden",
    });
    expect(
      await organizationJoinRequest(requestCore, {
        ...input,
        emailVerified: false,
      })
    ).toMatchObject({
      ok: false,
      code: "organization.join_request.email_verification_required",
    });
  });
});

async function fixture() {
  const organizationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const recipientId = crypto.randomUUID();
  const ownerProfile = crypto.randomUUID();
  const recipientProfile = crypto.randomUUID();
  const email = `${recipientId}@example.com`;
  const now = Date.now();
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Harbor Design', ?, ?)"
  )
    .bind(organizationId, organizationId, now)
    .run();
  for (const [userId, profileId, address] of [
    [ownerId, ownerProfile, `${ownerId}@example.com`],
    [recipientId, recipientProfile, email],
  ]) {
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Morgan Lee', ?, 1, ?, ?)"
      ).bind(userId, address, now, now),
      env.OPENMELD_DB.prepare(
        "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES (?, 'Morgan Lee', ?, 'human', 1, 'active', ?, ?, 'auth_bootstrap', ?, ?)"
      ).bind(profileId, profileId, userId, userId, now, now),
    ]);
  }
  await env.OPENMELD_DB.prepare(
    "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
  )
    .bind(crypto.randomUUID(), organizationId, ownerId, now)
    .run();
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const objectId = namespace.newUniqueId();
  const spaceId = objectId.toString();
  const stub = namespace.get(objectId);
  await runInDurableObject(stub, (_instance, state) => {
    const creator = {
      profileId: ownerProfile,
      kind: "human" as const,
      ownerUserId: ownerId,
      profileName: "Morgan Lee",
    };
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId,
      name: "Launch planning",
      organizationId,
      creator,
      visibility: "private",
      accessMode: "members_only",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    upsertSpaceCreatorMember({ sql: state.storage.sql, spaceId, creator });
  });
  const owner = (request: SpaceInvitationRpcInput["request"]) =>
    spaceInvitation(core, {
      userId: ownerId,
      email: `${ownerId}@example.com`,
      emailVerified: true,
      request,
    });
  const recipient = (request: SpaceInvitationRpcInput["request"]) =>
    spaceInvitation(core, {
      userId: recipientId,
      email,
      emailVerified: true,
      request,
    });
  const joinOrganization = () =>
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
    )
      .bind(crypto.randomUUID(), organizationId, recipientId, now)
      .run();
  const create = () =>
    owner({ action: "create", organizationId, spaceId, email });
  const memberStatus = () =>
    runInDurableObject(
      stub,
      (_instance, state) =>
        [
          ...state.storage.sql.exec<{ status: string }>(
            "SELECT status FROM space_members WHERE profile_id = ?",
            recipientProfile
          ),
        ][0]?.status ?? null
    );
  return {
    owner,
    recipient,
    create,
    joinOrganization,
    memberStatus,
    stub,
    organizationId,
    ownerId,
    recipientId,
    recipientProfile,
    email,
    spaceId,
  };
}

function invitationId(result: SpaceInvitationRpcResult): string {
  if (!(result.result.ok && result.result.invitations[0])) {
    throw new Error(JSON.stringify(result));
  }
  return result.result.invitations[0].id;
}

describe("Space invitation admission", () => {
  it("rejects expired admission until an authorized sender resends", async () => {
    const f = await fixture();
    const id = invitationId(await f.create());
    await env.OPENMELD_DB.prepare(
      "UPDATE space_invitations SET expires_at = ? WHERE id = ?"
    )
      .bind(Date.now() - 1, id)
      .run();
    expect(
      await f.recipient({ action: "claim", invitationId: id })
    ).toMatchObject({
      result: { ok: false, code: "space.invitation.inactive" },
    });
    expect(await f.memberStatus()).toBeNull();
    expect(await f.owner({ action: "resend", invitationId: id })).toMatchObject(
      {
        result: { ok: true, invitations: [{ id, status: "pending" }] },
      }
    );
    expect(
      await f.recipient({ action: "claim", invitationId: id })
    ).toMatchObject({
      result: { ok: true, invitations: [{ id, status: "accepting" }] },
    });
  });
  it("requires current sender permission, the intended verified recipient, and Organization membership", async () => {
    const f = await fixture();
    const id = invitationId(await f.create());
    expect(await f.owner({ action: "claim", invitationId: id })).toMatchObject({
      result: { ok: false, code: "space.invitation.account_mismatch" },
    });
    expect(
      await spaceInvitation(core, {
        userId: f.recipientId,
        email: f.email,
        emailVerified: false,
        request: { action: "claim", invitationId: id },
      })
    ).toMatchObject({
      result: {
        ok: false,
        code: "space.invitation.email_verification_required",
      },
    });
    expect(
      await f.recipient({ action: "claim", invitationId: id })
    ).toMatchObject({ result: { ok: true }, organizationMember: false });
    expect(
      await f.recipient({ action: "complete", invitationId: id })
    ).toMatchObject({
      result: {
        ok: false,
        code: "space.invitation.organization_membership_required",
      },
    });
    expect(await f.memberStatus()).toBeNull();
    await env.OPENMELD_DB.prepare(
      "UPDATE members SET role = 'member' WHERE organization_id = ? AND user_id = ?"
    )
      .bind(f.organizationId, f.ownerId)
      .run();
    expect(await f.create()).toMatchObject({
      result: { ok: false, code: "space.invitation.forbidden" },
    });
  });

  it("deduplicates concurrent sends and never re-adds a removed member when acceptance is retried", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([f.create(), f.create()]);
    const id = invitationId(first);
    expect(invitationId(second)).toBe(id);
    await f.recipient({ action: "claim", invitationId: id });
    await f.joinOrganization();
    expect(
      await f.recipient({ action: "complete", invitationId: id })
    ).toMatchObject({
      result: { ok: true, invitations: [{ status: "accepted" }] },
    });
    expect(await f.memberStatus()).toBe("active");
    await runInDurableObject(f.stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE space_members SET status = 'removed' WHERE profile_id = ?",
        f.recipientProfile
      );
    });
    // Model a lost D1 completion acknowledgement after the Space transaction.
    await env.OPENMELD_DB.prepare(
      "UPDATE space_invitations SET status = 'accepting' WHERE id = ?"
    )
      .bind(id)
      .run();
    expect(
      await f.recipient({ action: "complete", invitationId: id })
    ).toMatchObject({ result: { ok: true } });
    expect(await f.memberStatus()).toBe("removed");
  });

  it("arbitrates revoke and grant in the same Space transaction", async () => {
    const f = await fixture();
    const id = invitationId(await f.create());
    await f.recipient({ action: "claim", invitationId: id });
    await f.joinOrganization();
    await Promise.all([
      f.owner({ action: "revoke", invitationId: id }),
      f.recipient({ action: "complete", invitationId: id }),
    ]);
    const result = await f.recipient({ action: "preview", invitationId: id });
    if (!result.result.ok) {
      throw new Error(JSON.stringify(result));
    }
    const status = result.result.invitations[0]?.status;
    expect(["accepted", "revoked"]).toContain(status);
    expect(await f.memberStatus()).toBe(
      status === "accepted" ? "active" : null
    );
  });
});
