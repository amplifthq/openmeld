import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import {
  type OrganizationJoinRequest,
  type OrganizationJoinRequestResponse,
  type OrganizationJoinRequestRpcInput,
  organizationJoinRequestResponseForVersion,
  organizationJoinRequestRpcInputSchema,
} from "@openmeld/schemas";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../inbox/application/inbox-item-service";
import { readInboxItemBySource } from "../inbox/infrastructure/d1/inbox-item-repo";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { reconcileInvitationInbox } from "./invitation-inbox-projection";
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
  reviewed_at AS reviewedAt, invitation_sent_at AS invitationSentAt,
  applicant_user_id AS applicantUserId, joined_at AS joinedAt FROM organization_join_requests`;

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
    return organizationJoinRequestResponseForVersion(
      await execute(env, parsed.data),
      parsed.data.responseVersion
    );
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
            "SELECT count(*) AS total FROM organization_join_requests WHERE organization_id = ? AND (status = 'pending' OR (status = 'approved' AND invitation_sent_at IS NULL AND joined_at IS NULL))"
          )
          .bind(request.organizationId)
          .first<{ total: number }>()
      : null;
    return { ok: true, requests: [], actionRequiredCount: count?.total ?? 0 };
  }
  if (request.action === "list") {
    const reviewer = canReview(member.role);
    const rows = await db
      .prepare(
        `${SELECT} WHERE organization_id = ? ${reviewer ? "" : "AND requested_by_user_id = ?"} ${request.before ? "AND ((status = 'pending') < ? OR ((status = 'pending') = ? AND (created_at < ? OR (created_at = ? AND id < ?))))" : ""} ORDER BY (status = 'pending') DESC, created_at DESC, id DESC LIMIT 100`
      )
      .bind(
        request.organizationId,
        ...(reviewer ? [] : [input.userId]),
        ...(request.before
          ? [
              Number(request.before.pending),
              Number(request.before.pending),
              request.before.createdAt,
              request.before.createdAt,
              request.before.id,
            ]
          : [])
      )
      .all<OrganizationJoinRequest>();
    const members = rows.results.length
      ? await resolveOrganizationDirectoryMembers({
          authWorker: env.OPENMELD_AUTH_WORKER,
          organizationId: request.organizationId,
        })
      : [];
    const names = new Map(
      members.map((entry) => [entry.userId, entry.user.name])
    );
    const spaceIds = rows.results.flatMap((row) =>
      row.spaceId ? [row.spaceId] : []
    );
    const spaces = spaceIds.length
      ? await db
          .prepare(
            "SELECT space_id AS id, space_name AS name FROM space_index_spaces WHERE organization_id = ? AND space_id IN (SELECT value FROM json_each(?))"
          )
          .bind(request.organizationId, JSON.stringify(spaceIds))
          .all<{ id: string; name: string }>()
      : null;
    const spaceNames = new Map(
      spaces?.results.map((space) => [space.id, space.name])
    );
    return {
      ok: true,
      requests: rows.results.map((row) => ({
        ...row,
        canReview: reviewer,
        requestedByName: names.get(row.requestedByUserId),
        spaceName: row.spaceId ? (spaceNames.get(row.spaceId) ?? null) : null,
        reviewedByName: row.reviewedByUserId
          ? (names.get(row.reviewedByUserId) ?? null)
          : null,
      })),
    };
  }
  return createRequest(env, db, input, request, member.role, sponsorUserId);
}

async function createRequest(
  env: CoreBindings,
  db: D1Database,
  input: OrganizationJoinRequestRpcInput,
  request: Extract<
    OrganizationJoinRequestRpcInput["request"],
    { action: "create" | "create_from_link" }
  >,
  role: string,
  sponsorUserId: string
): Promise<OrganizationJoinRequestResponse> {
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
  if (request.action === "create_from_link") {
    const existing = await db
      .prepare(
        `${SELECT} WHERE organization_id = ? AND coalesce(space_id, '') = ? AND applicant_user_id = ? AND email = ? AND status IN ('pending', 'approved') AND joined_at IS NULL ORDER BY created_at DESC LIMIT 1`
      )
      .bind(request.organizationId, request.spaceId ?? "", input.userId, email)
      .first<OrganizationJoinRequest>();
    if (existing) {
      if (existing.status === "pending") {
        await projectReview(env, db, existing);
      }
      return { ok: true, requests: [{ ...existing, canReview: false }] };
    }
  }
  await db
    .prepare(`INSERT INTO organization_join_requests
    (id, organization_id, space_id, requested_by_user_id, email, status, created_at, applicant_user_id)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT DO NOTHING`)
    .bind(
      crypto.randomUUID(),
      request.organizationId,
      request.spaceId ?? null,
      sponsorUserId,
      email,
      Date.now(),
      request.action === "create_from_link" &&
        input.responseVersion !== undefined
        ? input.userId
        : null
    )
    .run();
  if (
    request.action === "create_from_link" &&
    input.responseVersion !== undefined
  ) {
    // The verified recipient has now explicitly asked to join, even if a
    // teammate had already submitted an email invitation for them.
    await db
      .prepare(
        "UPDATE organization_join_requests SET applicant_user_id = ? WHERE organization_id = ? AND coalesce(space_id, '') = ? AND email = ? AND status = 'pending' AND applicant_user_id IS NULL"
      )
      .bind(input.userId, request.organizationId, request.spaceId ?? "", email)
      .run();
  }
  const row = await db
    .prepare(
      `${SELECT} WHERE organization_id = ? AND coalesce(space_id, '') = ? AND email = ? AND status = 'pending'`
    )
    .bind(request.organizationId, request.spaceId ?? "", email)
    .first<OrganizationJoinRequest>();
  if (!row) {
    throw new Error("Join request could not be saved");
  }
  if (
    request.action !== "create_from_link" &&
    row.requestedByUserId !== sponsorUserId &&
    !canReview(role)
  ) {
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
        canReview: request.action !== "create_from_link" && canReview(role),
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
  if (
    request.action === "delivery_complete" ||
    request.action === "join_complete"
  ) {
    if (!(reviewer && row.status === "approved")) {
      deny(
        "Only an organization owner or admin can complete an approved request."
      );
    }
    if (request.action === "join_complete") {
      await requireApplicantMembership(env, row);
    }
    return await completeDelivery(db, row, request.action === "join_complete");
  }
  if (request.action === "get") {
    if (!(reviewer || requester || input.email.toLowerCase() === row.email)) {
      deny("This request belongs to another account.");
    }
    return await viewRequest(env, db, row, reviewer);
  }
  if (request.action === "cancel" ? !requester : !reviewer) {
    deny(
      "Only an organization owner or admin can review this request. The sender can cancel it."
    );
  }
  return await decideRequest(
    env,
    db,
    input.userId,
    row,
    request.action,
    input.responseVersion === "3"
  );
}

async function requireApplicantMembership(
  env: CoreBindings,
  row: OrganizationJoinRequest
) {
  if (!row.applicantUserId) {
    deny("This request requires an email invitation.");
  }
  const joined = await resolveOrganizationMembershipById({
    env,
    organizationId: row.organizationId,
    userId: row.applicantUserId,
  });
  if (!joined.ok) {
    deny("The applicant has not joined the organization yet.");
  }
}

async function decideRequest(
  env: CoreBindings,
  db: D1Database,
  userId: string,
  row: OrganizationJoinRequest,
  action: "approve" | "reject" | "cancel" | "retry",
  requireNewDecision = false
): Promise<OrganizationJoinRequestResponse> {
  const status = (
    {
      approve: "approved",
      retry: "approved",
      reject: "rejected",
      cancel: "cancelled",
    } as const
  )[action];
  assertDecisionAllowed(row.status, status, action, requireNewDecision);
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
  const decision = await db
    .prepare(
      `UPDATE organization_join_requests SET status = ?, reviewed_by_user_id = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`
    )
    .bind(status, userId, Date.now(), row.id)
    .run();
  if (requireNewDecision && action !== "retry" && decision.meta.changes === 0) {
    throw new JoinRequestError(
      "organization.join_request.already_reviewed",
      "Another person handled this request. Refresh to see the result."
    );
  }
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
  if (
    current.status === "approved" &&
    !current.spaceId &&
    !current.applicantUserId &&
    current.joinedAt == null &&
    current.invitationSentAt == null
  ) {
    const identity = await readOrganizationAccountIdentityProjection({
      authWorker: env.OPENMELD_AUTH_WORKER,
      organizationId: current.organizationId,
      account: { kind: "email", email: current.email },
    });
    if (!identity?.ok) {
      throw new Error("Invitation recipient identity is unavailable");
    }
    // An email request does not imply consent to add membership. Here Auth
    // confirms membership already exists; no invitation or access grant remains.
    if (identity.account?.membership) {
      return completeDelivery(db, current, true);
    }
  }
  if (
    current.status !== "approved" ||
    current.invitationSentAt !== null ||
    current.joinedAt != null
  ) {
    await resolveInboxItemsBySource({
      db,
      organizationId: row.organizationId,
      resolvedAtMs: current.reviewedAt ?? Date.now(),
      sourceKey: `invitation:${row.id}`,
      sourceKind: "organization_member_request",
    });
  }
  await reconcileInvitationInbox(db, row.organizationId);
  return { ok: true, requests: [current] };
}

function assertDecisionAllowed(
  current: OrganizationJoinRequest["status"],
  next: OrganizationJoinRequest["status"],
  action: "approve" | "reject" | "cancel" | "retry",
  requireNewDecision: boolean
) {
  if (
    (action === "retry" && current !== "approved") ||
    (requireNewDecision && action !== "retry" && current !== "pending") ||
    (current !== "pending" && current !== next)
  ) {
    throw new JoinRequestError(
      "organization.join_request.already_reviewed",
      "This request has already been handled. Refresh to see the result."
    );
  }
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
    const existing = await readInboxItemBySource({
      db,
      organizationId: request.organizationId,
      recipientUserId: member.userId,
      sourceKind: "organization_member_request",
      sourceKey: `invitation:${request.id}`,
    });
    if (existing) {
      continue;
    }
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
        title: `Invite ${request.email}`,
        preview: "Review this request to invite a member.",
        contextLabel: null,
        occurredAtMs: request.createdAt,
      },
    });
  }
  await reconcileInvitationInbox(db, request.organizationId);
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
  const reviewerIdentity =
    reviewer && row.reviewedByUserId
      ? await readOrganizationAccountIdentityProjection({
          authWorker: env.OPENMELD_AUTH_WORKER,
          organizationId: row.organizationId,
          account: { kind: "user_id", userId: row.reviewedByUserId },
        })
      : null;
  return {
    ok: true,
    requests: [
      {
        ...row,
        canReview: reviewer,
        organizationName: identity.organization.name,
        requestedByName: identity.account?.displayName,
        reviewedByName: reviewerIdentity?.ok
          ? (reviewerIdentity.account?.displayName ?? null)
          : null,
        spaceName: space?.space_name ?? null,
      },
    ],
  };
}

async function completeDelivery(
  db: D1Database,
  row: OrganizationJoinRequest,
  joined = false
): Promise<OrganizationJoinRequestResponse> {
  const sentAt = (joined ? row.joinedAt : row.invitationSentAt) ?? Date.now();
  await db
    .prepare(
      joined
        ? "UPDATE organization_join_requests SET joined_at = coalesce(joined_at, ?) WHERE id = ? AND status = 'approved'"
        : "UPDATE organization_join_requests SET invitation_sent_at = coalesce(invitation_sent_at, ?) WHERE id = ? AND status = 'approved'"
    )
    .bind(sentAt, row.id)
    .run();
  const completed = await db
    .prepare(`${SELECT} WHERE id = ?`)
    .bind(row.id)
    .first<OrganizationJoinRequest>();
  if (!completed) {
    throw new Error("Completed invitation request disappeared");
  }
  await resolveInboxItemsBySource({
    db,
    organizationId: row.organizationId,
    resolvedAtMs:
      (joined ? completed.joinedAt : completed.invitationSentAt) ?? sentAt,
    sourceKey: `invitation:${row.id}`,
    sourceKind: "organization_member_request",
  });
  return {
    ok: true,
    requests: [completed],
  };
}
