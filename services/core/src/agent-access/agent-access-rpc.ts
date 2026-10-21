import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  AGENT_ACCESS_REQUEST_LIST_LIMIT,
  AGENT_PROFILE_ACCESS_GRANT_LIST_LIMIT,
  type AgentAccessDecision,
  type AgentProfileAccessGrantView,
  type CreateAgentProfileAccessGrantResponse,
  type CreateSpaceAgentRequestResponse,
  createAgentProfileAccessGrantBodySchema,
  createSpaceAgentRequestBodySchema,
  type DecideAgentAccessRequestResponse,
  decideAgentAccessRequestBodySchema,
  type GetAgentAccessRequestResponse,
  type ListAgentAccessRequestsQuery,
  type ListAgentAccessRequestsResponse,
  type ListAgentProfileAccessGrantsResponse,
  type ListViewerAgentAccessGrantsResponse,
  listAgentAccessRequestsQuerySchema,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  type RevokeAgentProfileAccessGrantResponse,
  type WithdrawAgentAccessRequestResponse,
} from "@openmeld/schemas";
import { publishAccountInvalidation } from "../account-invalidation/publish-account-invalidation";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { readResolvedOrganizationSpaceMember } from "../center-agent/center-agent-repository";
import type { CoreBindings } from "../lib/bindings";
import { isMemberAgentsEnabled } from "../member-agent/member-agents-feature";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  type CoreRpcContextInput,
  requireActiveOrganizationMembershipOrThrow,
  requireHumanSpaceMemberFromContext,
  requireRpcContext,
  resolveRpcSpaceStubOrThrow,
} from "../rpc/methods";
import {
  type AgentAccessDecisionResult,
  alwaysAllowAgentProfileMember,
  decideAgentAccessRequest,
  finishAgentAccessDecision,
  isAgentAccessRequestStillGranted,
  readAgentAccessRequestView,
  readAgentAccessRequestViews,
  requireAgentAccessRequestViewer,
  withdrawAgentAccessRequest,
} from "./application/agent-access-service";
import {
  type AgentAccessRequestRecord,
  type AgentProfileAccessGrantRecord,
  asQueryable,
  listActiveAgentProfileAccessGrants,
  listActiveAlwaysAgentAccessGrantsForGrantee,
  listAgentAccessRequests,
  listAgentAccessSpaceIds,
  readAgentAccessRequest,
  readAgentAccessTargets,
  revokeAgentProfileAccessGrant,
} from "./infrastructure/postgresql/agent-access-repo";

// Colleague use of an Agent (design-plans/member-agent-program.md §4.6, §7).
// Every write here is a sensitive operation (§6): the signed-in Web, App or
// CLI session is its own root, and only a Human caller may act.

type AgentAccessCaller = {
  context: CoreRpcContextInput;
  db: PostgresDatabase;
  organizationId: string;
  profileId: string;
  userId: string;
};

async function requireAgentAccessCaller(
  env: CoreBindings,
  rawContext: CoreRpcContextInput | undefined
): Promise<AgentAccessCaller> {
  if (!isMemberAgentsEnabled()) {
    throw createCoreRpcHttpError({
      status: 404,
      code: MEMBER_AGENTS_DISABLED_CODE,
      reason: MEMBER_AGENTS_DISABLED_MESSAGE,
    });
  }
  const context = requireRpcContext(rawContext);
  const activeOrganization = await requireActiveOrganizationMembershipOrThrow({
    context,
    env,
  });
  if (context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      status: 403,
      code: "agent_access.human_caller_required",
      reason: "Only a person can answer or change Agent access.",
    });
  }
  const human = requireHumanSpaceMemberFromContext({
    context,
    userId: activeOrganization.userId,
  });
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "agent_access.store_unavailable",
      reason: "Agent access is temporarily unavailable.",
    });
  }
  return {
    context,
    db,
    organizationId: activeOrganization.organizationId,
    profileId: human.profileId,
    userId: activeOrganization.userId,
  };
}

