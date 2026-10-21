import { renderNonOwnerAudiencePathGuidance } from "@openmeld/agent-runtime";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import {
  buildSpaceAgentIdentityLine,
  buildSpaceWakeParticipantLines,
  renderSpaceEntryBrief,
} from "@openmeld/space-mesh";

/** Reuse Space context without importing the workstation's execution contract. */
export function renderPersonalRemoteAgentCollaborationContext(
  request: RemoteAgentWorkerSubmitTurnRequest
): string | null {
  if (
    request.v !== 4 ||
    request.conversationIdentity?.kind !== "personal_agent"
  ) {
    return null;
  }
  const space = request.turnEnvelope.space;
  return [
    `Source signal: ${request.triggerMessageId}`,
    `Requested by: ${request.author.displayName} (Profile ID: ${request.author.profileId}).`,
    ...(isRequestedByPersonalAgentOwner(request)
      ? []
      : [renderNonOwnerAudiencePathGuidance({})]),
    "Use openmeld_read_space_evidence for an exact source message and its sourceRef.version, and openmeld_read_space_thread for a bounded thread page. Follow the returned continuation without changing the source version. An unavailable version or revoked source is not permission to substitute newer content.",
    renderSpaceEntryBrief({
      whatThisSpaceIs:
        "A Space is the shared collaboration surface; an Agent Profile is an AI teammate identity. OpenMeld runs you remotely and publishes your final answer under your own identity.",
      youAre: buildSpaceAgentIdentityLine({
        targetProfileId: request.agentProfileId,
        targetProfileName: request.turnEnvelope.centerAgent.profileName,
      }),
      thisSpace: `${space.name} (${space.id}); ${space.kind}`,
      spaceGuide: space.guide,
      needMore: request.sourceMessageEnvelope
        ? "Use openmeld_read_space_board for live members, working now, and recent outcomes; openmeld_read_space_messages for earlier conversation text; openmeld_read_space_updates for new public signals after the current Wake or a returned signal ID."
        : "Use openmeld_read_space_messages for earlier conversation text and openmeld_read_space_members for teammate identities.",
    }),
    ...buildSpaceWakeParticipantLines({
      targetProfileId: request.agentProfileId,
      activationTargets: request.sourceMessageEnvelope?.activationTargets ?? [],
      sourceSignalId: request.triggerMessageId,
      readOutcomesInstruction: "use openmeld_read_space_updates",
    }),
  ].join("\n");
}

/**
 * Whether the Agent's owner, as Core verified on the turn envelope, asked for
 * this turn. Anyone else, or an unverified sender, gets the audience
 * guidance.
 */
function isRequestedByPersonalAgentOwner(
  request: RemoteAgentWorkerSubmitTurnRequest
): boolean {
  const owner = request.agentProfileOwnerUserId;
  const sender = request.turnEnvelope.sender;
  if (!owner) {
    return false;
  }
  if (sender.kind === "routine") {
    return (
      sender.delegatedBy.verified && sender.delegatedBy.ownerUserId === owner
    );
  }
  return (
    sender.kind === "member" && sender.verified && sender.ownerUserId === owner
  );
}
