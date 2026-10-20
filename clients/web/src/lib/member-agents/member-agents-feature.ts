import { MEMBER_AGENTS_ENABLED } from "@openmeld/schemas";

/**
 * Release gate for every MemberAgent surface in Web
 * (design-plans/member-agent-program.md). With the flag off, Agents and
 * Direct Messages render exactly as before.
 */
export function isMemberAgentsEnabled(): boolean {
	return MEMBER_AGENTS_ENABLED;
}
