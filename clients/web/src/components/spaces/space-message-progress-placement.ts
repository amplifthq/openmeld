import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export function shouldPlaceSpaceMessageProgressInAnswer(
	item: Pick<
		SpaceTimelineItem,
		"agentStreamState" | "optimisticAgentReplyProgress"
	>
): boolean {
	return (
		item.optimisticAgentReplyProgress !== undefined ||
		item.agentStreamState?.status === "streaming"
	);
}
