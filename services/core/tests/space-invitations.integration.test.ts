import { env, runInDurableObject } from "cloudflare:test";
import type {
  SpaceInvitationRpcInput,
  SpaceInvitationRpcResult,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { spaceInvitation } from "../src/organizations/space-invitations";
import { upsertSpaceCreatorMember } from "../src/space/application/space-members-service";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import type { Space } from "../src/space/transport/do/space";

const core = env as unknown as CoreBindings;

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
