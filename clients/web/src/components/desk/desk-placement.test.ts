import { describe, expect, it } from "vitest";
import { findDeskPlacement } from "./desk-placement";

describe("Desk placement", () => {
	it("keeps the requested position when there is room", () => {
		expect(
			findDeskPlacement({ x: 40, y: 60 }, { width: 400, height: 500 }, [])
		).toEqual({ x: 40, y: 60 });
	});
	it("does not cover an existing conversation or the next widget", () => {
		const occupied = [
			{ x: 0, y: 0, width: 800, height: 600 },
			{ x: 832, y: 0, width: 400, height: 600 },
		];
		const next = findDeskPlacement(
			{ x: 30, y: 40 },
			{ width: 400, height: 500 },
			occupied
		);
		for (const rect of occupied) {
			expect(
				next.x >= rect.x + rect.width + 24 ||
					next.x + 400 + 24 <= rect.x ||
					next.y >= rect.y + rect.height + 24 ||
					next.y + 500 + 24 <= rect.y
			).toBe(true);
		}
	});
	it("uses an empty row without pushing it to the right", () => {
		expect(
			findDeskPlacement({ x: 20, y: 700 }, { width: 400, height: 500 }, [
				{ x: 0, y: 0, width: 800, height: 600 },
			])
		).toEqual({ x: 20, y: 700 });
	});
});
