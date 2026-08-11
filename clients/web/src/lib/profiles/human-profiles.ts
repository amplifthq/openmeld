import type {
	AuthProfileKind,
	AuthProfileView,
	OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import {
	buildProfileRequestContext as buildProfileRequestContextBase,
	findActiveProfileById as findActiveProfileByIdBase,
	listActiveProfilesByKind as listActiveProfilesByKindBase,
} from "./profiles";

export function listActiveProfilesByKind(
	profiles: readonly AuthProfileView[],
	profileKind: AuthProfileKind
): readonly AuthProfileView[] {
	return listActiveProfilesByKindBase(profiles, profileKind);
}

export function findActiveDefaultHumanProfile(
	profiles: readonly AuthProfileView[]
): AuthProfileView | null {
	return (
		listActiveProfilesByKindBase(profiles, "human").find(
			(profile) => profile.isDefault
		) ?? null
	);
}

export function findActiveProfileById(
	profiles: readonly AuthProfileView[],
	input: {
		profileId: string;
		profileKind?: AuthProfileKind;
	}
): AuthProfileView | null {
	return findActiveProfileByIdBase(profiles, input);
}

export function buildProfileRequestContext(
	profile: AuthProfileView
): OpenMeldRequestContext {
	return buildProfileRequestContextBase(profile);
}
