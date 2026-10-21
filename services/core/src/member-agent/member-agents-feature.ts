import { MEMBER_AGENTS_ENABLED } from "@openmeld/schemas";

/**
 * Release gate for MemberAgent surfaces in Core (design-plans/member-agent-program.md).
 * Agent Direct Message Sessions beyond the Center Agent pair and the Session
 * operations check it; with the flag off, Core behaves as before.
 */
export function isMemberAgentsEnabled(): boolean {
  return MEMBER_AGENTS_ENABLED;
}

/**
 * Whether Core enforces the request chain: a Wake without a human root is
 * rejected, delegated re-entry and the depth cap reject, and sensitive
 * operations require an owner root. Core writes the chain regardless, so
 * work admitted before the gate opens already carries one.
 */
export function isRequestChainEnforced(): boolean {
  return isMemberAgentsEnabled();
}
