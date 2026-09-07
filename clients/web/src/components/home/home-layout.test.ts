import { describe, expect, it } from "vitest";
import {
	createHomeLayout,
	homeLayoutStorageKey,
	parseHomeLayout,
} from "./home-layout";

describe("Home layout persistence", () => {
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
