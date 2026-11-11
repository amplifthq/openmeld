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
 * popover: an unchanged default shows the MemberAgent alone; a renamed default
 * or additional Profile adds its own name. Names never change mention identity.
 */
export function formatMemberAgentProfileDisplayName(input: {
	memberAgentName: string;
	profileName: string;
	isDefaultProfile: boolean;
	harnessKind: HarnessKind | null;
}): string {
	if (!input.harnessKind) {
		return input.profileName;
	}
	return input.isDefaultProfile &&
		input.profileName.trim() === formatHarnessDisplayName(input.harnessKind)
		? input.memberAgentName
		: `${input.memberAgentName} · ${input.profileName}`;
}

/**
 * Presentation for an agent Profile whose MemberAgent row is not readable by
 * this viewer (the MemberAgent read is owner-only). The harness comes from the
 * Profile's controller. An exact harness label needs no repeated suffix;
 * this presentation rule does not infer default Profile identity. Returns null for
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
		harnessKind,
		memberAgentName: formatMemberAgentDisplayName({ ownerName, harnessKind }),
		profileName: input.profileName,
		isDefaultProfile:
			input.profileName.trim() === formatHarnessDisplayName(harnessKind),
	});
}
