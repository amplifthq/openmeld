import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export function shouldPlaceSpaceMessageProgressInAnswer(
	item: Pick<
		SpaceTimelineItem,
		"agentStreamState" | "optimisticAgentReplyState"
	>
): boolean {
	return (
		item.optimisticAgentReplyState !== undefined ||
		item.agentStreamState?.status === "streaming"
	);
}
