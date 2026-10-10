import { isDirectMessageSpace } from "./direct-message-space";
import { OPENMELD_WELCOMING_SPACE_PURPOSE } from "./welcoming-space";

export type AutomaticWakeSpaceStateInput = {
  automaticWakeEnabled?: boolean;
  activeMemberCount: number | null | undefined;
  agentMemberCount: number | null | undefined;
  humanMemberCount: number | null | undefined;
  purpose: string | null | undefined;
  isThreadMessage?: boolean;
  directMessageConvertedAt?: string | null;
};

export function isAutomaticWakeSpace(
  input: AutomaticWakeSpaceStateInput
): boolean {
  return (
    input.automaticWakeEnabled !== false &&
    input.purpose !== OPENMELD_WELCOMING_SPACE_PURPOSE &&
    (!input.isThreadMessage || isDirectMessageSpace(input)) &&
    isOneHumanAgentConversation(input)
  );
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
