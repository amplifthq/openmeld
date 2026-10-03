import {
  buildCenterAgentContextMessageProjection,
  buildProfileDisplay,
  buildSpaceMessageEvidence,
} from "@openmeld/protocol";
import {
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  personalRemoteAgentSpaceToolRequestSchema,
  personalRemoteAgentSpaceToolResponseSchema,
} from "@openmeld/schemas";
import {
  isCenterAgentDesignationActive,
  readCenterAgentDesignationRecord,
} from "../../center-agent/center-agent-repository";
import {
  type CoreBindings,
  identityDb,
  wakeEvidenceDb,
} from "../../lib/bindings";
import {
  rpcGetSpaceBoard,
  rpcGetSpaceMemberDirectory,
  rpcGetSpaceThread,
  rpcGetSpaceUpdates,
  rpcListSignals,
  rpcListSpaceThreadSignals,
  rpcPostSignalOnceByClientMessageId,
} from "../../rpc/methods";
import {
  isFormalSpaceUpdateSignal,
  resolveFormalSpaceUpdateActorName,
  resolveFormalSpaceUpdateActorProfileId,
} from "../../space/rules/formal-space-update";
import {
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import { isNativeDeliveryExecutingStatus } from "./native-delivery-execution-status";
import { requirePersonalRemoteAgentBinding } from "./personal-remote-agent-binding";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "./remote-agent-conversation-continuity";
import { resolveNativeDeliveryReplyPlacement } from "./reply-placement";

export async function requirePersonalRemoteAgentExecution(
  env: CoreBindings,
  submissionId: string,
  skillPreparationKey?: string
) {
  const db = identityDb(env);
  if (!db) {
    throw new Error("remote_agent.identity_store_unavailable");
  }
  const evidenceDb = wakeEvidenceDb(env);
  if (!evidenceDb) {
    throw new Error("remote_agent.execution_store_unavailable");
  }
  const delivery = skillPreparationKey
    ? await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: evidenceDb,
        idempotencyKey: skillPreparationKey,
      })
    : await readRemoteAgentNativeDeliveryBySubmissionId({
        db: evidenceDb,
        submissionId,
      });
  // Skill bytes are loaded before the worker acknowledgement reaches Core.
  // Only that read-only preparation path may use a durable submitted request.
  const preparingSkills =
    skillPreparationKey &&
    delivery?.status === "submitted" &&
    !delivery.submissionId;
  if (
    !delivery ||
    (!preparingSkills &&
      (!isNativeDeliveryExecutingStatus(delivery.status) ||
        delivery.submissionId !== submissionId))
  ) {
    throw new Error("remote_agent.execution_not_active");
  }
  resolveRemoteAgentNativeDeliveryRuntimeConversationId(delivery);
  const request =
    delivery.executionRecoverySubmitRequest ?? delivery.workerSubmitRequest;
  if (
    !request ||
    request.v !== 4 ||
    request.conversationIdentity?.kind !== "personal_agent" ||
    !request.agentProfileOwnerUserId ||
    !request.spaceDispatchContext
  ) {
    throw new Error("remote_agent.personal_execution_required");
  }
  const binding = await requirePersonalRemoteAgentBinding({
    db,
    agentProfileId: delivery.profileId,
    organizationId: delivery.organizationId,
    ownerUserId: request.agentProfileOwnerUserId,
  });
  if (binding.bindingId !== request.bindingId) {
    throw new Error("remote_agent.personal_binding_changed");
  }
  const context = {
    activeOrganizationId: delivery.organizationId,
    actorContext: {
      agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
      callerPrincipalId: request.agentProfileOwnerUserId,
      ownerUserId: request.agentProfileOwnerUserId,
      openMeldProfileId: delivery.profileId,
      profileKind: "agent" as const,
      requestId: `personal-agent-tool:${submissionId}`,
      ...request.spaceDispatchContext,
    },
    agentControllerConversationId: submissionId,
  };
  const directory = await rpcGetSpaceMemberDirectory(env, {
    context,
    spaceId: delivery.spaceId,
  });
  const agent = directory.members.find(
    (member) => member.profileId === delivery.profileId
  );
  const requester = directory.members.find(
    (member) => member.profileId === request.author.profileId
  );
  if (!(agent && requester)) {
    throw new Error("remote_agent.space_membership_revoked");
  }
  if (
    !(await isActiveRemoteAgentRequesterProfile({
      db,
      organizationId: delivery.organizationId,
      profileId: request.author.profileId,
    }))
  ) {
    throw new Error("remote_agent.requester_membership_revoked");
  }
  return {
    context,
    delivery,
    directory,
    request,
    db,
    agent,
    spaceDispatchContext: request.spaceDispatchContext,
  };
}

