import { formatAgentProfileOwnerHarnessName } from "./member-agent-display-name";
import { useMemberAgentIndex } from "./use-member-agents";

/**
 * `Owner’s Harness` or `Owner’s Harness · Profile` for an agent Profile shown
 * as a message author, Space member, or popover title. Null while
 * MemberAgents are disabled and for Profiles outside the structure (Center
 * Agent, custom controllers), which keep their existing presentation. The
 * Profile's own name stays the mention target.
 */
export function useMemberAgentProfileDisplayName(input: {
	profileId: string;
	profileKind: string;
	profileName: string;
	agentControllerRef: string | null | undefined;
	ownerName: string | null | undefined;
}): string | null {
	const memberAgents = useMemberAgentIndex();
	if (!memberAgents.enabled || input.profileKind !== "agent") {
		return null;
	}
	return (
		memberAgents.index.byProfileId.get(input.profileId)?.profileDisplayName ??
		formatAgentProfileOwnerHarnessName({
			agentControllerRef: input.agentControllerRef,
			ownerName: input.ownerName,
			profileName: input.profileName,
		})
	);
}
