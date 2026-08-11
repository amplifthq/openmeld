import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
	buildSpaceMemberDirectory,
	type SpaceMemberDirectoryEntry,
} from "@openmeld/space";

export type SpaceCollaborationProfilePresentation = {
	agentControllerRef: string | null;
	avatarImageUrl: string | null;
	isCenterAgent: boolean;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
};

export function buildSpaceMemberDirectoryEntryByProfileId(
	snapshot: SpaceMembersSnapshot | null
): ReadonlyMap<string, SpaceMemberDirectoryEntry> {
	const byProfileId = new Map<string, SpaceMemberDirectoryEntry>();
	if (!snapshot) {
		return byProfileId;
	}

	for (const section of buildSpaceMemberDirectory(snapshot).sections) {
		for (const entry of section.entries) {
			byProfileId.set(entry.profileId, entry);
		}
	}

	return byProfileId;
}

export function buildWakeStopTargetLabelsByProfileId(
	entriesByProfileId: ReadonlyMap<string, SpaceMemberDirectoryEntry>
): ReadonlyMap<string, string> {
	const labelsByProfileId = new Map<string, string>();
	for (const [profileId, entry] of entriesByProfileId) {
		labelsByProfileId.set(profileId, entry.profileName);
	}
	return labelsByProfileId;
}

export function buildSpaceCollaborationProfilePresentations(input: {
	centerAgentProfileId: string | null;
	entriesByProfileId: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
}): ReadonlyMap<string, SpaceCollaborationProfilePresentation> {
	const presentations = new Map<
		string,
		SpaceCollaborationProfilePresentation
	>();
	for (const [profileId, entry] of input.entriesByProfileId) {
		presentations.set(profileId, {
			agentControllerRef: entry.agentControllerRef,
			avatarImageUrl: entry.avatarUrl,
			isCenterAgent: profileId === input.centerAgentProfileId,
			profileId,
			profileKind: entry.profileKind,
			profileName: entry.profileName,
		});
	}
	return presentations;
}
