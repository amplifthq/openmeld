import { describe, expect, it } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { findRecentWakeExchange } from "./space-wake-recommendation";

function message(
	id: string,
	actorProfileId: string,
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return {
		id,
		actorProfileId,
		actorProfileKind: "human",
		wakeTargetProfileIds: [],
		deliveryState: "sent",
		...overrides,
	} as SpaceTimelineItem;
}
const source = message("request", "me", { wakeTargetProfileIds: ["alex"] });
const reply = message("reply", "alex", {
	actorProfileKind: "agent",
	wakeSourceSignalId: "request",
});

describe("recent completed Wake recommendation", () => {
	it("recommends my previous Agent only after its own reply", () => {
		expect(findRecentWakeExchange([source], "me")).toBeNull();
		expect(findRecentWakeExchange([source, reply], "me")).toEqual({
			profileId: "alex",
			exchangeId: "reply",
		});
		expect(findRecentWakeExchange([source, reply], "someone-else")).toBeNull();
	});
	it("does not guess among multiple Agents or carry a suggestion across a new unfinished Wake", () => {
		expect(
			findRecentWakeExchange(
				[
					source,
					reply,
					message("next", "me", { wakeTargetProfileIds: ["blair"] }),
				],
				"me"
			)
		).toBeNull();
		expect(
			findRecentWakeExchange(
				[{ ...source, wakeTargetProfileIds: ["alex", "blair"] }, reply],
				"me"
			)
		).toBeNull();
	});
	it("does not treat another reply, a recalled reply, or failed delivery as completion", () => {
		expect(
			findRecentWakeExchange(
				[source, { ...reply, wakeSourceSignalId: "another" }],
				"me"
			)
		).toBeNull();
		expect(
			findRecentWakeExchange([source, { ...reply, recalledAt: 123 }], "me")
		).toBeNull();
		expect(
			findRecentWakeExchange(
				[source, { ...reply, deliveryState: "failed" }],
				"me"
			)
		).toBeNull();
	});
});
