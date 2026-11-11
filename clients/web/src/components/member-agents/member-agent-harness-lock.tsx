import { createContext, type ReactNode, use } from "react";
import { useMemberAgentIndex } from "./use-member-agents";

type MemberAgentProfileLocks = {
	/** The Profile belongs to a MemberAgent and cannot change harness. */
	harnessLocked: boolean;
};

const UNLOCKED: MemberAgentProfileLocks = {
	harnessLocked: false,
};

const MemberAgentHarnessLockContext =
	createContext<MemberAgentProfileLocks>(UNLOCKED);

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
	const entry = memberAgents.ready
		? memberAgents.index.byProfileId.get(input.profileId)
		: undefined;
	const locks = entry ? { harnessLocked: true } : UNLOCKED;
	return (
		<MemberAgentHarnessLockContext value={locks}>
			{input.children}
		</MemberAgentHarnessLockContext>
	);
}

export function useMemberAgentHarnessLocked(): boolean {
	return use(MemberAgentHarnessLockContext).harnessLocked;
}
