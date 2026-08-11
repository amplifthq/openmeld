import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";

const JOINED_AS_LABEL_PREFIX = "Joined as";

export type JoinedAsProfileLabel = {
	prefix: typeof JOINED_AS_LABEL_PREFIX;
	profileName: string;
	text: string;
};

export function buildJoinedAsProfileLabel(input: {
	profileName: string;
}): JoinedAsProfileLabel {
	const profileName = normalizeRequiredText(input.profileName, "profileName");

	return {
		prefix: JOINED_AS_LABEL_PREFIX,
		profileName,
		text: `${JOINED_AS_LABEL_PREFIX} ${profileName}`,
	};
}

export function buildAccountSpaceJoinedAsLabel(input: {
	openProfileName: string;
}): JoinedAsProfileLabel {
	return buildJoinedAsProfileLabel({
		profileName: input.openProfileName,
	});
}

export function resolveCurrentSpaceProfileName(input: {
	currentProfileId: string;
	snapshot: SpaceMembersSnapshot | null;
}): string | null {
	if (!input.snapshot) {
		return null;
	}

	const currentProfileId = normalizeRequiredText(
		input.currentProfileId,
		"currentProfileId"
	);
	const currentMember = [
		...input.snapshot.humans,
		...input.snapshot.agents,
	].find(
		(member) =>
			member.profileId === currentProfileId && member.status === "active"
	);

	if (!currentMember) {
		return null;
	}

	return buildJoinedAsProfileLabel({
		profileName: currentMember.profileName,
	}).profileName;
}

function normalizeRequiredText(value: string, fieldName: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`Space profile display requires ${fieldName}.`);
	}
	return normalized;
}
