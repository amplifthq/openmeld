import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { normalizeRecentMentionProfileIds } from "@openmeld/space";

export type SpaceRecentMentionStorageRecord = {
	profileIds: string[];
};

export function readSpaceRecentMentionProfileIds(input: {
	openMeldProfileId: string;
	spaceId: string;
	snapshot: SpaceMembersSnapshot | null;
}): string[] {
	if (typeof window === "undefined") {
		return [];
	}

	const storageKey = buildSpaceRecentMentionStorageKey(input);
	const rawValue = window.localStorage.getItem(storageKey);
	if (!rawValue) {
		return [];
	}

	const parsedValue = readSpaceRecentMentionStorageRecord({
		rawValue,
		storageKey,
	});
	if (!parsedValue) {
		return [];
	}

	return normalizeRecentMentionProfileIds({
		profileIds: parsedValue.profileIds,
		allowedProfileIds: listSnapshotProfileIds(input.snapshot),
	});
}

export function writeSpaceRecentMentionProfileIds(input: {
	openMeldProfileId: string;
	profileIds: readonly string[];
	spaceId: string;
	snapshot: SpaceMembersSnapshot | null;
}) {
	if (typeof window === "undefined") {
		return;
	}

	const normalizedProfileIds = normalizeRecentMentionProfileIds({
		profileIds: input.profileIds,
		allowedProfileIds: listSnapshotProfileIds(input.snapshot),
	});
	const storageKey = buildSpaceRecentMentionStorageKey(input);

	if (normalizedProfileIds.length === 0) {
		window.localStorage.removeItem(storageKey);
		return;
	}

	const record: SpaceRecentMentionStorageRecord = {
		profileIds: normalizedProfileIds,
	};
	window.localStorage.setItem(storageKey, JSON.stringify(record));
}

function buildSpaceRecentMentionStorageKey(input: {
	openMeldProfileId: string;
	spaceId: string;
}): string {
	return `openmeld.space.recent-mentions:${input.openMeldProfileId}:${input.spaceId}`;
}

function readSpaceRecentMentionStorageRecord(input: {
	rawValue: string;
	storageKey: string;
}): SpaceRecentMentionStorageRecord | null {
	try {
		const parsedValue = JSON.parse(input.rawValue) as unknown;
		if (!isSpaceRecentMentionStorageRecord(parsedValue)) {
			console.warn("Ignoring invalid recent mention storage entry.", {
				storageKey: input.storageKey,
			});
			window.localStorage.removeItem(input.storageKey);
			return null;
		}

		return parsedValue;
	} catch (error) {
		console.warn("Ignoring invalid recent mention storage entry.", {
			storageKey: input.storageKey,
			error,
		});
		window.localStorage.removeItem(input.storageKey);
		return null;
	}
}

function isSpaceRecentMentionStorageRecord(
	value: unknown
): value is SpaceRecentMentionStorageRecord {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as Partial<SpaceRecentMentionStorageRecord>;
	return Array.isArray(record.profileIds);
}

function listSnapshotProfileIds(
	snapshot: SpaceMembersSnapshot | null
): readonly string[] | null {
	if (!snapshot) {
		return null;
	}

	return [
		...snapshot.agents.map((member) => member.profileId),
		...snapshot.humans.map((member) => member.profileId),
	];
}
