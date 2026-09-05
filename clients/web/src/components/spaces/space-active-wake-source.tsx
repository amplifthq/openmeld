import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export function SpaceActiveWakeSource(input: {
	item: SpaceTimelineItem;
	onJumpToMessage: (signalId: string) => void;
}) {
	const sourceId = input.item.activeWakeSourceItemId;
	if (!sourceId) {
		return null;
	}
	return (
		<button
			className="w-fit text-muted-foreground text-xs hover:underline focus-visible:underline"
			onClick={() => input.onJumpToMessage(sourceId)}
			type="button"
		>
			View request
		</button>
	);
}
