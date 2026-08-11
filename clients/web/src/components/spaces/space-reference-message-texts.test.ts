import { describe, expect, it } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { buildSpaceReferenceMessageTexts } from "./space-reference-message-texts";

describe("buildSpaceReferenceMessageTexts", () => {
	it("keeps main conversation references when no thread is open", () => {
		const referenceText = `Open /spaces/${"b".repeat(64)}`;

		expect(
			buildSpaceReferenceMessageTexts({
				membersSnapshot: null,
				threadSignals: null,
				timelineItems: [{ text: referenceText } as SpaceTimelineItem],
			})
		).toEqual([referenceText]);
	});
});
