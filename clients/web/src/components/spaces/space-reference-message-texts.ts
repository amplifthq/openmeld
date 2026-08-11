import type {
	SignalEnvelope,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	buildSpaceTimelineItems,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";

export function buildSpaceReferenceMessageTexts(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	threadSignals: readonly SignalEnvelope[] | null;
	timelineItems: readonly SpaceTimelineItem[] | null;
}): readonly string[] {
	const threadTimelineItems = input.threadSignals
		? buildSpaceTimelineItems({
				envelopes: input.threadSignals,
				membersSnapshot: input.membersSnapshot,
			})
		: [];
	return [...(input.timelineItems ?? []), ...threadTimelineItems].map(
		(item) => item.text
	);
}