export async function rpcListAgentAccessRequests(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput; query?: ListAgentAccessRequestsQuery }
): Promise<ListAgentAccessRequestsResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  const query = listAgentAccessRequestsQuerySchema.safeParse(input.query ?? {});
  if (!query.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Provide a valid request filter.",
    });
  }
  const requests = await listAgentAccessRequests({
    db: asQueryable(caller.db),
    limit: AGENT_ACCESS_REQUEST_LIST_LIMIT,
    organizationId: caller.organizationId,
    pendingOnly: query.data.status === "pending",
    viewerUserId: caller.userId,
    ...(query.data.role ? { role: query.data.role } : {}),
    ...(query.data.spaceId ? { spaceId: query.data.spaceId } : {}),
  });
  const current = await repairUnappliedDecisions(env, caller, requests);
  return {
    organizationId: caller.organizationId,
    requests: await readAgentAccessRequestViews({
      db: caller.db,
      requests: current,
      viewerUserId: caller.userId,
    }),
  };
}

const REPAIR_AFTER_MS = 5000;
const REPAIR_LIMIT = 5;

/**
 * A decision Core recorded but its Space never applied (the Space call
 * failed) is applied again when the owner or the requester reads it, so a
 * lost call never leaves a message held or an observer in place. Only the
 * owner's own read adds an Agent, so the join keeps the owner's attribution.
 */
async function repairUnappliedDecisions(
  env: CoreBindings,
  caller: AgentAccessCaller,
  requests: readonly AgentAccessRequestRecord[]
): Promise<AgentAccessRequestRecord[]> {
  const nowMs = Date.now();
  const stale = requests
    .filter(
      (request) =>
        request.status !== "pending" &&
        request.status !== "voided" &&
        request.appliedAtMs === null &&
        request.decidedAtMs !== null &&
        nowMs - request.decidedAtMs > REPAIR_AFTER_MS &&
        (request.status !== "joined" || request.ownerUserId === caller.userId)
    )
    .slice(0, REPAIR_LIMIT);
  const repaired = new Map<string, AgentAccessRequestRecord>();
  for (const request of stale) {
    try {
      const agentMember =
        request.status === "joined"
          ? await requireRequestedAgentMember(caller, request)
          : undefined;
      repaired.set(
        request.id,
        await applyDecisionInSpace(
          env,
          caller,
          { request, transitioned: false },
          agentMember
        )
      );
    } catch (error) {
      console.warn("[core.agent_access.decision_repair_failed]", {
        error: error instanceof Error ? error.message : String(error),
        requestId: request.id,
      });
    }
  }
  return requests.map((request) => repaired.get(request.id) ?? request);
}

export async function rpcGetAgentAccessRequest(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput; requestId: string }
): Promise<GetAgentAccessRequestResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  const stored = requireAgentAccessRequestViewer({
    organizationId: caller.organizationId,
    request: await readAgentAccessRequest({
      db: asQueryable(caller.db),
      requestId: input.requestId,
    }),
    viewerUserId: caller.userId,
  });
  const [request = stored] = await repairUnappliedDecisions(env, caller, [
    stored,
  ]);
  return {
    request: await readAgentAccessRequestView({
      db: caller.db,
      request,
      viewerUserId: caller.userId,
    }),
  };
}

/**
 * The owner answers. Core records the decision (and any grant) first, then
 * the Space applies it; a retry of the same decision re-applies it.
 */
export async function rpcDecideAgentAccessRequest(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    decision: AgentAccessDecision;
    requestId: string;
  }
): Promise<DecideAgentAccessRequestResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  const body = decideAgentAccessRequestBodySchema.safeParse({
    decision: input.decision,
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Choose how to answer this request.",
    });
  }
  const decided = await decideAgentAccessRequest({
    db: caller.db,
    decision: body.data.decision,
    deciderUserId: caller.userId,
    nowMs: Date.now(),
    organizationId: caller.organizationId,
    requestId: input.requestId,
  });
  const agentMember =
    decided.request.status === "joined"
      ? await requireRequestedAgentMember(caller, decided.request)
      : undefined;
  const applied = await applyDecisionInSpace(env, caller, decided, agentMember);
  return {
    request: await readAgentAccessRequestView({
      db: caller.db,
      request: applied,
      viewerUserId: caller.userId,
    }),
  };
}

