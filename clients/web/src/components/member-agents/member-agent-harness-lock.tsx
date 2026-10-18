import { createContext, type ReactNode, use } from "react";
import { useMemberAgentIndex } from "./use-member-agents";

type MemberAgentProfileLocks = {
	/** The Profile belongs to a MemberAgent and cannot change harness. */
	harnessLocked: boolean;
	/** The MemberAgent's default Profile keeps its harness name (§4.2). */
	nameLocked: boolean;
};

const UNLOCKED: MemberAgentProfileLocks = {
	harnessLocked: false,
	nameLocked: false,
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
	const locks = entry
		? { harnessLocked: true, nameLocked: entry.isDefaultProfile }
		: UNLOCKED;
	return (
		<MemberAgentHarnessLockContext value={locks}>
			{input.children}
		</MemberAgentHarnessLockContext>
	);
}

export function useMemberAgentHarnessLocked(): boolean {
	return use(MemberAgentHarnessLockContext).harnessLocked;
}

/** True for a MemberAgent's default Profile, whose name is not editable. */
export function useMemberAgentProfileNameLocked(): boolean {
	return use(MemberAgentHarnessLockContext).nameLocked;
}
