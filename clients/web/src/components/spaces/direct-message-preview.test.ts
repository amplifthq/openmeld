import { describe, expect, it } from "vitest";
import { formatDirectMessageTime } from "./direct-message-preview";

describe("conversation timestamps in the viewer's local calendar", () => {
	const now = new Date(2026, 8, 6, 12);
	it("uses 12-hour time for today", () => {
		expect(
			formatDirectMessageTime(new Date(2026, 8, 6, 10, 37).getTime(), now)
		).toBe("10:37 AM");
		expect(
			formatDirectMessageTime(new Date(2026, 8, 6, 0, 5).getTime(), now)
		).toBe("12:05 AM");
	});
	it("uses calendar days rather than elapsed 24-hour periods", () => {
		expect(
			formatDirectMessageTime(new Date(2026, 8, 5, 23, 59).getTime(), now)
		).toBe("Yesterday");
		expect(
			formatDirectMessageTime(new Date(2026, 8, 3, 23, 59).getTime(), now)
		).toBe("3 days ago");
	});
	it("handles month boundaries", () => {
		expect(
			formatDirectMessageTime(new Date(2026, 7, 31, 12).getTime(), now)
		).toBe("6 days ago");
	});
});
