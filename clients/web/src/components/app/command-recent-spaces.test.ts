import { describe, expect, it } from "vitest";
import { recentSpaceIds, recordRecentSpace } from "./command-recent-spaces";

describe("recent Space navigation", () => {
	it("moves a revisited Space to the front without duplicating it", () => {
		expect(
			recordRecentSpace(["design", "release", "product"], "release")
		).toEqual(["release", "design", "product"]);
	});
	it("rejects malformed history and keeps only bounded Space identities", () => {
		expect(recentSpaceIds("{")).toEqual([]);
		expect(recentSpaceIds('["design",null,12,"design","release"]')).toEqual([
			"design",
			"release",
		]);
		expect(
			recordRecentSpace(
				Array.from({ length: 30 }, (_, i) => String(i)),
				"new"
			)
		).toHaveLength(30);
	});
});
