import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
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
import { readInboxItemBySource } from "../inbox/infrastructure/postgresql/inbox-item-repo";
import type { CoreBindings } from "../lib/bindings";
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

const SELECT = `SELECT id, organization_id AS "organizationId", space_id AS "spaceId",
  requested_by_user_id AS "requestedByUserId", email, status,
  reviewed_by_user_id AS "reviewedByUserId", created_at AS "createdAt",
  reviewed_at AS "reviewedAt", invitation_sent_at AS "invitationSentAt",
  applicant_user_id AS "applicantUserId", joined_at AS "joinedAt" FROM "openmeld"."organization_join_requests"`;
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
  const db = getPostgresDatabase(env);
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
  db: PostgresDatabase,
  input: OrganizationJoinRequestRpcInput,
  request: Extract<
    OrganizationJoinRequestRpcInput["request"],
    {
      action: "create" | "list" | "summary" | "create_from_link";
    }
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
          .query<{
            total: number;
          }>({
            text: "SELECT count(*) AS total FROM \"openmeld\".\"organization_join_requests\" WHERE organization_id = $1 AND (status = 'pending' OR (status = 'approved' AND invitation_sent_at IS NULL AND joined_at IS NULL))",
            values: [request.organizationId],
          })
          .then((result) => result.rows[0] ?? null)
      : null;
    return { ok: true, requests: [], actionRequiredCount: count?.total ?? 0 };
  }
  if (request.action === "list") {
    const reviewer = canReview(member.role);
    const rows = await db.query<OrganizationJoinRequest>({
      text: `${SELECT} WHERE organization_id = $1
                  AND ($2::text IS NULL OR requested_by_user_id = $2)
                  AND ($3::boolean IS NULL OR ((status = 'pending'), created_at, id) < ($3::boolean, $4::bigint, $5::text))
                  ORDER BY (status = 'pending') DESC NULLS LAST, created_at DESC NULLS LAST, id DESC NULLS LAST LIMIT 100`,
      values: [
        request.organizationId,
        reviewer ? null : input.userId,
        request.before?.pending ?? null,
        request.before?.createdAt ?? null,
        request.before?.id ?? null,
      ],
    });
    const members = rows.rows.length
      ? await resolveOrganizationDirectoryMembers({
          authWorker: env.OPENMELD_AUTH_WORKER,
          organizationId: request.organizationId,
        })
      : [];
    const names = new Map(
      members.map((entry) => [entry.userId, entry.user.name])
    );
    const spaceIds = rows.rows.flatMap((row) =>
      row.spaceId ? [row.spaceId] : []
    );
    const spaces = spaceIds.length
      ? await db.query<{
          id: string;
          name: string;
        }>({
          text: 'SELECT space_id AS id, space_name AS name FROM "openmeld"."space_index_spaces" WHERE organization_id = $1 AND space_id IN (SELECT value FROM jsonb_array_elements_text($2::jsonb) AS json_elements(value))',
          values: [request.organizationId, JSON.stringify(spaceIds)],
        })
      : null;
    const spaceNames = new Map(
      spaces?.rows.map((space) => [space.id, space.name]) ?? []
    );
    return {
      ok: true,
      requests: rows.rows.map((row) => ({
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
  db: PostgresDatabase,
  input: OrganizationJoinRequestRpcInput,
  request: Extract<
    OrganizationJoinRequestRpcInput["request"],
    {
      action: "create" | "create_from_link";
    }
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
      .query<OrganizationJoinRequest>({
        text: `${SELECT} WHERE organization_id = $1 AND coalesce(space_id, '') = $2 AND applicant_user_id = $3 AND email = $4 AND status IN ('pending', 'approved') AND joined_at IS NULL ORDER BY created_at DESC NULLS LAST LIMIT 1`,
        values: [
          request.organizationId,
          request.spaceId ?? "",
          input.userId,
          email,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    if (existing) {
      if (existing.status === "pending") {
        await projectReview(env, db, existing);
      }
      return { ok: true, requests: [{ ...existing, canReview: false }] };
    }
  }
  await db.query({
    text: `INSERT INTO "openmeld"."organization_join_requests"
    (id, organization_id, space_id, requested_by_user_id, email, status, created_at, applicant_user_id)
    VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) ON CONFLICT DO NOTHING`,
    values: [
      crypto.randomUUID(),
      request.organizationId,
      request.spaceId ?? null,
      sponsorUserId,
      email,
      Date.now(),
      request.action === "create_from_link" &&
      input.responseVersion !== undefined
        ? input.userId
        : null,
    ],
  });
  if (
    request.action === "create_from_link" &&
    input.responseVersion !== undefined
  ) {
    // The verified recipient has now explicitly asked to join, even if a
    // teammate had already submitted an email invitation for them.
    await db.query({
      text: "UPDATE \"openmeld\".\"organization_join_requests\" SET applicant_user_id = $1 WHERE organization_id = $2 AND coalesce(space_id, '') = $3 AND email = $4 AND status = 'pending' AND applicant_user_id IS NULL",
      values: [
        input.userId,
        request.organizationId,
        request.spaceId ?? "",
        email,
      ],
    });
  }
  const row = await db
    .query<OrganizationJoinRequest>({
      text: `${SELECT} WHERE organization_id = $1 AND coalesce(space_id, '') = $2 AND email = $3 AND status = 'pending'`,
      values: [request.organizationId, request.spaceId ?? "", email],
    })
    .then((result) => result.rows[0] ?? null);
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
  db: PostgresDatabase,
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
    .query<OrganizationJoinRequest>({
      text: `${SELECT} WHERE id = $1`,
      values: [request.requestId],
    })
    .then((result) => result.rows[0] ?? null);
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
  db: PostgresDatabase,
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
  const decision = await db.query({
    text: `UPDATE "openmeld"."organization_join_requests" SET status = $1, reviewed_by_user_id = $2, reviewed_at = $3 WHERE id = $4 AND status = 'pending'`,
    values: [status, userId, Date.now(), row.id],
  });
  if (requireNewDecision && action !== "retry" && decision.rowCount === 0) {
    throw new JoinRequestError(
      "organization.join_request.already_reviewed",
      "Another person handled this request. Refresh to see the result."
    );
  }
  const current = await db
    .query<OrganizationJoinRequest>({
      text: `${SELECT} WHERE id = $1`,
      values: [row.id],
    })
    .then((result) => result.rows[0] ?? null);
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
  db: PostgresDatabase,
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
  db: PostgresDatabase,
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
        .query<{
          space_name: string;
        }>({
          text: 'SELECT space_name FROM "openmeld"."space_index_spaces" WHERE space_id = $1 AND organization_id = $2',
          values: [row.spaceId, row.organizationId],
        })
        .then((result) => result.rows[0] ?? null)
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
  db: PostgresDatabase,
  row: OrganizationJoinRequest,
  joined = false
): Promise<OrganizationJoinRequestResponse> {
  const sentAt = (joined ? row.joinedAt : row.invitationSentAt) ?? Date.now();
  await db.query({
    text: joined
      ? 'UPDATE "openmeld"."organization_join_requests" SET joined_at = coalesce(joined_at, $1) WHERE id = $2 AND status = \'approved\''
      : 'UPDATE "openmeld"."organization_join_requests" SET invitation_sent_at = coalesce(invitation_sent_at, $1) WHERE id = $2 AND status = \'approved\'',
    values: [sentAt, row.id],
  });
  const completed = await db
    .query<OrganizationJoinRequest>({
      text: `${SELECT} WHERE id = $1`,
      values: [row.id],
    })
    .then((result) => result.rows[0] ?? null);
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
