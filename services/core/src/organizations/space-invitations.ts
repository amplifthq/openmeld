import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import {
  ORGANIZATION_INVITATION_LIFETIME_SECONDS,
  type SpaceInvitation,
  type SpaceInvitationRpcInput,
  type SpaceInvitationRpcResult,
  spaceInvitationRpcInputSchema,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { readResolvedOrganizationOwnerHumanSpaceMember } from "../center-agent/center-agent-repository";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { resolveSpaceStub } from "../rpc/space-ref";
import {
  readOrganizationPersonalClassification,
  resolveOrganizationMembershipById,
} from "./organization-context";

type InvitationRow = {
  id: string;
  organization_id: string;
  space_id: string;
  email: string;
  inviter_user_id: string;
  sponsor_user_id: string | null;
  organization_invitation_id: string | null;
  status: "pending" | "accepting" | "accepted" | "revoked";
  expires_at: number;
  organization_name: string;
  space_name: string | null;
  inviter_name: string;
};

const SELECT = `SELECT i.*, o.name AS organization_name, s.space_name, u.name AS inviter_name
  FROM space_invitations i JOIN organizations o ON o.id = i.organization_id
  JOIN users u ON u.id = i.inviter_user_id
  LEFT JOIN space_index_spaces s ON s.space_id = i.space_id`;
const LIFETIME_MS = ORGANIZATION_INVITATION_LIFETIME_SECONDS * 1000;

export class InvitationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new InvitationError(`space.invitation.${code}`, message);
}
function view(row: InvitationRow): SpaceInvitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    spaceId: row.space_id,
    spaceName: row.space_name ?? "Untitled Space",
    inviterName: row.inviter_name,
    email: row.email,
    expiresAt: row.expires_at,
    status:
      row.status === "pending" && row.expires_at <= Date.now()
        ? "expired"
        : row.status,
  };
}

export async function spaceInvitation(
  env: CoreBindings,
  raw: SpaceInvitationRpcInput
): Promise<SpaceInvitationRpcResult> {
  const parsed = spaceInvitationRpcInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      result: {
        ok: false,
        code: "space.invitation.invalid_input",
        message: "Invalid invitation request.",
      },
    };
  }
  try {
    return await execute(env, parsed.data);
  } catch (error) {
    if (error instanceof InvitationError) {
      return {
        result: { ok: false, code: error.code, message: error.message },
      };
    }
    throw error;
  }
}

async function execute(
  env: CoreBindings,
  input: SpaceInvitationRpcInput
): Promise<SpaceInvitationRpcResult> {
  const db = identityDb(env);
  if (!db) {
    throw new Error("Space invitation database is unavailable");
  }
  const request = input.request;
  if (request.action === "create_approved") {
    const approved = await db
      .prepare(
        "SELECT organization_id, space_id, email, requested_by_user_id FROM organization_join_requests WHERE id = ? AND status = 'approved'"
      )
      .bind(request.requestId)
      .first<{
        organization_id: string;
        space_id: string | null;
        email: string;
        requested_by_user_id: string;
      }>();
    if (!approved?.space_id) {
      fail(
        "forbidden",
        "Approve this Space invitation request before continuing."
      );
    }
    await authorizeManager(
      env,
      approved.organization_id,
      approved.space_id,
      input.userId,
      true,
      approved.requested_by_user_id
    );
    const completed = await db
      .prepare(`${SELECT} WHERE i.id = ? AND i.status = 'accepted'`)
      .bind(request.requestId)
      .first<InvitationRow>();
    if (completed) {
      return success([completed]);
    }
    await db
      .prepare(
        "INSERT INTO space_invitations (id, organization_id, space_id, email, inviter_user_id, sponsor_user_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT DO NOTHING"
      )
      .bind(
        request.requestId,
        approved.organization_id,
        approved.space_id,
        approved.email,
        input.userId,
        approved.requested_by_user_id,
        Date.now(),
        Date.now() + LIFETIME_MS
      )
      .run();
    const invitation = await db
      .prepare(
        `${SELECT} WHERE i.organization_id = ? AND i.space_id = ? AND i.email = ? AND i.status IN ('pending', 'accepting') LIMIT 1`
      )
      .bind(approved.organization_id, approved.space_id, approved.email)
      .first<InvitationRow>();
    if (!invitation) {
      fail(
        "inactive",
        "This invitation has already been handled. Create a new request if needed."
      );
    }
    return await manageInvitation(env, db, input.userId, invitation, {
      action: "resend",
      invitationId: invitation.id,
    });
  }
  if (request.action === "pending") {
    return await listPendingInvitations(db, input);
  }
  if (request.action === "create" || request.action === "list") {
    return await createOrListInvitations(env, db, input.userId, request);
  }
  const row = await readInvitation(db, request.invitationId);
  if (
    request.action === "revoke" ||
    request.action === "resend" ||
    request.action === "bind"
  ) {
    return await manageInvitation(env, db, input.userId, row, request);
  }
  return await acceptInvitation(env, db, input, row);
}

