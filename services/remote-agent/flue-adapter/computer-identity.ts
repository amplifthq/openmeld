/**
 * Naming for the Center Agent's org-level computer.
 *
 * The computer is owned by the agent identity, not by the Space and not
 * by the organization record: one durable computer per Agent Profile.
 * Org-level uniqueness follows from the Center Agent being unique per
 * organization; a future second hosted agent gets its own computer
 * rather than sharing this one.
 */
const AGENT_COMPUTER_NAME_PREFIX = "agent-computer:";

export function buildAgentComputerName(agentProfileId: string): string {
  const trimmed = agentProfileId.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "Agent computer requires a non-empty agent profile id for its durable name."
    );
  }
  return `${AGENT_COMPUTER_NAME_PREFIX}${trimmed}`;
}
