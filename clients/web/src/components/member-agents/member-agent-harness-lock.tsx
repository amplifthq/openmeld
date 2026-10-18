import { createContext, type ReactNode, use } from "react";
import { useMemberAgentIndex } from "./use-member-agents";

const MemberAgentHarnessLockContext = createContext(false);

/**
 * Marks the Profile settings below as belonging to a MemberAgent. A Profile
 * cannot change harness, so the controller switcher is hidden; it stays only
 * for unassigned Profiles, where choosing a controller assigns them.
 */
export function MemberAgentHarnessLock(input: {
	profileId: string;
	children: ReactNode;
}) {
	const memberAgents = useMemberAgentIndex();
	const locked =
		memberAgents.ready && memberAgents.index.byProfileId.has(input.profileId);
	return (
		<MemberAgentHarnessLockContext value={locked}>
			{input.children}
		</MemberAgentHarnessLockContext>
	);
}

export function useMemberAgentHarnessLocked(): boolean {
	return use(MemberAgentHarnessLockContext);
}
