import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import {
  type OrganizationJoinRequest,
  type OrganizationJoinRequestResponse,
  type OrganizationJoinRequestRpcInput,
  organizationJoinRequestRpcInputSchema,
} from "@openmeld/schemas";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../inbox/application/inbox-item-service";
import { type CoreBindings, identityDb } from "../lib/bindings";
import {
  readOrganizationAccountIdentityProjection,
  readOrganizationPersonalClassification,
  resolveOrganizationMembershipById,
} from "./organization-context";
import { resolveOrganizationDirectoryMembers } from "./organization-directory";
import {
  authorizeSpaceInvitationSponsor,
  InvitationError,
} from "./space-invitations";

const SELECT = `SELECT id, organization_id AS organizationId, space_id AS spaceId,
  requested_by_user_id AS requestedByUserId, email, status,
  reviewed_by_user_id AS reviewedByUserId, created_at AS createdAt,
  reviewed_at AS reviewedAt, invitation_sent_at AS invitationSentAt FROM organization_join_requests`;

class JoinRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
function deny(message: string): never {
  throw new JoinRequestError("organization.join_request.forbidden", message);
}

export async function organizationJoinRequest(
  env: CoreBindings,
  raw: OrganizationJoinRequestRpcInput
): Promise<OrganizationJoinRequestResponse> {
  const parsed = organizationJoinRequestRpcInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "organization.join_request.invalid_input",
      message: "Check the invitation request and try again.",
    };
  }
  try {
    return await execute(env, parsed.data);
  } catch (error) {
    if (error instanceof JoinRequestError || error instanceof InvitationError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

async function execute(
  env: CoreBindings,
  input: OrganizationJoinRequestRpcInput
): Promise<OrganizationJoinRequestResponse> {
  const db = identityDb(env);
  if (!db) {
    throw new Error("Join request database is unavailable");
  }
  const request = input.request;
  if (!input.emailVerified) {
    throw new JoinRequestError(
      "organization.join_request.email_verification_required",
      "Verify your email before continuing."
    );
  }
  if (request.action === "authorize_link") {
    await requireMember(env, request.organizationId, input.userId);
    if (request.spaceId) {
      await authorizeSpaceInvitationSponsor(
        env,
        request.organizationId,
        request.spaceId,
        input.userId
      );
    }
    return { ok: true, requests: [] };
  }
  if (
    request.action === "create" ||
    request.action === "list" ||
    request.action === "summary" ||
    request.action === "create_from_link"
  ) {
    return await createOrListRequests(env, db, input, request);
  }
  return await manageRequest(env, db, input, request);
}

async function createOrListRequests(
  env: CoreBindings,
  db: D1Database,
  input: OrganizationJoinRequestRpcInput,
  request: Extract<
    OrganizationJoinRequestRpcInput["request"],
    { action: "create" | "list" | "summary" | "create_from_link" }
  >
): Promise<OrganizationJoinRequestResponse> {
  const sponsorUserId =
    request.action === "create_from_link"
      ? request.sponsorUserId
      : input.userId;
  const member = await requireMember(
    env,
    request.organizationId,
    sponsorUserId
  );
  if (request.action === "summary") {
    const count = canReview(member.role)
      ? await db
          .prepare(
            "SELECT count(*) AS total FROM organization_join_requests WHERE organization_id = ? AND (status = 'pending' OR (status = 'approved' AND invitation_sent_at IS NULL AND reviewed_by_user_id = ?))"
          )
          .bind(request.organizationId, input.userId)
          .first<{ total: number }>()
      : null;
    return { ok: true, requests: [], actionRequiredCount: count?.total ?? 0 };
  }
  if (request.action === "list") {
    const reviewer = canReview(member.role);
    const rows = await db
      .prepare(
        `${SELECT} WHERE organization_id = ? ${reviewer ? "" : "AND requested_by_user_id = ?"} ORDER BY created_at DESC LIMIT 100`
      )
      .bind(request.organizationId, ...(reviewer ? [] : [input.userId]))
      .all<OrganizationJoinRequest>();
    return {
      ok: true,
      requests: rows.results.map((row) => ({
        ...row,
        canReview:
          reviewer &&
          (row.status === "pending" || row.reviewedByUserId === input.userId),
      })),
    };
  }
  if (request.spaceId) {
    await authorizeSpaceInvitationSponsor(
      env,
      request.organizationId,
      request.spaceId,
      sponsorUserId
    );
  }
  const email =
    request.action === "create_from_link"
      ? input.email.toLowerCase()
      : request.email;
  await db
    .prepare(`INSERT INTO organization_join_requests
    (id, organization_id, space_id, requested_by_user_id, email, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT DO NOTHING`)
    .bind(
      crypto.randomUUID(),
      request.organizationId,
      request.spaceId ?? null,
      sponsorUserId,
      email,
      Date.now()
    )
    .run();
  const row = await db
    .prepare(
      `${SELECT} WHERE organization_id = ? AND coalesce(space_id, '') = ? AND email = ? AND status = 'pending'`
    )
    .bind(request.organizationId, request.spaceId ?? "", email)
    .first<OrganizationJoinRequest>();
  if (!row) {
    throw new Error("Join request could not be saved");
  }
  if (row.requestedByUserId !== sponsorUserId && !canReview(member.role)) {
    throw new JoinRequestError(
      "organization.join_request.already_pending",
      "An invitation request for this person is already awaiting review."
    );
  }
  await projectReview(env, db, row);
  return {
    ok: true,
    requests: [
      {
        ...row,
        canReview:
          request.action !== "create_from_link" && canReview(member.role),
      },
    ],
  };
}

async function manageRequest(
  env: CoreBindings,
  db: D1Database,
  input: OrganizationJoinRequestRpcInput,
  request: Exclude<
    OrganizationJoinRequestRpcInput["request"],
    {
      action:
        | "create"
        | "list"
        | "summary"
        | "create_from_link"
        | "authorize_link";
    }
  >
): Promise<OrganizationJoinRequestResponse> {
  const row = await db
    .prepare(`${SELECT} WHERE id = ?`)
    .bind(request.requestId)
    .first<OrganizationJoinRequest>();
  if (!row) {
    throw new JoinRequestError(
      "organization.join_request.unavailable",
      "This request is no longer available."
    );
  }
  const member = await resolveOrganizationMembershipById({
    env,
    organizationId: row.organizationId,
    userId: input.userId,
  });
  const reviewer = member.ok && canReview(member.role);
  const requester = member.ok && row.requestedByUserId === input.userId;
  if (request.action === "delivery_complete") {
    if (
      !(
        reviewer &&
        row.status === "approved" &&
        row.reviewedByUserId === input.userId
      )
    ) {
      deny("Only the approving administrator can confirm invitation delivery.");
    }
    return await completeDelivery(db, row);
  }
  if (request.action === "get") {
    if (!(reviewer || requester || input.email.toLowerCase() === row.email)) {
      deny("This request belongs to another account.");
    }
    return await viewRequest(
      env,
      db,
      row,
      reviewer &&
        (row.status === "pending" || row.reviewedByUserId === input.userId)
    );
  }
  if (request.action === "cancel" ? !requester : !reviewer) {
    deny(
      "Only an organization owner or admin can review this request. The sender can cancel it."
    );
  }
  return await decideRequest(env, db, input.userId, row, request.action);
}

async function decideRequest(
  env: CoreBindings,
  db: D1Database,
  userId: string,
  row: OrganizationJoinRequest,
  action: "approve" | "reject" | "cancel"
): Promise<OrganizationJoinRequestResponse> {
  const status = (
    { approve: "approved", reject: "rejected", cancel: "cancelled" } as const
  )[action];
  if (row.status !== "pending" && row.status !== status) {
    throw new JoinRequestError(
      "organization.join_request.already_reviewed",
      "This request has already been handled. Refresh to see the result."
    );
  }
  if (status === "approved") {
    await requireMember(env, row.organizationId, row.requestedByUserId);
    if (row.spaceId) {
      await authorizeSpaceInvitationSponsor(
        env,
        row.organizationId,
        row.spaceId,
        row.requestedByUserId
      );
    }
  }
  await db
    .prepare(
      `UPDATE organization_join_requests SET status = ?, reviewed_by_user_id = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`
    )
    .bind(status, userId, Date.now(), row.id)
    .run();
  const current = await db
    .prepare(`${SELECT} WHERE id = ?`)
    .bind(row.id)
    .first<OrganizationJoinRequest>();
  if (!current) {
    throw new Error("Reviewed join request disappeared");
  }
  if (current.status !== status) {
    throw new JoinRequestError(
      "organization.join_request.already_reviewed",
      "Another person handled this request. Refresh to see the result."
    );
  }
  if (current.status !== "approved" || current.invitationSentAt !== null) {
    await resolveInboxItemsBySource({
      db,
      organizationId: row.organizationId,
      resolvedAtMs: current.reviewedAt ?? Date.now(),
      sourceKey: `invitation:${row.id}`,
      sourceKind: "organization_member_request",
    });
  }
  return { ok: true, requests: [current] };
}

async function requireMember(
  env: CoreBindings,
  organizationId: string,
  userId: string
) {
  const member = await resolveOrganizationMembershipById({
    env,
    organizationId,
    userId,
  });
  if (!member.ok) {
    deny("Join this organization before inviting someone.");
  }
  const classification = await readOrganizationPersonalClassification({
    env,
    organizationId,
  });
  if (!classification.ok || classification.personal) {
    deny("Invitations are only available in team organizations.");
  }
  return member;
}
function canReview(role: string) {
  return memberRoleHasOrganizationPermission(role, { invitation: ["create"] });
}
async function projectReview(
  env: CoreBindings,
  db: D1Database,
  request: OrganizationJoinRequest
) {
  const members = await resolveOrganizationDirectoryMembers({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: request.organizationId,
    requestId: crypto.randomUUID(),
  });
  const reviewers = members.filter((member) => canReview(member.role));
  if (!reviewers.length) {
    throw new Error("No invitation reviewer is available");
  }
  for (const member of reviewers) {
    await ensureInboxItem({
      db,
      nowMs: Date.now(),
      candidate: {
        organizationId: request.organizationId,
        recipientUserId: member.userId,
        sourceKind: "organization_member_request",
        sourceKey: `invitation:${request.id}`,
        sourceTarget: {
          kind: "organization_join_request",
          requestId: request.id,
        },
        attention: "action_required",
        importance: "normal",
        kind: "organization_request",
        title: "Review an invitation request",
        preview:
          "Review the recipient and requested access before sending an invitation.",
        contextLabel: null,
        occurredAtMs: request.createdAt,
      },
    });
  }
}

async function viewRequest(
  env: CoreBindings,
  db: D1Database,
  row: OrganizationJoinRequest,
  reviewer: boolean
): Promise<OrganizationJoinRequestResponse> {
  const identity = await readOrganizationAccountIdentityProjection({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: row.organizationId,
    account: { kind: "user_id", userId: row.requestedByUserId },
  });
  if (!identity?.ok) {
    throw new Error("Invitation request identity is unavailable");
  }
  const space = row.spaceId
    ? await db
        .prepare(
          "SELECT space_name FROM space_index_spaces WHERE space_id = ? AND organization_id = ?"
        )
        .bind(row.spaceId, row.organizationId)
        .first<{ space_name: string }>()
    : null;
  return {
    ok: true,
    requests: [
      {
        ...row,
        canReview: reviewer,
        organizationName: identity.organization.name,
        requestedByName: identity.account?.displayName,
        spaceName: space?.space_name ?? null,
      },
    ],
  };
}

async function completeDelivery(
  db: D1Database,
  row: OrganizationJoinRequest
): Promise<OrganizationJoinRequestResponse> {
  const sentAt = row.invitationSentAt ?? Date.now();
  await db
    .prepare(
      "UPDATE organization_join_requests SET invitation_sent_at = coalesce(invitation_sent_at, ?) WHERE id = ? AND status = 'approved'"
    )
    .bind(sentAt, row.id)
    .run();
  await resolveInboxItemsBySource({
    db,
    organizationId: row.organizationId,
    resolvedAtMs: sentAt,
    sourceKey: `invitation:${row.id}`,
    sourceKind: "organization_member_request",
  });
  return { ok: true, requests: [{ ...row, invitationSentAt: sentAt }] };
}
