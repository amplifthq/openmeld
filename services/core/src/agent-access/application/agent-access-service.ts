import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type AgentAccessDecision,
  type AgentAccessRequestStatus,
  type AgentAccessRequestView,
  listAgentAccessDecisions,
  resolveAgentAccessDecisionStatus,
} from "@openmeld/schemas";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  type AgentAccessRequestGrantState,
  type AgentAccessRequestNames,
  type AgentAccessRequestRecord,
  type AgentProfileAccessGrantRecord,
  asQueryable,
  ensureStandingAgentProfileAccessGrant,
  insertAgentAccessRequest,
  insertAgentProfileAccessGrant,
  isOrganizationMember,
  listActiveAgentProfileAccessGrants,
  markAgentAccessRequestApplied,
  readAgentAccessRequest,
  readAgentAccessRequestGrants,
  readAgentAccessRequestNames,
  revokeSupersededOnceAgentAccessGrants,
  revokeVoidedRequestOnceGrants,
  transitionPendingAgentAccessRequest,
  voidUnappliedAgentAccessRequest,
} from "../infrastructure/postgresql/agent-access-repo";
import {
  projectAgentAccessRequestInboxItem,
  resolveAgentAccessRequestInboxItem,
} from "./agent-access-inbox";

const REQUEST_ID_PREFIX = "aar_";

/**
 * Deterministic for a held message, so a Space retrying its outbox writes
 * the same request.
 */