export async function rpcWithdrawAgentAccessRequest(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput; requestId: string }
): Promise<WithdrawAgentAccessRequestResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  const withdrawn = await withdrawAgentAccessRequest({
    db: caller.db,
    nowMs: Date.now(),
    organizationId: caller.organizationId,
    requestId: input.requestId,
    requesterUserId: caller.userId,
  });
  const applied = await applyDecisionInSpace(env, caller, withdrawn);
  return {
    request: await readAgentAccessRequestView({
      db: caller.db,
      request: applied,
      viewerUserId: caller.userId,
    }),
  };
}

/**
 * Asks the owner to let their Agent join a Space, bound to the caller's
 * message when they mentioned it. The owner adding their own Agent keeps the
 * existing atomic add.
 */
export async function rpcCreateSpaceAgentRequest(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    spaceId: string;
    agentProfileId: string;
    signalId?: string;
  }
): Promise<CreateSpaceAgentRequestResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  const body = createSpaceAgentRequestBodySchema.safeParse({
    agentProfileId: input.agentProfileId,
    ...(input.signalId === undefined ? {} : { signalId: input.signalId }),
  });
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Choose an Agent to ask for.",
    });
  }
  const target = (
    await readAgentAccessTargets({
      db: asQueryable(caller.db),
      organizationId: caller.organizationId,
      profileIds: [body.data.agentProfileId],
    })
  ).get(body.data.agentProfileId);
  if (!target) {
    throw createCoreRpcHttpError({
      status: 404,
      code: "agent_access.agent_not_found",
      reason: "That Agent is not available in this Organization.",
    });
  }
  if (target.ownerUserId === caller.userId) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "agent_access.own_agent",
      reason: "This is your Agent. Add it from Add members instead.",
    });
  }
  const { stub, spaceId } = resolveRpcSpaceStubOrThrow(env, input.spaceId);
  const { requestId } = await stub.rpcRequestAgentForSpace({
    context: caller.context,
    organizationId: caller.organizationId,
    requester: { profileId: caller.profileId, userId: caller.userId },
    spaceId,
    target: {
      memberAgentId: target.memberAgentId,
      ownerUserId: target.ownerUserId,
      profileId: target.profileId,
    },
    ...(body.data.signalId ? { signalId: body.data.signalId } : {}),
  });
  const request = requireAgentAccessRequestViewer({
    organizationId: caller.organizationId,
    request: await readAgentAccessRequest({
      db: asQueryable(caller.db),
      requestId,
    }),
    viewerUserId: caller.userId,
  });
  return {
    request: await readAgentAccessRequestView({
      db: caller.db,
      request,
      viewerUserId: caller.userId,
    }),
  };
}

export async function rpcListAgentProfileAccessGrants(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput; agentProfileId: string }
): Promise<ListAgentProfileAccessGrantsResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  await requireOwnedAgentProfile(caller, input.agentProfileId);
  const grants = await listActiveAgentProfileAccessGrants({
    db: asQueryable(caller.db),
    limit: AGENT_PROFILE_ACCESS_GRANT_LIST_LIMIT,
    profileId: input.agentProfileId,
  });
  return {
    profileId: input.agentProfileId,
    grants: grants.map(toAgentProfileAccessGrantView),
  };
}

function toAgentProfileAccessGrantView(
  grant: AgentProfileAccessGrantRecord
): AgentProfileAccessGrantView {
  return {
    id: grant.id,
    profileId: grant.profileId,
    granteeUserId: grant.granteeUserId,
    granteeName: grant.granteeName,
    granteeKind: grant.granteeKind,
    scope: grant.scope,
    grantedAt: new Date(grant.grantedAtMs).toISOString(),
  };
}

