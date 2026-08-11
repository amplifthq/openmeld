import { updateProfileSpaceHistoryStatus } from "#/lib/onboarding/update-profile-space-history-status";
import { listStartProfiles } from "#/lib/profiles/existing-profiles";
import { resolveAccountSpaceSourceProfiles } from "./account-space-source-profiles";

export type DeletedSpaceHistoryCleanupResult = {
	updatedProfileIds: readonly string[];
};

export async function removeDeletedSpaceFromAccountHistory(input: {
	currentProfileId: string;
	reason: string;
	spaceId: string;
}): Promise<DeletedSpaceHistoryCleanupResult> {
	const currentProfileId = normalizeRequiredText(
		input.currentProfileId,
		"currentProfileId"
	);
	const spaceId = normalizeRequiredText(input.spaceId, "spaceId");
	const reason = normalizeRequiredText(input.reason, "reason");
	const profiles = await listStartProfiles();
	const selectedProfile = profiles.find(
		(profile) =>
			profile.openMeldProfileId === currentProfileId &&
			profile.status === "active"
	);
	if (!selectedProfile) {
		throw new Error(
			"OpenMeld could not load the selected profile for this space."
		);
	}

	const sourceProfiles = resolveAccountSpaceSourceProfiles({
		profiles,
		selectedProfile,
	});
	const results = await Promise.allSettled(
		sourceProfiles.map(async (profile) => {
			await updateProfileSpaceHistoryStatus({
				data: {
					profileId: profile.openMeldProfileId,
					reason,
					spaceId,
					status: "removed",
				},
			});
			return profile.openMeldProfileId;
		})
	);
	const updatedProfileIds: string[] = [];
	const failedProfileIds: string[] = [];

	for (const [index, result] of results.entries()) {
		if (result.status === "fulfilled") {
			updatedProfileIds.push(result.value);
			continue;
		}
		const failedProfile = sourceProfiles[index];
		if (failedProfile) {
			failedProfileIds.push(failedProfile.openMeldProfileId);
		}
	}

	if (failedProfileIds.length > 0) {
		throw new Error(
			`OpenMeld could not remove this deleted space from ${String(
				failedProfileIds.length
			)} sidebar profile record${failedProfileIds.length === 1 ? "" : "s"}.`
		);
	}

	return { updatedProfileIds };
}

function normalizeRequiredText(value: string, label: string): string {
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`${label} is required.`);
	}
	return normalized;
}
