import {
	formatHarnessDisplayName,
	type HarnessKind,
	harnessKindFromAgentControllerRef,
} from "@openmeld/schemas";

/**
 * A MemberAgent's display name, derived from its owner's default Human Profile
 * name and its harness: `Felix Lu’s Claude Code`. Never stored.
 */
export function formatMemberAgentDisplayName(input: {
	ownerName: string;
	harnessKind: HarnessKind;
}): string {
	const ownerName = input.ownerName.trim() || "Unknown member";
	return `${ownerName}’s ${formatHarnessDisplayName(input.harnessKind)}`;
}

/**
 * How a Profile of a MemberAgent is presented next to its messages and in its
 * popover: the default Profile shows the MemberAgent alone; any other Profile
 * adds its own name. The Profile's own name stays the mention target.
 */
export function formatMemberAgentProfileDisplayName(input: {
	memberAgentName: string;
	profileName: string;
	isDefaultProfile: boolean;
}): string {
	return input.isDefaultProfile
		? input.memberAgentName
		: `${input.memberAgentName} · ${input.profileName}`;
}

/**
 * Presentation for an agent Profile whose MemberAgent row is not readable by
 * this viewer (the MemberAgent read is owner-only). The harness comes from the
 * Profile's controller; a Profile named exactly after its harness is the
 * harness's default Profile by the default-name rule. Returns null for
 * Profiles outside the structure (custom controllers, Center Agent).
 */
export function formatAgentProfileOwnerHarnessName(input: {
	agentControllerRef: string | null | undefined;
	ownerName: string | null | undefined;
	profileName: string;
}): string | null {
	const harnessKind = harnessKindFromAgentControllerRef(
		input.agentControllerRef
	);
	const ownerName = input.ownerName?.trim();
	if (!(harnessKind && ownerName)) {
		return null;
	}
	return formatMemberAgentProfileDisplayName({
		memberAgentName: formatMemberAgentDisplayName({ ownerName, harnessKind }),
		profileName: input.profileName,
		isDefaultProfile:
			input.profileName.trim() === formatHarnessDisplayName(harnessKind),
	});
}
