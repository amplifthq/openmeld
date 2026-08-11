import type { AuthProfileView } from "@openmeld/schemas/types";

export function resolveAccountSpaceSourceProfiles(input: {
	profiles: readonly AuthProfileView[];
	selectedProfile: AuthProfileView;
}): readonly AuthProfileView[] {
	const selectedOwnerUserId = normalizeOptionalText(
		input.selectedProfile.ownerUserId
	);
	const accountProfiles = input.profiles.filter((profile) => {
		const ownerUserId = normalizeOptionalText(profile.ownerUserId);
		return profile.status === "active" && ownerUserId === selectedOwnerUserId;
	});
	const sourceProfiles = accountProfiles.some(
		(profile) =>
			profile.openMeldProfileId === input.selectedProfile.openMeldProfileId
	)
		? accountProfiles
		: [input.selectedProfile, ...accountProfiles];

	return uniqueProfilesById(sourceProfiles);
}

function uniqueProfilesById(
	profiles: readonly AuthProfileView[]
): AuthProfileView[] {
	const byProfileId = new Map<string, AuthProfileView>();
	for (const profile of profiles) {
		if (!byProfileId.has(profile.openMeldProfileId)) {
			byProfileId.set(profile.openMeldProfileId, profile);
		}
	}
	return Array.from(byProfileId.values());
}

function normalizeOptionalText(
	value: string | null | undefined
): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}
