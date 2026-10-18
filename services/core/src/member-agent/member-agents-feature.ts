import { MEMBER_AGENTS_ENABLED } from "@openmeld/schemas";

/**
 * Release gate for MemberAgent surfaces in Core (design-plans/member-agent-program.md).
 * Agent Direct Message Sessions beyond the Center Agent pair and the Session
 * operations check it; with the flag off, Core behaves as before.
 */
export function isMemberAgentsEnabled(): boolean {
  return MEMBER_AGENTS_ENABLED;
}
