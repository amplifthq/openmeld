import { describe, expect, it } from "vitest";
import {
	resolveSpaceMessageRowLayoutClassName,
	SPACE_MESSAGE_ROW_LAYOUT_CLASS,
} from "./space-message-bubble-style";

describe("Space message vertical rhythm", () => {
	it("uses one shared spacing contract for grouped message rows", () => {
		expect(
			resolveSpaceMessageRowLayoutClassName({
				isFirstInGroup: true,
				isLastInGroup: true,
			})
		).toBe("px-3 pt-1.5 pb-1.5");
		expect(
			resolveSpaceMessageRowLayoutClassName({
				isFirstInGroup: true,
				isLastInGroup: false,
			})
		).toBe("px-3 pt-1.5 pb-0");
		expect(
			resolveSpaceMessageRowLayoutClassName({
				isFirstInGroup: false,
				isLastInGroup: false,
			})
		).toBe("px-3 pt-1 pb-0");
		expect(
			resolveSpaceMessageRowLayoutClassName({
				isFirstInGroup: false,
				isLastInGroup: true,
			})
		).toBe("px-3 pt-1 pb-1.5");
	});

	it("keeps section rows on their existing wider boundary", () => {
		expect(SPACE_MESSAGE_ROW_LAYOUT_CLASS).toBe("px-3 py-2");
	});
});
