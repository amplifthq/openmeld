import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type {
  CenterAgentToolSpeaker,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import {
  assertCoreOriginatedTurnContext,
  type RemoteAgentCallbackContext,
  type RemoteAgentReadableStorage,
  readRemoteAgentCallbackContext,
} from "./callback-context";

export async function buildRemoteAgentToolContext(input: {
  storage: RemoteAgentReadableStorage;
  submissionId: string;
  toolName: string;
}): Promise<{
  context: OpenMeldRequestContext;
  conversationId: RemoteAgentCallbackContext["conversationId"];
  modelRoute: RemoteAgentCallbackContext["modelRoute"];
  turnEnvelope: RemoteAgentCallbackContext["turnEnvelope"];
}> {
  const turnContext = await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
  assertCoreOriginatedTurnContext(turnContext);
  const context = buildRemoteAgentCoreContext(
    turnContext,
    ["remote-agent-tool", input.toolName, turnContext.submissionId].join(":")
  );
  return {
    context,
    conversationId: turnContext.conversationId,
    modelRoute: turnContext.modelRoute,
    turnEnvelope: turnContext.turnEnvelope,
  };
}

export function buildRemoteAgentCoreContext(
  turnContext: RemoteAgentCallbackContext,
  requestId: string
): OpenMeldRequestContext {
  assertCoreOriginatedTurnContext(turnContext);
  const personalAgent =
    turnContext.conversationIdentity?.kind === "personal_agent";
  if (personalAgent && !turnContext.agentProfileOwnerUserId) {
    throw new Error(
      "OpenMeld product tools require the Remote Agent submission owner context."
    );
  }
  return {
    activeOrganizationId: turnContext.organizationId,
    actorContext: {
      agentControllerRef:
        turnContext.conversationIdentity?.kind === "personal_agent"
          ? HOSTED_REMOTE_AGENT_CONTROLLER_REF
          : HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: personalAgent
        ? (turnContext.agentProfileOwnerUserId ?? undefined)
        : turnContext.agentProfileId,
      ...(personalAgent && turnContext.agentProfileOwnerUserId
        ? { ownerUserId: turnContext.agentProfileOwnerUserId }
        : {}),
      profileKind: "agent",
      requestId,
      openMeldProfileId: turnContext.agentProfileId,
    },
    agentControllerConversationId: turnContext.submissionId,
  };
}

export function resolveVerifiedTurnEnvelopeSpeaker(
  envelope: RemoteAgentCallbackContext["turnEnvelope"]
): { memberId: string; userId: string } | undefined {
  if (
    envelope?.sender.kind === "routine" &&
    envelope.sender.delegatedBy?.verified
  ) {
    return {
      memberId: envelope.sender.delegatedBy.id,
      userId: envelope.sender.delegatedBy.ownerUserId,
    };
  }
  if (
    envelope?.sender.kind !== "member" ||
    !envelope.sender.verified ||
    !envelope.sender.ownerUserId
  ) {
    return undefined;
  }
  return {
    memberId: envelope.sender.id,
    userId: envelope.sender.ownerUserId,
  };
}

export function resolveVerifiedTurnEnvelopeProfileId(
  envelope: RemoteAgentCallbackContext["turnEnvelope"]
): string | undefined {
  if (
    envelope?.sender.kind === "routine" &&
    envelope.sender.delegatedBy.verified
  ) {
    return envelope.sender.delegatedBy.profileId;
  }
  if (
    envelope?.sender.kind !== "member" ||
    !envelope.sender.verified ||
    !envelope.sender.ownerUserId
  ) {
    return undefined;
  }
  return envelope.sender.profileId;
}

export function resolveOrganizationMemberTurnEnvelopeSpeaker(
  envelope: RemoteAgentCallbackContext["turnEnvelope"]
): CenterAgentToolSpeaker | undefined {
  const verifiedSpeaker = resolveVerifiedTurnEnvelopeSpeaker(envelope);
  if (verifiedSpeaker) {
    return verifiedSpeaker;
  }
  if (
    envelope?.sender.kind !== "member" ||
    envelope.sender.verified ||
    !envelope.sender.messageChannelIdentity
  ) {
    return undefined;
  }
  return {
    displayName: envelope.sender.displayName,
    kind: "anonymous_member",
    messageChannelIdentity: envelope.sender.messageChannelIdentity,
  };
}