/**
 * The owner always allows a member, for example after Allow once. A new
 * standing grant with its own lifecycle; the request that led to it keeps
 * its decision. Idempotent while a standing grant is active.
 */
export async function rpcCreateAgentProfileAccessGrant(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    agentProfileId: string;
    body: unknown;
  }
): Promise<CreateAgentProfileAccessGrantResponse> {
  const body = createAgentProfileAccessGrantBodySchema.safeParse(input.body);
  if (!body.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Choose a teammate to always allow.",
    });
  }
  const caller = await requireAgentAccessCaller(env, input.context);
  await requireOwnedAgentProfile(caller, input.agentProfileId);
  const { granteeUserId } = body.data;
  const ensured = await alwaysAllowAgentProfileMember({
    db: caller.db,
    granteeUserId,
    nowMs: Date.now(),
    organizationId: caller.organizationId,
    ownerUserId: caller.userId,
    profileId: input.agentProfileId,
  });
  if (ensured.created) {
    await broadcastAgentAccessChanged(env, caller, {
      granteeUserId,
      profileId: input.agentProfileId,
    });
  }
  return {
    grant: toAgentProfileAccessGrantView(ensured.grant),
    created: ensured.created,
  };
}

/**
 * Open views of the Spaces where the grantee asked for this Agent refetch
 * their access. A refresh signal only: a failed broadcast never fails the
 * write, and each view reads Core again.
 */
async function broadcastAgentAccessChanged(
  env: CoreBindings,
  caller: AgentAccessCaller,
  input: { granteeUserId: string; profileId: string }
): Promise<void> {
  const spaceIds = await listAgentAccessSpaceIds({
    db: asQueryable(caller.db),
    profileId: input.profileId,
    requesterUserId: input.granteeUserId,
  });
  await Promise.all(
    spaceIds.map(async (spaceId) => {
      try {
        const { stub } = resolveRpcSpaceStubOrThrow(env, spaceId);
        await stub.rpcBroadcastAgentAccessChanged({ spaceId });
      } catch (error) {
        console.warn("[core.agent_access.broadcast_failed]", {
          error: error instanceof Error ? error.message : String(error),
          spaceId,
        });
      }
    })
  );
}

/**
 * The caller's own standing grants, so their clients can tell a colleague's
 * Agent they may use from one that asks its owner first. Only the grantee
 * reads these; the grant list itself stays owner-only.
 */
export async function rpcListViewerAgentAccessGrants(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput }
): Promise<ListViewerAgentAccessGrantsResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  const grants = await listActiveAlwaysAgentAccessGrantsForGrantee({
    db: asQueryable(caller.db),
    granteeUserId: caller.userId,
    limit: AGENT_PROFILE_ACCESS_GRANT_LIST_LIMIT,
    organizationId: caller.organizationId,
  });
  return {
    organizationId: caller.organizationId,
    grants: grants.map((grant) => ({
      profileId: grant.profileId,
      grantedAt: new Date(grant.grantedAtMs).toISOString(),
    })),
  };
}

/** Revoking blocks new tasks; tasks already running finish. */
export async function rpcRevokeAgentProfileAccessGrant(
  env: CoreBindings,
  input: {
    context?: CoreRpcContextInput;
    agentProfileId: string;
    grantId: string;
  }
): Promise<RevokeAgentProfileAccessGrantResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  await requireOwnedAgentProfile(caller, input.agentProfileId);
  const revoked = await revokeAgentProfileAccessGrant({
    db: asQueryable(caller.db),
    grantId: input.grantId,
    nowMs: Date.now(),
    profileId: input.agentProfileId,
    revokedByUserId: caller.userId,
  });
  if (!revoked) {
    throw createCoreRpcHttpError({
      status: 404,
      code: "agent_access.grant_not_found",
      reason: "This access was already removed.",
    });
  }
  await broadcastAgentAccessChanged(env, caller, {
    granteeUserId: revoked.granteeUserId,
    profileId: input.agentProfileId,
  });
  return {
    grantId: revoked.id,
    revokedAt: new Date(revoked.revokedAtMs).toISOString(),
  };
}

