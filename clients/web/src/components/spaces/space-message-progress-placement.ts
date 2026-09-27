import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export function shouldPlaceSpaceMessageProgressInAnswer(
	item: Pick<
		SpaceTimelineItem,
		"actorProfileKind" | "agentStreamState" | "activeWakeProgress"
	>
): boolean {
	return (
		item.actorProfileKind === "agent" ||
		item.activeWakeProgress !== undefined ||
		item.agentStreamState?.status === "streaming"
	);
}