export async function buildHeldAgentAccessRequestId(input: {
  spaceId: string;
  sourceSignalId: string;
  agentProfileId: string;
}): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${input.spaceId}\u0000${input.sourceSignalId}\u0000${input.agentProfileId}`
    )
  );
  return `${REQUEST_ID_PREFIX}${[...new Uint8Array(digest)]
    .slice(0, 20)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function buildAddMemberAgentAccessRequestId(): string {
  return `${REQUEST_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Stores a request and asks its owner, once. Idempotent per request id. */
export async function recordAgentAccessRequest(input: {
  db: PostgresDatabase;
  nowMs: number;
  request: Parameters<typeof insertAgentAccessRequest>[0]["request"];
}): Promise<AgentAccessRequestRecord> {
  const stored = await insertAgentAccessRequest({
    db: asQueryable(input.db),
    request: input.request,
  });
  const names = await readNames(input.db, stored);
  await projectAgentAccessRequestInboxItem({
    db: input.db,
    names,
    nowMs: input.nowMs,
    request: stored,
  });
  return stored;
}

export type AgentAccessDecisionResult = {
  request: AgentAccessRequestRecord;
  /** True when this call moved the request out of pending. */
  transitioned: boolean;
};

/**
 * The owner's decision, from `pending` only. Only the Agent owner decides;
 * external users are never always allowed. Grants are written in the same
 * transaction as the decision, which is stored and never changes. Retrying
 * the same decision returns the stored one so the Space can apply it.
 */
export async function decideAgentAccessRequest(input: {
  db: PostgresDatabase;
  decision: AgentAccessDecision;
  deciderUserId: string;
  nowMs: number;
  organizationId: string;
  requestId: string;
}): Promise<AgentAccessDecisionResult> {
  return await input.db.transaction(async (client) => {
    const db = asQueryable(client);
    const request = await readAgentAccessRequest({
      db,
      forUpdate: true,
      requestId: input.requestId,
    });
    assertRequestVisible(request, input.organizationId);
    const status = requireOwnerDecisionStatus({
      decision: input.decision,
      deciderUserId: input.deciderUserId,
      request,
    });
    if (request.status !== "pending") {
      // A retry of the same answer (a lost response, or a Space that did
      // not apply it yet) returns it so the Space can apply it again.
      if (request.decision === input.decision && request.status === status) {
        return { request, transitioned: false };
      }
      throw requestClosedError(request);
    }
    const decided = await transitionPendingAgentAccessRequest({
      db,
      decision: input.decision,
      decidedByUserId: input.deciderUserId,
      nowMs: input.nowMs,
      requestId: request.id,
      status,
    });
    if (!decided) {
      throw requestClosedError(request);
    }
    if (input.decision === "always_allow" || input.decision === "allow_once") {
      await insertAgentProfileAccessGrant({
        db,
        grant: buildDecisionGrant({
          decision: input.decision,
          deciderUserId: input.deciderUserId,
          nowMs: input.nowMs,
          request,
        }),
      });
    }
    return { request: decided, transitioned: true };
  });
}

function requireOwnerDecisionStatus(input: {
  decision: AgentAccessDecision;
  deciderUserId: string;
  request: AgentAccessRequestRecord;
}): Exclude<AgentAccessRequestStatus, "pending"> {
  const { request } = input;
  if (request.ownerUserId !== input.deciderUserId) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "agent_access.owner_required",
      reason: "Only the Agent's owner can answer this request.",
    });
  }
  if (!listAgentAccessDecisions(request).includes(input.decision)) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "agent_access.decision_unavailable",
      reason:
        request.requesterKind === "external"
          ? "People outside your organization can only be allowed once."
          : "That choice isn't available for this request.",
    });
  }
  const status = resolveAgentAccessDecisionStatus(input.decision);
  if (status === "pending") {
    throw new Error("A decision cannot leave a request pending.");
  }
  return status;
}

function buildDecisionGrant(input: {
  decision: "always_allow" | "allow_once";
  deciderUserId: string;
  nowMs: number;
  request: AgentAccessRequestRecord;
}): Parameters<typeof insertAgentProfileAccessGrant>[0]["grant"] {
  const { request } = input;
  const once = input.decision === "allow_once";
  return {
    id: `apg_${crypto.randomUUID().replaceAll("-", "")}`,
    organizationId: request.organizationId,
    profileId: request.agentProfileId,
    granteeUserId: request.requesterUserId,
    granteeKind: request.requesterKind,
    scope: once ? "once" : "always",
    requestId: request.id,
    // `once` covers this Session (Direct Message) or this one message.
    spaceId: once ? request.spaceId : null,
    sourceSignalId:
      once && request.kind === "external_message"
        ? request.sourceSignalId
        : null,
    grantedByUserId: input.deciderUserId,
    grantedAtMs: input.nowMs,
  };
}

/**
 * The owner always allows a member of the Organization, for example after
 * Allow once. A new standing grant with its own lifecycle that retires the
 * member's one-chat grants for the Profile, so removing it later removes
 * access in every chat; no request's decision changes. The caller has checked that `ownerUserId` owns the
 * Profile. Idempotent while a standing grant is active.
 */
export async function alwaysAllowAgentProfileMember(input: {
  db: PostgresDatabase;
  granteeUserId: string;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  profileId: string;
}): Promise<{ grant: AgentProfileAccessGrantRecord; created: boolean }> {
  if (input.granteeUserId === input.ownerUserId) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "agent_access.grantee_is_owner",
      reason: "You already own this Agent.",
    });
  }
  const db = asQueryable(input.db);
  if (
    !(await isOrganizationMember({
      db,
      organizationId: input.organizationId,
      userId: input.granteeUserId,
    }))
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "agent_access.decision_unavailable",
      reason: "People outside your organization can only be allowed once.",
    });
  }
  return await input.db.transaction(async (client) => {
    const tx = asQueryable(client);
    const ensured = await ensureStandingAgentProfileAccessGrant({
      db: tx,
      grant: {
        id: `apg_${crypto.randomUUID().replaceAll("-", "")}`,
        organizationId: input.organizationId,
        profileId: input.profileId,
        granteeUserId: input.granteeUserId,
        grantedByUserId: input.ownerUserId,
        grantedAtMs: input.nowMs,
      },
    });
    await revokeSupersededOnceAgentAccessGrants({
      db: tx,
      granteeUserId: input.granteeUserId,
      nowMs: input.nowMs,
      profileId: input.profileId,
      revokedByUserId: input.ownerUserId,
    });
    return ensured;
  });
}

/**
 * Records what the Space did with a decision: applied (the item closes
 * everywhere) or voided because its message changed or is gone.
 */
/**
 * Whether an allowed request may still release its held message: its own
 * grant is active, or the requester holds an active standing grant (an
 * upgrade retires the one-chat grant). A grant revoked before a lost Space
 * call is replayed must not start the task.
 */
export async function isAgentAccessRequestStillGranted(input: {
  db: PostgresDatabase;
  request: AgentAccessRequestRecord;
}): Promise<boolean> {
  const db = asQueryable(input.db);
  const own = (
    await readAgentAccessRequestGrants({ db, requestIds: [input.request.id] })
  ).get(input.request.id);
  if (own && own.revokedAtMs === null) {
    return true;
  }
  const standing = await listActiveAgentProfileAccessGrants({
    db,
    granteeUserId: input.request.requesterUserId,
    limit: 1,
    profileId: input.request.agentProfileId,
    scope: "always",
  });
  return standing.length > 0;
}

export async function finishAgentAccessDecision(input: {
  db: PostgresDatabase;
  nowMs: number;
  outcome: "applied" | "voided" | "closed";
  request: AgentAccessRequestRecord;
}): Promise<AgentAccessRequestRecord> {
  const { request } = input;
  if (input.outcome === "voided") {
    await voidAgentAccessRequest({
      db: input.db,
      nowMs: input.nowMs,
      requestId: request.id,
    });
  } else {
    await markAgentAccessRequestApplied({
      db: asQueryable(input.db),
      nowMs: input.nowMs,
      requestId: request.id,
    });
    await resolveAgentAccessRequestInboxItem({
      db: input.db,
      nowMs: input.nowMs,
      request,
    });
  }
  return (
    (await readAgentAccessRequest({
      db: asQueryable(input.db),
      requestId: request.id,
    })) ?? request
  );
}

/** The requester takes back a pending request. */
export async function withdrawAgentAccessRequest(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  requestId: string;
  requesterUserId: string;
}): Promise<AgentAccessDecisionResult> {
  const request = await readAgentAccessRequest({
    db: asQueryable(input.db),
    requestId: input.requestId,
  });
  assertRequestVisible(request, input.organizationId);
  if (request.requesterUserId !== input.requesterUserId) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "agent_access.requester_required",
      reason: "Only the person who asked can withdraw this request.",
    });
  }
  if (request.status === "withdrawn") {
    return { request, transitioned: false };
  }
  const withdrawn = await transitionPendingAgentAccessRequest({
    db: asQueryable(input.db),
    decision: null,
    decidedByUserId: input.requesterUserId,
    nowMs: input.nowMs,
    requestId: request.id,
    status: "withdrawn",
  });
  if (!withdrawn) {
    throw requestClosedError(request);
  }
  await resolveAgentAccessRequestInboxItem({
    db: input.db,
    nowMs: input.nowMs,
    request: withdrawn,
  });
  return { request: withdrawn, transitioned: true };
}

/** The bound message changed or is gone: the request can never apply. */
export async function voidAgentAccessRequest(input: {
  db: PostgresDatabase;
  nowMs: number;
  requestId: string;
}): Promise<AgentAccessRequestRecord | null> {
  const voided = await voidUnappliedAgentAccessRequest({
    db: asQueryable(input.db),
    nowMs: input.nowMs,
    requestId: input.requestId,
  });
  await revokeVoidedRequestOnceGrants({
    db: asQueryable(input.db),
    nowMs: input.nowMs,
    requestId: input.requestId,
  });
  const current =
    voided ??
    (await readAgentAccessRequest({
      db: asQueryable(input.db),
      requestId: input.requestId,
    }));
  if (current) {
    await resolveAgentAccessRequestInboxItem({
      db: input.db,
      nowMs: input.nowMs,
      request: current,
    });
  }
  return voided;
}

export async function readAgentAccessRequestView(input: {
  db: PostgresDatabase;
  request: AgentAccessRequestRecord;
  viewerUserId: string;
}): Promise<AgentAccessRequestView> {
  const [view] = await readAgentAccessRequestViews({
    db: input.db,
    requests: [input.request],
    viewerUserId: input.viewerUserId,
  });
  if (!view) {
    throw new Error("agent_access.request_view_missing");
  }
  return view;
}

export async function readAgentAccessRequestViews(input: {
  db: PostgresDatabase;
  requests: readonly AgentAccessRequestRecord[];
  viewerUserId: string;
}): Promise<AgentAccessRequestView[]> {
  const [names, grants] = await Promise.all([
    readAgentAccessRequestNames({
      db: asQueryable(input.db),
      requests: input.requests,
    }),
    readAgentAccessRequestGrants({
      db: asQueryable(input.db),
      requestIds: input.requests.map((request) => request.id),
    }),
  ]);
  return input.requests.map((request) =>
    toAgentAccessRequestView({
      grant: grants.get(request.id) ?? null,
      names: names.get(request.id) ?? FALLBACK_NAMES,
      request,
      viewerUserId: input.viewerUserId,
    })
  );
}

const FALLBACK_NAMES: AgentAccessRequestNames = {
  agentProfileName: "Agent",
  ownerName: "the owner",
  requesterName: "Someone",
};

export function toAgentAccessRequestView(input: {
  grant: AgentAccessRequestGrantState | null;
  names: AgentAccessRequestNames;
  request: AgentAccessRequestRecord;
  viewerUserId: string;
}): AgentAccessRequestView {
  const { names, request } = input;
  const viewerRole =
    request.ownerUserId === input.viewerUserId ? "owner" : "requester";
  return {
    id: request.id,
    kind: request.kind,
    status: request.status,
    decision: request.decision,
    grant: input.grant && {
      status: input.grant.revokedAtMs === null ? "active" : "revoked",
      revokedAt:
        input.grant.revokedAtMs === null
          ? null
          : new Date(input.grant.revokedAtMs).toISOString(),
    },
    spaceId: request.spaceId,
    sourceSignalId: request.sourceSignalId,
    agentProfileId: request.agentProfileId,
    agentProfileName: names.agentProfileName,
    ownerUserId: request.ownerUserId,
    ownerName: names.ownerName,
    requesterProfileId: request.requesterProfileId,
    requesterName: names.requesterName,
    requesterKind: request.requesterKind,
    createdAt: new Date(request.createdAtMs).toISOString(),
    decidedAt:
      request.decidedAtMs === null
        ? null
        : new Date(request.decidedAtMs).toISOString(),
    viewerRole,
    availableDecisions:
      viewerRole === "owner" && request.status === "pending"
        ? listAgentAccessDecisions(request)
        : [],
  };
}

/** Who may read a request: its owner and its requester, in its Organization. */
export function requireAgentAccessRequestViewer(input: {
  organizationId: string;
  request: AgentAccessRequestRecord | null;
  viewerUserId: string;
}): AgentAccessRequestRecord {
  const { request } = input;
  assertRequestVisible(request, input.organizationId);
  if (
    request.ownerUserId !== input.viewerUserId &&
    request.requesterUserId !== input.viewerUserId
  ) {
    throw requestNotFoundError();
  }
  return request;
}

function assertRequestVisible(
  request: AgentAccessRequestRecord | null,
  organizationId: string
): asserts request is AgentAccessRequestRecord {
  if (!request || request.organizationId !== organizationId) {
    throw requestNotFoundError();
  }
}

function requestNotFoundError() {
  return createCoreRpcHttpError({
    status: 404,
    code: "agent_access.request_not_found",
    reason: "This request is unavailable.",
  });
}

const CLOSED_REQUEST_REASONS: Partial<
  Record<AgentAccessRequestStatus, string>
> = {
  voided: "The message behind this request changed or was deleted.",
  withdrawn: "This request was withdrawn.",
};

function requestClosedError(request: AgentAccessRequestRecord) {
  return createCoreRpcHttpError({
    status: 409,
    code: "agent_access.request_closed",
    reason:
      CLOSED_REQUEST_REASONS[request.status] ??
      "This request was already answered.",
  });
}

async function readNames(
  db: PostgresDatabase,
  request: AgentAccessRequestRecord
): Promise<AgentAccessRequestNames> {
  const names = await readAgentAccessRequestNames({
    db: asQueryable(db),
    requests: [request],
  });
  return names.get(request.id) ?? FALLBACK_NAMES;
}
