import type { AccountSidebarPreferences } from "@openmeld/schemas";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { moveSidebarItemIds, sortSidebarManual } from "../app/sidebar-order";

export function sortSidebarSpaces<
	T extends Pick<
		AccountSpaceItem,
		| "spaceId"
		| "pinnedAt"
		| "lastJoinedAt"
		| "spaceCreatedAt"
		| "spaceUpdatedAt"
	>,
>(
	items: readonly T[],
	section?: AccountSidebarPreferences["spaces"],
	attention?: ReadonlySet<string>,
	latestActivity?: ReadonlyMap<string, number>,
	working?: ReadonlySet<string>,
	conversationActivity?: ReadonlyMap<string, number>
) {
	if (!section) {
		return items;
	}
	if (section.sort === "priority") {
		const rank = (id: string) => {
			if (attention?.has(id)) {
				return 3;
			}
			if (latestActivity?.has(id)) {
				return 2;
			}
			return working?.has(id) ? 1 : 0;
		};
		return [...items].sort(
			(a, b) =>
				rank(b.spaceId) - rank(a.spaceId) ||
				(conversationActivity
					? (conversationActivity.get(b.spaceId) ?? 0) -
						(conversationActivity.get(a.spaceId) ?? 0)
					: Math.max(
							latestActivity?.get(b.spaceId) ?? 0,
							Date.parse(b.spaceUpdatedAt ?? b.spaceCreatedAt ?? "") || 0
						) -
						Math.max(
							latestActivity?.get(a.spaceId) ?? 0,
							Date.parse(a.spaceUpdatedAt ?? a.spaceCreatedAt ?? "") || 0
						)) ||
				a.spaceId.localeCompare(b.spaceId)
		);
	}
	// Accept previously saved Name preferences as the replacement sort.
	if (section.sort === "recent" || section.sort === "name") {
		if (conversationActivity) {
			return [...items].sort(
				(a, b) =>
					(conversationActivity.get(b.spaceId) ?? 0) -
						(conversationActivity.get(a.spaceId) ?? 0) ||
					a.spaceId.localeCompare(b.spaceId)
			);
		}
		return [...items].sort(
			(a, b) =>
				(Date.parse(b.pinnedAt ?? b.spaceCreatedAt ?? "") || 0) -
				(Date.parse(a.pinnedAt ?? a.spaceCreatedAt ?? "") || 0)
		);
	}
	return sortSidebarManual(items, section.spaceIds, (item) => item.spaceId);
}

export function moveSidebarSpace(
	preferences: AccountSidebarPreferences,
	sectionId: string,
	spaceId: string,
	visibleIds: readonly string[],
	beforeId?: string
): AccountSidebarPreferences {
	const destination =
		sectionId === "pinned" || sectionId === "spaces"
			? preferences[sectionId]
			: preferences.groups.find((group) => group.id === sectionId);
	if (!destination) {
		return preferences;
	}
	const ids = moveSidebarItemIds(
		destination.spaceIds,
		visibleIds,
		spaceId,
		beforeId
	);
	const next = {
		...preferences,
		pinned: {
			...preferences.pinned,
			spaceIds: preferences.pinned.spaceIds.filter((id) => id !== spaceId),
		},
		spaces: {
			...preferences.spaces,
			spaceIds: preferences.spaces.spaceIds.filter((id) => id !== spaceId),
		},
		groups: preferences.groups.map((group) => ({
			...group,
			spaceIds: group.spaceIds.filter((id) => id !== spaceId),
		})),
	};
	if (sectionId === "pinned") {
		return { ...next, pinned: { sort: "manual", spaceIds: ids } };
	}
	if (sectionId === "spaces") {
		return { ...next, spaces: { sort: "manual", spaceIds: ids } };
	}
	return {
		...next,
		groups: next.groups.map((group) =>
			group.id === sectionId
				? { ...group, sort: "manual", spaceIds: ids }
				: group
		),
	};
}
