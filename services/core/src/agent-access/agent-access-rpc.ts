import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  AGENT_ACCESS_REQUEST_LIST_LIMIT,
  type AgentAccessDecision,
  type DecideAgentAccessRequestResponse,
  decideAgentAccessRequestBodySchema,
  type GetAgentAccessRequestResponse,
  type ListAgentAccessRequestsQuery,
  type ListAgentAccessRequestsResponse,
  listAgentAccessRequestsQuerySchema,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  type WithdrawAgentAccessRequestResponse,
} from "@openmeld/schemas";
import { readResolvedOrganizationSpaceMember } from "../center-agent/center-agent-repository";
import type { CoreBindings } from "../lib/bindings";
import { isMemberAgentsEnabled } from "../member-agent/member-agents-feature";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  type CoreRpcContextInput,
  openDirectMessageSpaceInternal,
  requireActiveOrganizationMembershipOrThrow,
  requireHumanSpaceMemberFromContext,
  requireRpcContext,
  resolveRpcSpaceStubOrThrow,
} from "../rpc/methods";
import {
  type AgentAccessDecisionResult,
  decideAgentAccessRequest,
  finishAgentAccessDecision,
  readAgentAccessRequestView,
  readAgentAccessRequestViews,
  requireAgentAccessRequestViewer,
  withdrawAgentAccessRequest,
} from "./application/agent-access-service";
import {
  type AgentAccessRequestRecord,
  asQueryable,
  listAgentAccessRequests,
  readAgentAccessRequest,
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
  return {
    organizationId: caller.organizationId,
    requests: await readAgentAccessRequestViews({
      db: caller.db,
      requests,
      viewerUserId: caller.userId,
    }),
  };
}

export async function rpcGetAgentAccessRequest(
  env: CoreBindings,
  input: { context?: CoreRpcContextInput; requestId: string }
): Promise<GetAgentAccessRequestResponse> {
  const caller = await requireAgentAccessCaller(env, input.context);
  const request = requireAgentAccessRequestViewer({
    organizationId: caller.organizationId,
    request: await readAgentAccessRequest({
      db: asQueryable(caller.db),
      requestId: input.requestId,
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
  const directMessageSpaceId =
    applied.status === "replied_by_dm"
      ? await openReplyDirectMessage(env, caller, applied)
      : undefined;
  return {
    request: await readAgentAccessRequestView({
      db: caller.db,
      request: applied,
      viewerUserId: caller.userId,
    }),
    ...(directMessageSpaceId ? { directMessageSpaceId } : {}),
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

async function requireRequestedAgentMember(
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
  return member;
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
  const { outcome } = await stub.rpcApplyAgentAccessDecision({
    decidedByProfileId: caller.profileId,
    decidedByUserId: caller.userId,
    organizationId: request.organizationId,
    requestId: request.id,
    spaceId: request.spaceId,
    status: request.status,
    ...(agentMember ? { agentMember } : {}),
  });
  return await finishAgentAccessDecision({
    db: caller.db,
    nowMs: Date.now(),
    outcome,
    request,
  });
}

/** Reply by DM: the owner's Direct Message with the requester. */
async function openReplyDirectMessage(
  env: CoreBindings,
  caller: AgentAccessCaller,
  request: AgentAccessRequestRecord
): Promise<string> {
  const [member, targetMember] = await Promise.all([
    readResolvedOrganizationSpaceMember({
      db: caller.db,
      organizationId: caller.organizationId,
      profileId: caller.profileId,
    }),
    readResolvedOrganizationSpaceMember({
      db: caller.db,
      organizationId: caller.organizationId,
      profileId: request.requesterProfileId,
    }),
  ]);
  if (!(member && targetMember)) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "agent_access.requester_unavailable",
      reason: "The person who asked is no longer in this organization.",
    });
  }
  const opened = await openDirectMessageSpaceInternal(env, {
    context: caller.context,
    member,
    organizationId: caller.organizationId,
    targetMember,
  });
  return opened.spaceId;
}
