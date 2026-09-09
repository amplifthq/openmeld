/**
 * Center retains its existing profile-owned Computer. Personal Agents have a
 * durable Computer per conversation: unrestricted shell access must not expose
 * files from their owner's DM to another Space.
 */
const AGENT_COMPUTER_NAME_PREFIX = "agent-computer:";

export function buildAgentComputerName(
  agentProfileId: string,
  personalSpaceId?: string
): string {
  const trimmed = agentProfileId.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "Agent computer requires a non-empty agent profile id for its durable name."
    );
  }
  if (personalSpaceId !== undefined) {
    const spaceId = personalSpaceId.trim();
    if (!spaceId) {
      throw new Error("Personal Agent computer requires its admitted Space.");
    }
    // A shell can traverse its entire filesystem. Separate durable workspaces,
    // rather than working-directory conventions, isolate DM and Space files.
    return `${AGENT_COMPUTER_NAME_PREFIX}${JSON.stringify([trimmed, spaceId])}`;
  }
  return `${AGENT_COMPUTER_NAME_PREFIX}${trimmed}`;
}
