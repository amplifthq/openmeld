import type {
  AgentAccessGranteeKind,
  AgentAccessRequestKind,
} from "@openmeld/schemas";

/**
 * Whether a Wake of another member's Agent needs its owner's consent first
 * (design-plans/member-agent-program.md §4.6, "Three situations"). The root
 * requester decides it, never the immediate author, so a colleague's own
 * Agents inherit that colleague's grant.
 *
 * - The owner as root never asks.
 * - An identified external root is asked every time, in any Space.
 * - A Direct Message needs a standing grant or consent for this Session.
 * - In a group Space the Agent is already in, members do not ask.
 */
export type AgentAccessGateDecision =
  | { outcome: "allowed" }
  | { outcome: "hold"; kind: Exclude<AgentAccessRequestKind, "space_join"> };

export function decideAgentAccess(input: {
  directMessage: boolean;
  grants: { always: boolean; session: boolean };
  ownerUserId: string;
  root: { userId: string; kind: AgentAccessGranteeKind };
}): AgentAccessGateDecision {
  if (input.root.userId === input.ownerUserId) {
    return { outcome: "allowed" };
  }
  if (input.root.kind === "external") {
    return { outcome: "hold", kind: "external_message" };
  }
  if (!input.directMessage) {
    return { outcome: "allowed" };
  }
  return input.grants.always || input.grants.session
    ? { outcome: "allowed" }
    : { outcome: "hold", kind: "direct_message" };
}
