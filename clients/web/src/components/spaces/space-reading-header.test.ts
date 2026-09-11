import { describe, expect, it } from "vitest";
import { resolveSpaceReadingHeaderPosition } from "./space-reading-header";

describe("Space reading header position", () => {
	it.each([
		[25, 0],
		[60, 0],
		[96, 1],
		[143, 1],
		[500, 1],
	])("restores %ipx from the bottom at endpoint %i", (distance, endpoint) => {
		expect(resolveSpaceReadingHeaderPosition(distance).progress).toBe(endpoint);
	});
	it("keeps a compact header stable through small reversals at the collapse boundary", () => {
		let position = resolveSpaceReadingHeaderPosition(0);
		position = resolveSpaceReadingHeaderPosition(180, position);
		for (const distance of [145, 143, 145, 143, 100, 98, 100, 98]) {
			position = resolveSpaceReadingHeaderPosition(distance, position);
			expect(position.compact).toBe(true);
			expect(position.progress).toBe(1);
		}
	});
	it("does not recollapse after reversing a few pixels at the expansion boundary", () => {
		let position = resolveSpaceReadingHeaderPosition(180);
		for (const distance of [71, 73, 71, 73, 100, 140]) {
			position = resolveSpaceReadingHeaderPosition(distance, position);
			expect(position.compact).toBe(false);
		}
		position = resolveSpaceReadingHeaderPosition(144, position);
		expect(position.compact).toBe(true);
	});
	it("holds still without scrolling and moves continuously back to the latest messages", () => {
		let position = resolveSpaceReadingHeaderPosition(0);
		position = resolveSpaceReadingHeaderPosition(96, position);
		expect(position.progress).toBeCloseTo(0.6);
		for (let frame = 0; frame < 10; frame++) {
			position = resolveSpaceReadingHeaderPosition(96, position);
			expect(position.progress).toBeCloseTo(0.6);
		}
		position = resolveSpaceReadingHeaderPosition(180, position);
		const before = resolveSpaceReadingHeaderPosition(72, position);
		const after = resolveSpaceReadingHeaderPosition(71, before);
		expect(before.progress - after.progress).toBeLessThan(0.03);
		expect(resolveSpaceReadingHeaderPosition(0, after)).toMatchObject({
			compact: false,
			progress: 0,
		});
	});
});
