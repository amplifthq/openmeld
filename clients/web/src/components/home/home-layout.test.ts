import { describe, expect, it } from "vitest";
import {
	createHomeLayout,
	homeLayoutStorageKey,
	homeStartViewport,
	parseHomeLayout,
	reconcileHomeSpaces,
} from "./home-layout";

describe("Home layout persistence", () => {
	it("starts at readable scale even when windows extend beyond the screen", () => {
		const layout = createHomeLayout();
		layout.cards.push({
			id: "wide",
			kind: "space",
			spaceId: "wide",
			x: 900,
			y: 300,
			width: 700,
			height: 1600,
		});
		expect(homeStartViewport(layout.cards, 1100)).toEqual({
			x: 24,
			y: 64,
			zoom: 1,
		});
	});
	it("remembers dismissed window guidance", () => {
		const layout = createHomeLayout();
		layout.cards[1].guideDismissed = true;
		expect(
			parseHomeLayout(JSON.stringify(layout))?.cards[1].guideDismissed
		).toBe(true);
	});
	it("removes unavailable Space windows while preserving the rest of the desk", () => {
		const layout = createHomeLayout();
		layout.cards.push(
			...["deleted", "available"].map((spaceId) => ({
				id: spaceId,
				kind: "space" as const,
				spaceId,
				x: 900,
				y: 300,
				width: 700,
				height: 600,
			}))
		);
		const result = reconcileHomeSpaces(layout, new Set(["available"]));
		expect(result.cards.map((card) => card.id)).toEqual([
			"welcome",
			"center-agent",
			"available",
		]);
		expect(parseHomeLayout(JSON.stringify(result))).toEqual(result);
		expect(reconcileHomeSpaces(result, new Set(["available"]))).toBe(result);
	});
	it("keeps saved windows until a successful Space index is available", () => {
		const layout = createHomeLayout();
		layout.cards.push({
			id: "space",
			kind: "space",
			spaceId: "space",
			x: 900,
			y: 300,
			width: 700,
			height: 600,
		});
		expect(reconcileHomeSpaces(layout, null)).toBe(layout);
		expect(reconcileHomeSpaces(layout, new Set()).cards).toEqual(
			createHomeLayout().cards
		);
	});
	it("keeps a deliberately empty desk empty", () => {
		expect(
			parseHomeLayout(JSON.stringify({ version: 2, cards: [] }))?.cards
		).toEqual([]);
	});
	it("separates accounts and organizations", () => {
		expect(
			new Set([
				homeLayoutStorageKey("a", "x"),
				homeLayoutStorageKey("a", "y"),
				homeLayoutStorageKey("b", "x"),
			]).size
		).toBe(3);
	});
	it("rejects malformed, unsupported and duplicate layouts", () => {
		const layout = createHomeLayout();
		expect(parseHomeLayout("broken")).toBeNull();
		expect(
			parseHomeLayout(JSON.stringify({ ...layout, version: 99 }))
		).toBeNull();
		expect(
			parseHomeLayout(
				JSON.stringify({ ...layout, cards: [layout.cards[0], layout.cards[0]] })
			)
		).toBeNull();
	});
	it("preserves positions outside the initial viewport", () => {
		const layout = createHomeLayout();
		layout.cards = layout.cards.map((card) => ({
			...card,
			x: -12_000,
			y: 40_000,
		}));
		expect(parseHomeLayout(JSON.stringify(layout))).toEqual(layout);
	});
});
