import type { AccountSidebarPreferences } from "@openmeld/schemas";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";

/** The user's saved group order, with pinned Spaces first and ungrouped last. */
export function spaceDirectoryGroups(
	items: readonly AccountSpaceItem[],
	preferences?: AccountSidebarPreferences
) {
	const groupedIds = new Set(
		preferences?.groups.flatMap((group) => group.spaceIds)
	);
	const unpinned = items.filter((item) => item.pinnedAt === null);
	return [
		{
			id: "pinned",
			label: "Pinned",
			section: preferences?.pinned,
			items: items.filter((item) => item.pinnedAt !== null),
		},
		...(preferences?.groups ?? []).map((group) => ({
			id: group.id,
			label: group.name,
			section: group,
			items: unpinned.filter((item) => group.spaceIds.includes(item.spaceId)),
		})),
		{
			id: "spaces",
			label: "Spaces",
			section: preferences?.spaces,
			items: unpinned.filter((item) => !groupedIds.has(item.spaceId)),
		},
	];
}
