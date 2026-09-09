import { buildProfileDisplay } from "@openmeld/protocol";
import {
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  personalRemoteAgentSpaceToolRequestSchema,
  personalRemoteAgentSpaceToolResponseSchema,
} from "@openmeld/schemas";
import { buildCenterAgentContextMessageProjection } from "../../center-agent/application/center-agent-context-manifest-service";
import {
  type CoreBindings,
  identityDb,
  wakeEvidenceDb,
} from "../../lib/bindings";
import {
  rpcGetSpaceBoard,
  rpcGetSpaceMemberDirectory,
  rpcGetSpaceUpdates,
  rpcListSignals,
  rpcPostSignalOnceByClientMessageId,
} from "../../rpc/methods";
import {
  isFormalSpaceUpdateSignal,
  resolveFormalSpaceUpdateActorName,
  resolveFormalSpaceUpdateActorProfileId,
} from "../../space/rules/formal-space-update";
import { readRemoteAgentNativeDeliveryBySubmissionId } from "../infrastructure/d1/native-delivery-ledger-repo";
import { requirePersonalRemoteAgentBinding } from "./personal-remote-agent-binding";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "./remote-agent-conversation-continuity";

export async function runPersonalRemoteAgentSpaceTool(
  env: CoreBindings,
  value: unknown
) {
  const input = personalRemoteAgentSpaceToolRequestSchema.parse(value);
  const db = identityDb(env);
  if (!db) {
    throw new Error("remote_agent.identity_store_unavailable");
  }
  const evidenceDb = wakeEvidenceDb(env);
  if (!evidenceDb) {
    throw new Error("remote_agent.execution_store_unavailable");
  }
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: evidenceDb,
    submissionId: input.submissionId,
  });
  if (!delivery || delivery.status !== "accepted") {
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
      requestId: `personal-agent-tool:${input.submissionId}`,
      ...request.spaceDispatchContext,
    },
    agentControllerConversationId: input.submissionId,
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
  const activeRequester = await db
    .prepare(
      `SELECT p.profile_id FROM openmeld_profiles p JOIN members m ON m.user_id = p.owner_user_id AND m.organization_id = ? WHERE p.profile_id = ? AND p.status = 'active' LIMIT 1`
    )
    .bind(delivery.organizationId, request.author.profileId)
    .first();
  if (!activeRequester) {
    throw new Error("remote_agent.requester_membership_revoked");
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
  if (request.spaceDispatchContext.autoRelayDepth >= 6) {
    throw new Error("remote_agent.collaboration_limit_reached");
  }
  const operation = input.operation;
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
  });
  return personalRemoteAgentSpaceToolResponseSchema.parse({
    kind: "wake",
    signalId: signal.id,
    agentProfileId: target.profileId,
  });
}
