import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { expect, it } from "vitest";
import { moveSidebarSpace, sortSidebarSpaces } from "./sidebar-space-order";

const sortItems = [
	{
		spaceId: "older-needs-input",
		pinnedAt: "2026-09-01",
		lastJoinedAt: "2026-08-01",
	},
	{
		spaceId: "recent-activity",
		pinnedAt: "2026-08-01",
		lastJoinedAt: "2026-08-02",
	},
	{ spaceId: "newest-pin", pinnedAt: "2026-09-05", lastJoinedAt: "2026-08-03" },
];
it("puts human intervention before recent activity without confusing pin time with activity", () => {
	expect(
		sortSidebarSpaces(
			sortItems,
			{ sort: "priority", spaceIds: [] },
			new Set(["older-needs-input"]),
			new Map([["recent-activity", Date.parse("2026-09-06")]])
		).map((item) => item.spaceId)
	).toEqual(["older-needs-input", "recent-activity", "newest-pin"]);
});
it("does not treat pin time as conversation activity", () => {
	expect(
		sortSidebarSpaces(sortItems, { sort: "recent", spaceIds: [] }).map(
			(item) => item.spaceId
		)
	).toEqual(["newest-pin", "older-needs-input", "recent-activity"]);
});

const preferences: AccountSidebarPreferences = {
	pinned: { sort: "priority", spaceIds: ["pinned"] },
	spaces: { sort: "priority", spaceIds: [] },
	groups: [
		{ id: "design", name: "Design", sort: "manual", spaceIds: ["a", "pinned"] },
		{ id: "research", name: "Research", sort: "name", spaceIds: ["b"] },
	],
};

it("sorts conversations by message recency and keeps priority and manual choices", () => {
	const activity = new Map([
		["older-needs-input", 100],
		["recent-activity", 300],
	]);
	for (const sort of ["recent", "priority"] as const) {
		expect(
			sortSidebarSpaces(
				sortItems,
				{ sort, spaceIds: [] },
				undefined,
				undefined,
				undefined,
				activity
			).map((item) => item.spaceId)
		).toEqual(["recent-activity", "older-needs-input", "newest-pin"]);
	}
	expect(
		sortSidebarSpaces(
			sortItems,
			{ sort: "priority", spaceIds: [] },
			new Set(["older-needs-input"]),
			undefined,
			undefined,
			activity
		).map((item) => item.spaceId)
	).toEqual(["older-needs-input", "recent-activity", "newest-pin"]);
	expect(
		sortSidebarSpaces(
			sortItems,
			{
				sort: "manual",
				spaceIds: ["newest-pin", "recent-activity", "older-needs-input"],
			},
			undefined,
			undefined,
			undefined,
			activity
		).map((item) => item.spaceId)
	).toEqual(["newest-pin", "recent-activity", "older-needs-input"]);
});
it("ranks input, unread, working, then idle even when idle has the newest timestamp", () => {
	const items = ["idle", "working", "unread", "input"].map((spaceId) => ({
		spaceId,
		pinnedAt: null,
		lastJoinedAt: "2026-09-30",
		spaceUpdatedAt: spaceId === "idle" ? "2026-09-30" : "2026-09-01",
	}));
	const facts = [
		new Set(["input"]),
		new Map([["unread", Date.parse("2026-09-02")]]),
		new Set(["working", "input"]),
	] as const;
	expect(
		sortSidebarSpaces(items, { sort: "priority", spaceIds: [] }, ...facts).map(
			(item) => item.spaceId
		)
	).toEqual(["input", "unread", "working", "idle"]);
	expect(
		sortSidebarSpaces(
			items,
			{ sort: "manual", spaceIds: ["idle", "working", "unread", "input"] },
			...facts
		).map((item) => item.spaceId)
	).toEqual(["idle", "working", "unread", "input"]);
});
it("does not reorder a section when opening a Space updates its visit time", () => {
	const items = sortItems.map((item, index) => ({
		...item,
		spaceCreatedAt: `2026-08-0${index + 1}`,
		spaceUpdatedAt: `2026-09-0${index + 1}`,
	}));
	const section = { sort: "priority" as const, spaceIds: [] };
	const before = sortSidebarSpaces(items, section).map((item) => item.spaceId);
	const visited = items.map((item) => ({
		...item,
		lastJoinedAt:
			item.spaceId === "older-needs-input" ? "2026-09-30" : item.lastJoinedAt,
	}));
	expect(
		sortSidebarSpaces(visited, section).map((item) => item.spaceId)
	).toEqual(before);
});
it("moves a Space between groups once without losing hidden pinned members", () => {
	const next = moveSidebarSpace(preferences, "design", "b", ["a"], "a");
	expect(next.groups[0]?.spaceIds).toEqual(["b", "a", "pinned"]);
	expect(next.groups[1]?.spaceIds).toEqual([]);
	expect(next.groups[0]?.sort).toBe("manual");
	expect(next.pinned).toEqual(preferences.pinned);
});
it("moves down and up to the position previewed by the sortable list", () => {
	expect(
		moveSidebarSpace(preferences, "spaces", "a", ["a", "b", "c"], "b").spaces
			.spaceIds
	).toEqual(["b", "a", "c"]);
	expect(
		moveSidebarSpace(preferences, "spaces", "c", ["a", "b", "c"], "a").spaces
			.spaceIds
	).toEqual(["c", "a", "b"]);
});
it("returns a Space to the ordinary list and keeps pinned sorting independent", () => {
	const next = moveSidebarSpace(preferences, "spaces", "a", []);
	expect(next.groups[0]?.spaceIds).toEqual(["pinned"]);
	expect(next.spaces.spaceIds).toEqual(["a"]);
	const pinned = moveSidebarSpace(
		preferences,
		"pinned",
		"pinned",
		["other", "pinned"],
		"other"
	);
	expect(pinned.pinned.spaceIds).toEqual(["pinned", "other"]);
	expect(pinned.groups[0]?.spaceIds).toEqual(["a"]);
});
it("moves between pinned, custom groups, and ordinary Spaces without duplicate placement", () => {
	const pinned = moveSidebarSpace(preferences, "pinned", "b", ["pinned"]);
	expect(pinned.pinned.spaceIds).toEqual(["pinned", "b"]);
	expect(pinned.groups[1]?.spaceIds).toEqual([]);
	const grouped = moveSidebarSpace(pinned, "design", "b", ["a"]);
	expect(grouped.pinned.spaceIds).toEqual(["pinned"]);
	expect(grouped.groups[0]?.spaceIds).toContain("b");
	const ordinary = moveSidebarSpace(grouped, "spaces", "b", []);
	expect(ordinary.spaces.spaceIds).toEqual(["b"]);
	expect(ordinary.groups.every((group) => !group.spaceIds.includes("b"))).toBe(
		true
	);
});
it("does not remove membership if a destination no longer exists", () => {
	expect(moveSidebarSpace(preferences, "deleted-group", "a", [])).toBe(
		preferences
	);
});
