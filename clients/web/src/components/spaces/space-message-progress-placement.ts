import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export function shouldPlaceSpaceMessageProgressInAnswer(
	item: Pick<SpaceTimelineItem, "agentStreamState" | "activeWakeProgress">
): boolean {
	return (
		item.activeWakeProgress !== undefined ||
		item.agentStreamState?.status === "streaming"
	);
}
