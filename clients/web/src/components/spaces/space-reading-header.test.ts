import { describe, expect, it } from "vitest";
import { resolveSpaceReadingHeaderProgress } from "./space-reading-header";

describe("Space reading header position", () => {
	it.each([
		[25, 0],
		[60, 0],
		[96, 1],
		[143, 1],
		[500, 1],
	])("settles a restored or finished scroll %ipx from the bottom at endpoint %i", (distance, endpoint) => {
		expect(resolveSpaceReadingHeaderProgress(distance, false)).toBe(endpoint);
	});
	it("keeps a real scroll gesture continuous but returns to the expanded row at the latest messages", () => {
		expect(resolveSpaceReadingHeaderProgress(96, true)).toBeCloseTo(0.6);
		for (const isUserScrolling of [true, false]) {
			expect(resolveSpaceReadingHeaderProgress(0, isUserScrolling)).toBe(0);
			expect(resolveSpaceReadingHeaderProgress(24, isUserScrolling)).toBe(0);
		}
	});
});
