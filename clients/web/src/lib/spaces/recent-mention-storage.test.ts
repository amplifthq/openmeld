import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSpaceRecentMentionProfileIds } from "./recent-mention-storage";

describe("readSpaceRecentMentionProfileIds", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("returns an empty list when localStorage contains malformed recent mention JSON", () => {
		const consoleWarnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);

		window.localStorage.setItem(
			"openmeld.space.recent-mentions:profile-123:space-123",
			"{bad json"
		);

		expect(
			readSpaceRecentMentionProfileIds({
				openMeldProfileId: "profile-123",
				spaceId: "space-123",
				snapshot: null,
			})
		).toEqual([]);
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"Ignoring invalid recent mention storage entry.",
			expect.objectContaining({
				storageKey: "openmeld.space.recent-mentions:profile-123:space-123",
				error: expect.any(SyntaxError),
			})
		);
		expect(
			window.localStorage.getItem(
				"openmeld.space.recent-mentions:profile-123:space-123"
			)
		).toBeNull();
	});

	it("returns an empty list when localStorage contains an invalid recent mention shape", () => {
		const consoleWarnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);

		window.localStorage.setItem(
			"openmeld.space.recent-mentions:profile-123:space-123",
			"null"
		);

		expect(
			readSpaceRecentMentionProfileIds({
				openMeldProfileId: "profile-123",
				spaceId: "space-123",
				snapshot: null,
			})
		).toEqual([]);
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"Ignoring invalid recent mention storage entry.",
			expect.objectContaining({
				storageKey: "openmeld.space.recent-mentions:profile-123:space-123",
			})
		);
		expect(
			window.localStorage.getItem(
				"openmeld.space.recent-mentions:profile-123:space-123"
			)
		).toBeNull();
	});
});
