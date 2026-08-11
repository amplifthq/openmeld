import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	findActiveProfileById,
	listActiveProfilesByKind,
} from "#/lib/profiles/profiles";

export function resolveAppSpacesProfileId(input: {
	profiles: readonly AuthProfileView[];
	selectedHumanProfileId: string | null;
}): string | null {
	return resolveAppSpacesProfile(input)?.openMeldProfileId ?? null;
}

export function resolveAppSpacesProfile(input: {
	profiles: readonly AuthProfileView[];
	selectedHumanProfileId: string | null;
}): AuthProfileView | null {
	const selectedProfile =
		input.selectedHumanProfileId === null
			? null
			: findActiveProfileById(input.profiles, {
					profileId: input.selectedHumanProfileId,
					profileKind: "human",
				});
	if (selectedProfile) {
		return selectedProfile;
	}

	const defaultProfile = listActiveProfilesByKind(input.profiles, "human").find(
		(profile) => profile.isDefault
	);
	return defaultProfile ?? null;
}