async function readInvitation(
  db: D1Database,
  id: string
): Promise<InvitationRow> {
  const row = await db
    .prepare(`${SELECT} WHERE i.id = ?`)
    .bind(id)
    .first<InvitationRow>();
  if (!row) {
    fail(
      "unavailable",
      "This invitation is no longer available. Ask the sender for a new invitation."
    );
  }
  return row;
}
const success = (rows: InvitationRow[]): SpaceInvitationRpcResult => ({
  result: { ok: true, invitations: rows.map(view) },
});
async function listPendingInvitations(
  db: D1Database,
  input: SpaceInvitationRpcInput
): Promise<SpaceInvitationRpcResult> {
  if (!input.emailVerified) {
    fail(
      "email_verification_required",
      "Verify your email to view your invitations."
    );
  }
  const rows = await db
    .prepare(
      `${SELECT} WHERE i.email = ? AND i.status IN ('pending', 'accepting') AND (i.expires_at > ? OR i.status = 'accepting') ORDER BY i.created_at DESC LIMIT 100`
    )
    .bind(input.email.toLowerCase(), Date.now())
    .all<InvitationRow>();
  return success(rows.results);
}
async function createOrListInvitations(
  env: CoreBindings,
  db: D1Database,
  userId: string,
  request: Extract<
    SpaceInvitationRpcInput["request"],
    { action: "create" | "list" }
  >
): Promise<SpaceInvitationRpcResult> {
  await authorizeManager(env, request.organizationId, request.spaceId, userId);
  if (request.action === "list") {
    const rows = await db
      .prepare(
        `${SELECT} WHERE i.space_id = ? AND i.organization_id = ? AND i.status IN ('pending', 'accepting') ORDER BY i.created_at DESC LIMIT 100`
      )
      .bind(request.spaceId, request.organizationId)
      .all<InvitationRow>();
    return success(rows.results);
  }
  const existing = await db
    .prepare(
      `${SELECT} WHERE i.space_id = ? AND i.email = ? AND i.status IN ('pending', 'accepting') ORDER BY i.created_at DESC LIMIT 1`
    )
    .bind(request.spaceId, request.email)
    .first<InvitationRow>();
  if (existing) {
    return await manageInvitation(env, db, userId, existing, {
      action: "resend",
      invitationId: existing.id,
    });
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO space_invitations (id, organization_id, space_id, email, inviter_user_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT DO NOTHING`
    )
    .bind(
      id,
      request.organizationId,
      request.spaceId,
      request.email,
      userId,
      Date.now(),
      Date.now() + LIFETIME_MS
    )
    .run();
  const created = await db
    .prepare(
      `${SELECT} WHERE i.space_id = ? AND i.email = ? AND i.status IN ('pending', 'accepting') LIMIT 1`
    )
    .bind(request.spaceId, request.email)
    .first<InvitationRow>();
  if (!created) {
    fail("create_failed", "The invitation could not be saved. Try again.");
  }
  return success([created]);
}
async function manageInvitation(
  env: CoreBindings,
  db: D1Database,
  userId: string,
  row: InvitationRow,
  request: Extract<
    SpaceInvitationRpcInput["request"],
    { action: "revoke" | "resend" | "bind" }
  >
): Promise<SpaceInvitationRpcResult> {
  const managerContext = await authorizeManager(
    env,
    row.organization_id,
    row.space_id,
    userId,
    true,
    row.sponsor_user_id ?? userId
  );
  if (
    row.status !== "pending" &&
    row.status !== "accepting" &&
    !(request.action === "revoke" && row.status === "revoked")
  ) {
    fail(
      "inactive",
      "This invitation is no longer pending. Refresh to see its current status."
    );
  }
  if (request.action === "revoke") {
    const stub = resolveSpaceStub(env.OPENMELD_SPACES, row.space_id);
    if (!stub) {
      fail("unavailable", "This Space is no longer available.");
    }
    const status = await stub.rpcRevokeSpaceInvitation({
      spaceId: row.space_id,
      context: managerContext,
      invitationId: row.id,
    });
    await db
      .prepare(
        "UPDATE space_invitations SET status = ? WHERE id = ? AND status IN ('pending', 'accepting')"
      )
      .bind(status, row.id)
      .run();
  } else if (request.action === "resend") {
    await db
      .prepare(
        "UPDATE space_invitations SET expires_at = ?, inviter_user_id = ? WHERE id = ? AND status IN ('pending', 'accepting')"
      )
      .bind(Date.now() + LIFETIME_MS, userId, row.id)
      .run();
  } else if (request.action === "bind") {
    // The native invitation is checked independently, not trusted from an
    // email callback or client-supplied identifier.
    const native = await db
      .prepare(
        "SELECT id FROM invitations WHERE id = ? AND organization_id = ? AND lower(email) = ? AND status = 'pending' AND role = 'member'"
      )
      .bind(request.organizationInvitationId, row.organization_id, row.email)
      .first();
    if (!native) {
      fail(
        "organization_invitation_invalid",
        "The organization invitation is unavailable. Resend this invitation."
      );
    }
    await db
      .prepare(
        "UPDATE space_invitations SET organization_invitation_owned = CASE WHEN organization_invitation_id = ? THEN MAX(organization_invitation_owned, ?) ELSE ? END, organization_invitation_id = ? WHERE id = ? AND status IN ('pending', 'accepting')"
      )
      .bind(
        request.organizationInvitationId,
        Number(request.organizationInvitationOwned),
        Number(request.organizationInvitationOwned),
        request.organizationInvitationId,
        row.id
      )
      .run();
  }
  const current = await readInvitation(db, row.id);
  if (
    request.action === "revoke" &&
    current.status === "revoked" &&
    current.organization_invitation_id
  ) {
    const nativeId = current.organization_invitation_id;
    const owned = await db
      .prepare(
        "SELECT id FROM space_invitations WHERE organization_invitation_id = ? AND organization_invitation_owned = 1 LIMIT 1"
      )
      .bind(nativeId)
      .first();
    const needed = await db
      .prepare(
        "SELECT id FROM space_invitations WHERE organization_invitation_id = ? AND status IN ('pending', 'accepting') LIMIT 1"
      )
      .bind(nativeId)
      .first();
    return {
      ...success([current]),
      organizationInvitationId: nativeId,
      cancelOrganizationInvitation: Boolean(owned && !needed),
    };
  }
  return success([current]);
}
async function acceptInvitation(
  env: CoreBindings,
  db: D1Database,
  input: SpaceInvitationRpcInput,
  row: InvitationRow
): Promise<SpaceInvitationRpcResult> {
  const request = input.request;
  if (row.email !== input.email.toLowerCase()) {
    fail(
      "account_mismatch",
      "This invitation is for a different email address. Switch to the account that received it."
    );
  }
  if (!input.emailVerified) {
    fail(
      "email_verification_required",
      "Verify your email, then return here to accept the invitation."
    );
  }
  const membership = await resolveOrganizationMembershipById({
    env,
    organizationId: row.organization_id,
    userId: input.userId,
  });
  if (request.action === "preview") {
    return {
      ...success([row]),
      organizationInvitationId: row.organization_invitation_id,
      organizationMember: membership.ok,
    };
  }
  if (row.status === "accepted") {
    return { ...success([row]), organizationMember: membership.ok };
  }
  if (
    row.status === "revoked" ||
    (row.status === "pending" && row.expires_at <= Date.now())
  ) {
    fail(
      "inactive",
      "This invitation has expired or was revoked. Ask the sender for a new invitation."
    );
  }
  const context = await authorizeManager(
    env,
    row.organization_id,
    row.space_id,
    row.inviter_user_id,
    true,
    row.sponsor_user_id ?? row.inviter_user_id
  );
  if (request.action === "claim") {
    await db
      .prepare(
        "UPDATE space_invitations SET status = 'accepting' WHERE id = ? AND status = 'pending' AND expires_at > ?"
      )
      .bind(row.id, Date.now())
      .run();
    const current = await readInvitation(db, row.id);
    if (current.status !== "accepting" && current.status !== "accepted") {
      fail("inactive", "This invitation is no longer available.");
    }
    return {
      ...success([current]),
      organizationInvitationId: current.organization_invitation_id,
      organizationMember: membership.ok,
    };
  }
  if (request.action !== "complete" || row.status !== "accepting") {
    fail("invalid_action", "Accept this invitation before continuing.");
  }
  if (!membership.ok) {
    fail(
      "organization_membership_required",
      "Join the organization before continuing. Try accepting this invitation again."
    );
  }
  const member = await readResolvedOrganizationOwnerHumanSpaceMember({
    db,
    organizationId: row.organization_id,
    ownerUserId: input.userId,
  });
  if (!member) {
    fail(
      "profile_unavailable",
      "Your account is not ready yet. Try accepting the invitation again."
    );
  }
  const stub = resolveSpaceStub(env.OPENMELD_SPACES, row.space_id);
  if (!stub) {
    fail("unavailable", "This Space is no longer available.");
  }
  const status = await stub.rpcAcceptSpaceInvitation({
    spaceId: row.space_id,
    context,
    invitationId: row.id,
    member,
  });
  await db
    .prepare(
      "UPDATE space_invitations SET status = ? WHERE id = ? AND status IN ('pending', 'accepting')"
    )
    .bind(status, row.id)
    .run();
  if (status === "revoked") {
    fail(
      "inactive",
      "This invitation was revoked before you joined the Space."
    );
  }
  return success([await readInvitation(db, row.id)]);
}

async function authorizeManager(
  env: CoreBindings,
  organizationId: string,
  spaceId: string,
  userId: string,
  requireInvitationPermission = true,
  sponsorUserId = userId
): Promise<OpenMeldRequestContext> {
  const membership = await resolveOrganizationMembershipById({
    env,
    organizationId,
    userId,
  });
  if (
    !(
      membership.ok &&
      (!requireInvitationPermission ||
        memberRoleHasOrganizationPermission(membership.role, {
          invitation: ["create"],
        }))
    )
  ) {
    fail(
      "forbidden",
      "An organization owner or admin who belongs to this Space must send the invitation."
    );
  }
  const personal = await readOrganizationPersonalClassification({
    env,
    organizationId,
  });
  if (!personal.ok || personal.personal) {
    fail("forbidden", "Invitations are only available in team organizations.");
  }
  if (sponsorUserId !== userId) {
    const sponsor = await resolveOrganizationMembershipById({
      env,
      organizationId,
      userId: sponsorUserId,
    });
    if (!sponsor.ok) {
      fail(
        "forbidden",
        "The person who requested this invitation no longer belongs to the organization."
      );
    }
  }
  const db = identityDb(env);
  if (!db) {
    throw new Error("Space invitation database is unavailable");
  }
  const profile = await readResolvedOrganizationOwnerHumanSpaceMember({
    db,
    organizationId,
    ownerUserId: sponsorUserId,
  });
  if (!profile) {
    fail("forbidden", "Your account cannot manage this invitation.");
  }
  const context: OpenMeldRequestContext = {
    activeOrganizationId: organizationId,
    actorContext: {
      requestId: crypto.randomUUID(),
      openMeldProfileId: profile.profileId,
      profileKind: "human",
      ownerUserId: sponsorUserId,
      ...(profile.profileName ? { profileName: profile.profileName } : {}),
    },
  };
  const stub = resolveSpaceStub(env.OPENMELD_SPACES, spaceId);
  if (!stub) {
    fail("unavailable", "This Space is no longer available.");
  }
  if (!(await stub.rpcAuthorizeSpaceInvitation({ spaceId, context }))) {
    fail("forbidden", "Only members of an ordinary Space can invite people.");
  }
  return context;
}

// A member can propose adding someone, but cannot authorize Organization entry.
// The request owner checks reviewer authority separately before fulfillment.
export function authorizeSpaceInvitationSponsor(
  env: CoreBindings,
  organizationId: string,
  spaceId: string,
  userId: string
): Promise<OpenMeldRequestContext> {
  return authorizeManager(env, organizationId, spaceId, userId, false);
}
