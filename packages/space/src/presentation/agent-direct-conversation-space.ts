import { isDirectMessageSpace } from "./direct-message-space";

export type AgentDirectConversationSpaceStateInput = {
  activeMemberCount: number | null | undefined;
  agentMemberCount: number | null | undefined;
  directMessageConvertedAt?: string | null | undefined;
  humanMemberCount: number | null | undefined;
  purpose: string | null | undefined;
};

export function isAgentDirectConversationSpace(
  input: AgentDirectConversationSpaceStateInput
): boolean {
  if (!isOneHumanAgentConversation(input)) {
    return false;
  }

  return isDirectMessageSpace({
    activeMemberCount: input.activeMemberCount,
    directMessageConvertedAt: input.directMessageConvertedAt,
    purpose: input.purpose,
  });
}

export function isOneHumanAgentConversation(input: {
  activeMemberCount: number | null | undefined;
  humanMemberCount: number | null | undefined;
  agentMemberCount: number | null | undefined;
}): boolean {
  return (
    input.activeMemberCount === 2 &&
    input.humanMemberCount === 1 &&
    input.agentMemberCount === 1
  );
}
