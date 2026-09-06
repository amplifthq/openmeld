import type { PeopleSidebarPreferences } from "@openmeld/schemas";
import { moveSidebarItemIds, sortSidebarManual } from "../app/sidebar-order";
import type { DirectoryHumanProfileRow } from "./directory-human-profile-model";

export const EMPTY_PEOPLE_SIDEBAR: PeopleSidebarPreferences = {
	starred: { sort: "manual", itemIds: [] },
	people: { sort: "priority", itemIds: [] },
	groups: [],
};
export type PeopleFilter =
	| "all"
	| "connected"
	| "offline"
	| "unconnected"
	| "unknown";
export function peopleConnectionFilter(
	member: Pick<DirectoryHumanProfileRow, "computer">
): Exclude<PeopleFilter, "all"> {
	if (member.computer.state === "connected") {
		return "connected";
	}
	if (member.computer.state === "not_connected") {
		return member.computer.count > 0 ? "offline" : "unconnected";
	}
	return "unknown";
}
export function sortSidebarPeople(
	items: readonly DirectoryHumanProfileRow[],
	section: PeopleSidebarPreferences["people"]
) {
	if (section.sort === "manual") {
		return sortSidebarManual(items, section.itemIds, (item) => item.id);
	}
	return [...items].sort((a, b) => {
		if (section.sort === "name") {
			return a.name.localeCompare(b.name, "en", {
				sensitivity: "base",
				numeric: true,
			});
		}
		const time = (item: DirectoryHumanProfileRow) =>
			Date.parse(
				(section.sort === "recent" ? item.joinedAt : item.lastActiveAt) ?? ""
			) || 0;
		return time(b) - time(a) || a.name.localeCompare(b.name);
	});
}
export function moveSidebarPerson(
	preferences: PeopleSidebarPreferences,
	sectionId: string,
	itemId: string,
	visibleIds: readonly string[],
	beforeId?: string
): PeopleSidebarPreferences {
	const section =
		sectionId === "starred" || sectionId === "people"
			? preferences[sectionId]
			: preferences.groups.find((g) => g.id === sectionId);
	if (!section) {
		return preferences;
	}
	const itemIds = moveSidebarItemIds(
		section.itemIds,
		visibleIds,
		itemId,
		beforeId
	);
	const next = {
		...preferences,
		starred: {
			...preferences.starred,
			itemIds: preferences.starred.itemIds.filter((id) => id !== itemId),
		},
		groups: preferences.groups.map((g) => ({
			...g,
			itemIds: g.itemIds.filter((id) => id !== itemId),
		})),
	};
	if (sectionId === "starred") {
		return { ...next, starred: { sort: "manual", itemIds } };
	}
	if (sectionId === "people") {
		return { ...next, people: { sort: "manual", itemIds } };
	}
	return {
		...next,
		groups: next.groups.map((g) =>
			g.id === sectionId ? { ...g, sort: "manual", itemIds } : g
		),
	};
}
