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
    renderSpaceEntryBrief({
      whatThisSpaceIs:
        "A Space is the shared collaboration surface; an Agent Profile is an AI teammate identity. OpenMeld runs you remotely and publishes your final answer under your own identity.",
      youAre: buildSpaceAgentIdentityLine({
        targetProfileId: request.agentProfileId,
        targetProfileName: request.turnEnvelope.centerAgent.profileName,
      }),
      thisSpace: `${space.name} (${space.id}); ${space.kind}`,
      spaceGuide: space.guide,
      needMore:
        "Use openmeld_read_space_board for live members, working now, and recent outcomes; openmeld_read_space_messages for earlier conversation text; openmeld_read_space_updates for new public signals after the current Wake or a returned signal ID.",
    }),
    ...buildSpaceWakeParticipantLines({
      targetProfileId: request.agentProfileId,
      activationTargets: request.sourceMessageEnvelope?.activationTargets ?? [],
      sourceSignalId: request.triggerMessageId,
      readOutcomesInstruction: "use openmeld_read_space_updates",
    }),
  ].join("\n");
}
