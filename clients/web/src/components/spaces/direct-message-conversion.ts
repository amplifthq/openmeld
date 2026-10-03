import { MAX_SPACE_NAME_LENGTH } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";

/** Conversion admits the owners of existing Agents, just like ordinary Spaces. */
export function resolveDirectMessageConversionNames(input: {
	snapshot: SpaceMembersSnapshot | null;
	selectedMembers: readonly {
		profileName: string;
		profileKind: "human" | "agent";
		ownerUserId?: string | null;
	}[];
}): string[] {
	const humanOwners = new Set(
		[
			...(input.snapshot?.humans.filter(
				(member) => member.status === "active"
			) ?? []),
			...input.selectedMembers.filter(
				(member) => member.profileKind === "human"
			),
		].map((member) => member.ownerUserId)
	);
	const joiningOwners = new Map<string, string>();
	for (const agent of input.snapshot?.agents ?? []) {
		if (
			agent.status === "active" &&
			agent.ownerUserId &&
			!humanOwners.has(agent.ownerUserId)
		) {
			joiningOwners.set(
				agent.ownerUserId,
				agent.ownerName?.trim() || "Agent owner"
			);
		}
	}
	return [
		...input.selectedMembers.map((member) => member.profileName),
		...joiningOwners.values(),
	];
}

const ENGLISH_NAME_LIST_FORMAT = new Intl.ListFormat("en", {
	style: "long",
	type: "conjunction",
});

export function formatDirectMessageConversionNames(
	names: readonly string[]
): string {
	return ENGLISH_NAME_LIST_FORMAT.format(names);
}

export function buildDirectMessageConversionDefaultName(input: {
	currentMemberNames: readonly string[];
	currentSpaceName: string | null | undefined;
	selectedNames: readonly string[];
}): string {
	const names = [...input.currentMemberNames, ...input.selectedNames].filter(
		(name, index, all) => name.trim().length > 0 && all.indexOf(name) === index
	);
	const formatted = formatDirectMessageConversionNames(names);
	if (formatted.length > 0 && formatted.length <= MAX_SPACE_NAME_LENGTH) {
		return formatted;
	}
	return input.currentSpaceName?.trim() || "New Space";
}
