import type { CollisionDetection } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import {
	moveSidebarGroup,
	sidebarCollisionDetection,
} from "./sidebar-drop-target";
import { moveSidebarItemIds } from "./sidebar-order";

type CollisionArgs = Parameters<CollisionDetection>[0];
type Container = CollisionArgs["droppableContainers"][number];

function fixture(groups = false) {
	const rect = (top: number, height: number) => ({
		top,
		bottom: top + height,
		left: 10,
		right: 210,
		width: 200,
		height,
	});
	const entries = [
		{
			id: "section:spaces",
			kind: "section",
			section: "spaces",
			top: 100,
			height: 160,
		},
		{
			id: "item:a",
			kind: "item",
			section: "spaces",
			itemId: "a",
			top: 100,
			height: 40,
		},
		{
			id: "item:b",
			kind: "item",
			section: "spaces",
			itemId: "b",
			top: 150,
			height: 40,
		},
		{
			id: "item:c",
			kind: "item",
			section: "spaces",
			itemId: "c",
			top: 200,
			height: 40,
		},
		{
			id: "section:empty",
			kind: "section",
			section: "empty",
			top: 300,
			height: 40,
		},
	];
	const measuredEntries = groups
		? [
				{
					id: "group:a",
					kind: "group",
					section: "groups",
					itemId: "a",
					top: 100,
					height: 60,
				},
				{
					id: "group:b",
					kind: "group",
					section: "groups",
					itemId: "b",
					top: 180,
					height: 40,
				},
				{
					id: "group:c",
					kind: "group",
					section: "groups",
					itemId: "c",
					top: 240,
					height: 100,
				},
			]
		: entries;
	const kind = groups ? "group" : "item";
	const containers: Container[] = measuredEntries.map(
		({ id, kind, section, itemId }) => ({
			id,
			key: id,
			disabled: false,
			data: { current: { kind, section, itemId } },
			node: { current: null },
			rect: { current: null },
		})
	);
	const args: CollisionArgs = {
		active: {
			id: `${kind}:a`,
			data: {
				current: { kind, itemId: "a", section: groups ? "groups" : "spaces" },
			},
			rect: { current: { initial: rect(100, 40), translated: rect(100, 40) } },
		},
		collisionRect: rect(100, 40),
		droppableRects: new Map(
			measuredEntries.map(({ id, top, height }) => [id, rect(top, height)])
		),
		droppableContainers: containers,
		pointerCoordinates: { x: 100, y: 100 },
	};
	return (y: number, x = 100, allowed = true, keyboard = false) =>
		sidebarCollisionDetection(() => allowed)({
			...args,
			collisionRect: rect(y, 40),
			pointerCoordinates: keyboard ? null : { x, y },
		})[0]?.data?.target;
}

describe("sidebar insertion targets", () => {
	it("keeps group insertion stable across spacing and different group heights", () => {
		const target = fixture(true);
		for (const y of [215, 221, 230, 239, 245]) {
			expect(target(y)).toMatchObject({
				kind: "group",
				beforeId: "c",
				top: 240,
			});
		}
		expect(target(330)).toMatchObject({
			kind: "group",
			beforeId: undefined,
			top: 340,
		});
		expect(target(350)).toBeUndefined();
	});
	it("moves one position down with the keyboard instead of staying before that row", () => {
		expect(fixture()(150, 100, true, true)).toMatchObject({
			beforeId: "c",
			top: 200,
		});
		expect(fixture(true)(180, 100, true, true)).toMatchObject({
			beforeId: "c",
			top: 240,
		});
	});
	it("keeps the same destination across a row's lower half and the following gap", () => {
		const target = fixture();
		for (const y of [175, 188, 191, 195, 199, 201, 219]) {
			expect(target(y)).toMatchObject({
				section: "spaces",
				beforeId: "c",
				top: 200,
			});
		}
		const before = target(195)?.beforeId;
		expect(moveSidebarItemIds([], ["a", "b", "c"], "a", before)).toEqual([
			"b",
			"a",
			"c",
		]);
	});
	it("supports the last row's lower half and the bottom padding", () => {
		const target = fixture();
		for (const y of [221, 239, 250, 260]) {
			expect(target(y)).toMatchObject({ beforeId: undefined, top: 240 });
		}
		expect(moveSidebarItemIds([], ["a", "b", "c"], "a")).toEqual([
			"b",
			"c",
			"a",
		]);
	});
	it("accepts an empty group and clears the indicator outside valid hitboxes", () => {
		const target = fixture();
		expect(target(320)).toMatchObject({
			section: "empty",
			beforeId: undefined,
			top: 300,
		});
		expect(target(280)).toBeUndefined();
		expect(target(180, 220)).toBeUndefined();
		expect(target(180, 100, false)).toBeUndefined();
	});
	it("preserves hidden rows and reorders groups without changing their contents", () => {
		expect(
			moveSidebarItemIds(["hidden", "a", "b"], ["a", "b"], "b", "a")
		).toEqual(["b", "a", "hidden"]);
		const groups = [
			{ id: "one", itemIds: ["a"] },
			{ id: "two", itemIds: ["b"] },
			{ id: "three", itemIds: [] },
		];
		expect(moveSidebarGroup(groups, "one", "three")).toEqual([
			groups[1],
			groups[0],
			groups[2],
		]);
		expect(moveSidebarGroup(groups, "one")).toEqual([
			groups[1],
			groups[2],
			groups[0],
		]);
		expect(moveSidebarGroup(groups, "three", "one")).toEqual([
			groups[2],
			groups[0],
			groups[1],
		]);
	});
});
