import type {
	AuthProfileKind,
	AuthProfileView,
	OpenMeldRequestContext,
} from "@openmeld/schemas/types";

export function listActiveProfilesByKind(
	profiles: readonly AuthProfileView[],
	profileKind: AuthProfileKind
): readonly AuthProfileView[] {
	return [...profiles]
		.filter(
			(profile) =>
				profile.profileKind === profileKind && profile.status === "active"
		)
		.sort((left, right) => {
			if (left.isDefault !== right.isDefault) {
				return left.isDefault ? -1 : 1;
			}

			const lastUsedDelta =
				resolveLastUsedAt(right.lastUsedAt) -
				resolveLastUsedAt(left.lastUsedAt);
			if (lastUsedDelta !== 0) {
				return lastUsedDelta;
			}

			return left.profileName.localeCompare(right.profileName, "en-US");
		});
}

export function findActiveProfileById(
	profiles: readonly AuthProfileView[],
	input: {
		profileId: string;
		profileKind?: AuthProfileKind;
	}
): AuthProfileView | null {
	return (
		profiles.find(
			(profile) =>
				profile.status === "active" &&
				profile.openMeldProfileId === input.profileId &&
				(input.profileKind === undefined ||
					profile.profileKind === input.profileKind)
		) ?? null
	);
}

export function buildProfileRequestContext(
	profile: AuthProfileView
): OpenMeldRequestContext {
	return {
		actorContext: {
			requestId: crypto.randomUUID(),
			openMeldProfileId: profile.openMeldProfileId,
			profileKind: profile.profileKind,
			profileHandle: profile.profileHandle,
			profileName: profile.profileName,
			ownerUserId: profile.ownerUserId ?? undefined,
			...(profile.ownerName ? { ownerName: profile.ownerName } : {}),
		},
	};
}

function resolveLastUsedAt(value: string | null): number {
	if (!value) {
		return 0;
	}

	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}
