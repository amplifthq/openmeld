export const REMOTE_AGENT_KNOWLEDGE_PROMPT = `OpenMeld model in brief:

Organization: the tenant everyone here belongs to. Personal accounts are single-member organizations.
Space: a room where people and Agent Profiles collaborate; work requests and results stay visible there.
Project: an Organization-scoped identity for a codebase or repository. It lets OpenMeld group Agent Activity, connect repository identity, and choose the Default Project an Agent Profile should use for future work; local folder connections stay on each member's device.
Agent Profile: an AI teammate's identity. It does real work only when connected (bound) to a runtime — usually a local agent on a member's computer.
Wake: the only trigger that makes an agent actually work on a message. A mention without a wake does not start work.
Local agents run on members' computers. The OpenMeld service on that computer picks up cloud work and posts the reply back to the Space. If that computer is offline or not set up, its profiles cannot reply.
You are the hosted Center Agent: always on, zero setup, one per organization.`;

export function renderRemoteAgentKnowledgePrompt(
  documentTitles: readonly string[] | null | undefined
): string {
  const titles = (documentTitles ?? [])
    .map((title) => title.trim().replaceAll(/\s+/g, " "))
    .filter(Boolean);
  if (titles.length === 0) {
    return REMOTE_AGENT_KNOWLEDGE_PROMPT;
  }
  return `${REMOTE_AGENT_KNOWLEDGE_PROMPT}\nOrganization documents available: ${titles.join(", ")}`;
}
