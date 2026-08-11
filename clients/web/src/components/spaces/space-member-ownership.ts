import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";

export function resolveCurrentSpaceProfileOwnerUserId(input: {
	currentProfileId: string;
	snapshot: SpaceMembersSnapshot | null;
}): string | null {
	if (!input.snapshot) {
		return null;
	}

	const currentMember = [
		...input.snapshot.humans,
		...input.snapshot.agents,
	].find((member) => member.profileId === input.currentProfileId);
	return normalizeOwnerUserId(currentMember?.ownerUserId);
}

export function isSameOwnerUserId(input: {
	currentOwnerUserId: string | null;
	ownerUserId: string | null | undefined;
}): boolean {
	const ownerUserId = normalizeOwnerUserId(input.ownerUserId);
	return Boolean(
		input.currentOwnerUserId && ownerUserId === input.currentOwnerUserId
	);
}

function normalizeOwnerUserId(value: string | null | undefined): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}