async function requireOwnedAgentProfile(
  caller: AgentAccessCaller,
  agentProfileId: string
): Promise<void> {
  const target = (
    await readAgentAccessTargets({
      db: asQueryable(caller.db),
      organizationId: caller.organizationId,
      profileIds: [agentProfileId],
    })
  ).get(agentProfileId);
  if (target?.ownerUserId !== caller.userId) {
    // Grants are owner-only (§4.10): never confirm another owner's Profile.
    throw createCoreRpcHttpError({
      status: 404,
      code: "agent_access.agent_not_found",
      reason: "That Agent is not available.",
    });
  }
}

/** The requested Agent as the Space will add it, harness included. */
export async function requireRequestedAgentMember(
  caller: AgentAccessCaller,
  request: AgentAccessRequestRecord
) {
  const member = await readResolvedOrganizationSpaceMember({
    db: caller.db,
    organizationId: caller.organizationId,
    profileId: request.agentProfileId,
  });
  if (member?.profileKind !== "agent") {
    throw createCoreRpcHttpError({
      status: 409,
      code: "agent_access.agent_unavailable",
      reason: "This Agent is no longer available.",
    });
  }
  return {
    ...member,
    agentControllerRef:
      (await readRequestedAgentControllerRef(caller, request)) ??
      member.agentControllerRef,
  };
}

/**
 * The requested Agent's harness, from its primary Binding. The Space releases
 * a held message by it: a harness without Sessions refuses an explicit new
 * one (smoke R2B-04, R5-02).
 */
async function readRequestedAgentControllerRef(
  caller: AgentAccessCaller,
  request: AgentAccessRequestRecord
): Promise<string | null> {
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: request.agentProfileId,
    db: caller.db,
    owner: { id: request.ownerUserId, kind: "owner_account" },
  });
  return binding?.agentControllerRef ?? null;
}

/**
 * Lets the Space apply a recorded decision. A Space that finds its message
 * changed voids the request instead, and the requester sees it voided.
 */
async function applyDecisionInSpace(
  env: CoreBindings,
  caller: AgentAccessCaller,
  decided: AgentAccessDecisionResult,
  agentMember?: Awaited<ReturnType<typeof requireRequestedAgentMember>>
): Promise<AgentAccessRequestRecord> {
  const { request } = decided;
  const { stub } = resolveRpcSpaceStubOrThrow(env, request.spaceId);
  // A replayed allow whose access was revoked since closes the hold instead,
  // so the held message never starts work after revocation.
  const accessRevoked =
    request.status === "allowed" &&
    !decided.transitioned &&
    !(await isAgentAccessRequestStillGranted({ db: caller.db, request }));
  const releases =
    (request.status === "allowed" && !accessRevoked) ||
    request.status === "joined";
  const targetControllerRef = releases
    ? (agentMember?.agentControllerRef ??
      (await readRequestedAgentControllerRef(caller, request)))
    : null;
  const { outcome } = await stub.rpcApplyAgentAccessDecision({
    decidedByProfileId: caller.profileId,
    decidedByUserId: caller.userId,
    organizationId: request.organizationId,
    requestId: request.id,
    spaceId: request.spaceId,
    status: request.status,
    ...(accessRevoked ? { accessRevoked } : {}),
    ...(agentMember ? { agentMember } : {}),
    ...(targetControllerRef ? { targetControllerRef } : {}),
  });
  const finished = await finishAgentAccessDecision({
    db: caller.db,
    nowMs: Date.now(),
    outcome,
    request,
  });
  // Both open Inboxes drop the answered request without a reload.
  await publishAccountInvalidation({
    env,
    frame: { type: "inbox.changed" },
    organizationId: request.organizationId,
    userIds: [request.ownerUserId, request.requesterUserId],
  });
  return finished;
}
