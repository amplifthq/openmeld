import { describe, expect, it } from "vitest";
import { advanceSpaceStreamDisplayText } from "./space-stream-display";

describe("advanceSpaceStreamDisplayText", () => {
	it("reveals one readable word for a normal accumulated snapshot", () => {
		expect(
			advanceSpaceStreamDisplayText({
				displayedText: "I found ",
				receivedText: "I found the problem in the stream.",
			})
		).toBe("I found the ");
	});

	it("reveals CJK text without splitting a word", () => {
		expect(
			advanceSpaceStreamDisplayText({
				displayedText: "已经",
				receivedText: "已经找到问题。",
			})
		).toBe("已经找到");
	});

	it("catches up faster when a large backlog arrives", () => {
		expect(
			advanceSpaceStreamDisplayText({
				displayedText: "Start ",
				receivedText:
					"Start one two three four five six seven eight nine ten eleven twelve thirteen.",
			})
		).toBe("Start one two ");
	});

	it("uses the new canonical snapshot immediately when it is not an extension", () => {
		expect(
			advanceSpaceStreamDisplayText({
				displayedText: "Old draft",
				receivedText: "Corrected answer",
			})
		).toBe("Corrected answer");
	});

	it("leaves a fully displayed snapshot unchanged", () => {
		expect(
			advanceSpaceStreamDisplayText({
				displayedText: "Complete",
				receivedText: "Complete",
			})
		).toBe("Complete");
	});
});