/**
 * The author of a Wake is the requester whose authority the Agent runs under.
 * It is either a Profile owned by an active member (a human, or a member's own
 * Agent), or the Organization's designated Center Agent. The Center Agent has
 * no owner: it delegates on behalf of the verified member who asked it to, and
 * Core already authorized that delegation before publishing the Wake.
 */
export async function isActiveRemoteAgentRequesterProfile(input: {
  db: D1Database;
  organizationId: string;
  profileId: string | null;
}): Promise<boolean> {
  if (!input.profileId) {
    return false;
  }
  const memberProfile = await input.db
    .prepare(
      `SELECT p.profile_id FROM openmeld_profiles p JOIN members m ON m.user_id = p.owner_user_id AND m.organization_id = ? WHERE p.profile_id = ? AND p.status = 'active' LIMIT 1`
    )
    .bind(input.organizationId, input.profileId)
    .first();
  if (memberProfile) {
    return true;
  }
  const designation = await readCenterAgentDesignationRecord({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (
    !designation ||
    designation.agentProfileId !== input.profileId ||
    !isCenterAgentDesignationActive(designation)
  ) {
    return false;
  }
  const centerAgentProfile = await input.db
    .prepare(
      `SELECT profile_id FROM openmeld_profiles WHERE profile_id = ? AND organization_id = ? AND status = 'active' AND profile_kind = 'agent' AND managed_role = 'center_agent' AND owner_user_id IS NULL LIMIT 1`
    )
    .bind(input.profileId, input.organizationId)
    .first();
  return Boolean(centerAgentProfile);
}

export async function runPersonalRemoteAgentSpaceTool(
  env: CoreBindings,
  value: unknown
) {
  const input = personalRemoteAgentSpaceToolRequestSchema.parse(value);
  const { context, delivery, directory, request, agent, spaceDispatchContext } =
    await requirePersonalRemoteAgentExecution(env, input.submissionId);
  if (input.operation.kind === "authorize") {
    return personalRemoteAgentSpaceToolResponseSchema.parse({
      kind: "authorize",
    });
  }
  if (input.operation.kind === "reply_placement") {
    const placement = await resolveNativeDeliveryReplyPlacement({
      env,
      delivery,
      lock: true,
      placement: input.operation.placement,
    });
    if (!placement) {
      throw new Error("remote_agent.reply_placement_unavailable");
    }
    return personalRemoteAgentSpaceToolResponseSchema.parse({
      kind: "reply_placement",
      placement,
    });
  }
  if (input.operation.kind === "board") {
    return personalRemoteAgentSpaceToolResponseSchema.parse({
      kind: "board",
      board: await rpcGetSpaceBoard(env, {
        context,
        spaceId: delivery.spaceId,
      }),
    });
  }
  if (input.operation.kind === "updates") {
    const updates = await rpcGetSpaceUpdates(env, {
      context,
      spaceId: delivery.spaceId,
      afterSignalId: input.operation.afterSignalId ?? delivery.triggerMessageId,
      limit: 20,
    });
    return personalRemoteAgentSpaceToolResponseSchema.parse({
      kind: "updates",
      signals: updates.signals
        .filter(isFormalSpaceUpdateSignal)
        .map((signal) => ({
          id: signal.id,
          profileId: resolveFormalSpaceUpdateActorProfileId(signal),
          profileName: resolveFormalSpaceUpdateActorName(signal),
          type: signal.type,
          text: (signal.data.text ?? "").slice(0, 4000),
          truncated: (signal.data.text?.length ?? 0) > 4000,
        })),
    });
  }
  if (input.operation.kind === "messages") {
    const page = await rpcListSignals(env, {
      context,
      spaceId: delivery.spaceId,
      recent: true,
      limit: 31,
      signalTypes: ["signal.text"],
    });
    const projection = await buildCenterAgentContextMessageProjection({
      hasOlderMessages: page.signals.length > 30,
      limit: 30,
      maxContextTokens: 8192,
      signals: page.signals,
      spaceId: delivery.spaceId,
    });
    return personalRemoteAgentSpaceToolResponseSchema.parse({
      kind: "messages",
      messages: projection.entries,
      truncated: projection.budget.truncated,
    });
  }
  if (input.operation.kind === "evidence") {
    const { sourceSignalId } = input.operation;
    const page = await rpcListSignals(env, {
      context,
      spaceId: delivery.spaceId,
      aroundSignalId: sourceSignalId,
      beforeCount: 0,
      afterCount: 0,
      signalTypes: ["signal.text"],
    });
    const signal = page.signals.find(
      (candidate) => candidate.id === sourceSignalId
    );
    if (!signal || signal.type !== "signal.text") {
      throw new Error(
        "space.evidence_unavailable: The requested message is unavailable."
      );
    }
    return personalRemoteAgentSpaceToolResponseSchema.parse({
      kind: "evidence",
      ...(await buildSpaceMessageEvidence({
        ...input.operation,
        signal,
        spaceId: delivery.spaceId,
      })),
    });
  }
  if (input.operation.kind === "thread") {
    return await readPersonalSpaceThread({
      env,
      context,
      spaceId: delivery.spaceId,
      operation: input.operation,
    });
  }
  if (input.operation.kind === "members") {
    return personalRemoteAgentSpaceToolResponseSchema.parse({
      kind: "members",
      members: directory.members.map((member) => ({
        profileId: member.profileId,
        displayName: member.displayName,
        canWake:
          member.allowedRelations.wake &&
          member.profileId !== delivery.profileId,
      })),
    });
  }
  if (spaceDispatchContext.autoRelayDepth >= 6) {
    throw new Error("remote_agent.collaboration_limit_reached");
  }
  const operation = input.operation;
  const placement = await resolveNativeDeliveryReplyPlacement({
    env,
    delivery,
    lock: false,
  });
  const target = directory.members.find(
    (member) => member.profileId === operation.agentProfileId
  );
  if (
    !target?.allowedRelations.wake ||
    target.profileId === delivery.profileId
  ) {
    throw new Error("remote_agent.wake_target_unavailable");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input))
  );
  const clientMessageId = `personal-agent:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const signal = await rpcPostSignalOnceByClientMessageId(env, {
    authoringPolicy: "user_authored",
    clientMessageId,
    context,
    messageEnvelope: {
      activationTargets: [target.profileId],
      referenceTargets: [],
      mentionTargets: [],
      text: input.operation.text,
    },
    meta: { clientMessageId },
    profile: buildProfileDisplay({
      profileId: agent.profileId,
      profileKind: "agent",
      profileName: agent.displayName,
      ownerUserId: request.agentProfileOwnerUserId,
      agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
    }),
    spaceId: delivery.spaceId,
    text: input.operation.text,
    ...(placement?.threadContext
      ? { threadContext: placement.threadContext }
      : {}),
  });
  return personalRemoteAgentSpaceToolResponseSchema.parse({
    kind: "wake",
    signalId: signal.id,
    agentProfileId: target.profileId,
  });
}

async function readPersonalSpaceThread(input: {
  env: CoreBindings;
  context: Awaited<
    ReturnType<typeof requirePersonalRemoteAgentExecution>
  >["context"];
  spaceId: string;
  operation: Extract<
    ReturnType<
      typeof personalRemoteAgentSpaceToolRequestSchema.parse
    >["operation"],
    { kind: "thread" }
  >;
}) {
  const { env, context, spaceId } = input;
  const { threadId, afterSignalId, limit = 20 } = input.operation;
  const thread = await rpcGetSpaceThread(env, { context, spaceId, threadId });
  const replies = await rpcListSpaceThreadSignals(env, {
    context,
    spaceId,
    threadId,
    afterSignalId: afterSignalId ?? thread.thread.rootSignalId,
    limit: limit + 1,
  });
  const candidates = [
    ...(!afterSignalId && thread.rootSignal ? [thread.rootSignal] : []),
    ...replies.signals,
  ];
  const page = candidates.slice(0, limit);
  const signals = page.filter(
    (signal) =>
      signal.type === "signal.text" &&
      signal.data.meta?.recalledAt === undefined
  );
  // The projection budgets newest-first. Reverse this forward page so budget
  // pressure cannot skip its first unread message and advance beyond it.
  const projection = await buildCenterAgentContextMessageProjection({
    hasOlderMessages: false,
    limit,
    maxContextTokens: 8192,
    signals: signals.toReversed(),
    spaceId,
  });
  const messages = projection.entries.toReversed();
  const budgetLimited = messages.length < signals.length;
  const more = candidates.length > limit || budgetLimited;
  const lastRead = budgetLimited
    ? messages.at(-1)?.sourceRef.id
    : page.at(-1)?.id;
  return personalRemoteAgentSpaceToolResponseSchema.parse({
    kind: "thread",
    threadId,
    messages,
    nextAfterSignalId: more ? (lastRead ?? null) : null,
    truncated: more || projection.budget.truncated,
  });
}
