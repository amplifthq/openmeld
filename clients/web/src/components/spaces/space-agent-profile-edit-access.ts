import type { AuthProfileView } from "@openmeld/schemas/types";

export function buildEditableSpaceAgentProfilesById(input: {
	accountProfiles: readonly AuthProfileView[];
	currentOwnerUserId: string | null;
	editContextAvailable: boolean;
}): ReadonlyMap<string, AuthProfileView> {
	const profiles = new Map<string, AuthProfileView>();
	if (!input.editContextAvailable) {
		return profiles;
	}
	for (const profile of input.accountProfiles) {
		if (
			profile.profileKind === "agent" &&
			profile.status === "active" &&
			!profile.managedRole &&
			profile.ownerUserId === input.currentOwnerUserId
		) {
			profiles.set(profile.openMeldProfileId, profile);
		}
	}
	return profiles;
}
