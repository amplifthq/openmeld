import { peopleSidebarPreferencesSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
	EMPTY_PEOPLE_SIDEBAR,
	moveSidebarPerson,
	peopleConnectionFilter,
	removeSidebarPeopleGroup,
} from "./people-sidebar-order";

describe("personal People organization", () => {
	it("does not create default stars and preserves saved stars", () => {
		expect(EMPTY_PEOPLE_SIDEBAR.starred.itemIds).toEqual([]);
		const starred = moveSidebarPerson(
			EMPTY_PEOPLE_SIDEBAR,
			"starred",
			"self",
			[]
		);
		expect(
			peopleSidebarPreferencesSchema.parse(starred).starred.itemIds
		).toEqual(["self"]);
	});
	it("preserves custom placement and returns deleted group members to the directory", () => {
		const grouped = {
			...EMPTY_PEOPLE_SIDEBAR,
			groups: [
				{
					id: "design",
					name: "Design",
					sort: "manual" as const,
					itemIds: ["self"],
				},
			],
		};
		expect(grouped.starred.itemIds).toEqual([]);
		const removed = removeSidebarPeopleGroup(grouped, "design");
		expect(removed.people.itemIds).toEqual(["self"]);
		expect(removed.starred.itemIds).toEqual([]);
	});
	it("moves between groups, stars and the directory without duplicating or losing hidden members", () => {
		const groupId = "0c1cc2f8-cb19-400f-99af-894dcdeca851";
		const prefs = {
			...EMPTY_PEOPLE_SIDEBAR,
			groups: [
				{
					id: groupId,
					name: "Design",
					sort: "manual" as const,
					itemIds: ["alice", "bob"],
				},
			],
		};
		const starred = moveSidebarPerson(prefs, "starred", "alice", []);
		expect(starred.groups[0]?.itemIds).toEqual(["bob"]);
		expect(starred.starred.itemIds).toEqual(["alice"]);
		const grouped = moveSidebarPerson(starred, groupId, "alice", [], undefined);
		expect(grouped.starred.itemIds).toEqual([]);
		expect(grouped.groups[0]?.itemIds).toEqual(["alice", "bob"]);
		const directory = moveSidebarPerson(grouped, "people", "alice", ["carol"]);
		expect(directory.people.itemIds).toEqual(["carol", "alice"]);
		expect(directory.groups[0]?.itemIds).toEqual(["bob"]);
	});
	it("rejects duplicate custom group membership", () => {
		expect(
			peopleSidebarPreferencesSchema.safeParse({
				...EMPTY_PEOPLE_SIDEBAR,
				groups: [
					{
						id: "0c1cc2f8-cb19-400f-99af-894dcdeca851",
						name: "Design",
						sort: "manual",
						itemIds: ["alice"],
					},
					{
						id: "0c1cc2f8-cb19-400f-99af-894dcdeca852",
						name: "Engineering",
						sort: "manual",
						itemIds: ["alice"],
					},
				],
			}).success
		).toBe(false);
	});
	it.each([
		["connected", 1, "connected"],
		["not_connected", 2, "offline"],
		["not_connected", 0, "unconnected"],
		["unknown", 2, "unknown"],
		["checking", 0, "unknown"],
		["needs_attention", 1, "unknown"],
	] as const)("classifies %s with %i registered computers as %s", (state, count, expected) => {
		expect(
			peopleConnectionFilter({
				computer: { state, count, label: "", path: null },
			})
		).toBe(expected);
	});
});
