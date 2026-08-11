// Durable "last-used human profile" memory for the Space entry flow. Persisted
// in localStorage (survives tab close / restart, unlike the per-tab
// sessionStorage start-flow draft) and scoped per storageScope so multiple
// accounts on one browser never bleed into each other. Global scope (one value
// across all Spaces) is intentional: "who am I speaking as right now" is an
// account-level identity, and per-Space recency is already expressed by the
// Space Index `joinedProfiles`/`openProfileId`.

const LAST_USED_HUMAN_PROFILE_STORAGE_PREFIX =
	"openmeld:last-used-human-profile-id";

export function resolveLastUsedHumanProfileStorageKey(
	storageScope?: string
): string {
	const scope = String(storageScope ?? "").trim();
	return scope.length > 0
		? `${LAST_USED_HUMAN_PROFILE_STORAGE_PREFIX}:${scope}`
		: LAST_USED_HUMAN_PROFILE_STORAGE_PREFIX;
}

export function readLastUsedHumanProfileId(
	storageScope?: string
): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const value = window.localStorage.getItem(
			resolveLastUsedHumanProfileStorageKey(storageScope)
		);
		const normalized = value?.trim() ?? "";
		return normalized.length > 0 ? normalized : null;
	} catch {
		// Private mode / disabled storage: degrade to "no memory" instead of
		// throwing into the render path.
		return null;
	}
}

export function writeLastUsedHumanProfileId(input: {
	profileId: string;
	storageScope?: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	const profileId = input.profileId.trim();
	if (profileId.length === 0) {
		return;
	}
	try {
		window.localStorage.setItem(
			resolveLastUsedHumanProfileStorageKey(input.storageScope),
			profileId
		);
	} catch {
		// Ignore quota / disabled storage; the resolver simply falls back to the
		// default human profile next time.
	}
}
