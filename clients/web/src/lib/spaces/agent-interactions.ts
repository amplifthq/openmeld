import type { WakeProgressItem } from "@openmeld/schemas/types";
import type { SpaceTimelineItem } from "./timeline";
import {
	matchesSpaceMessageWakeProgressItem,
	resolveSpaceMessageWakeTargetProfileIds,
} from "./wake-stop-target";

export function resolveSpaceMessageAgentInteractionItems(input: {
	sourceItem: SpaceTimelineItem;
	wakeProgressItems: readonly WakeProgressItem[];
}): readonly WakeProgressItem[] {
	const targetProfileIds = new Set(
		resolveSpaceMessageWakeTargetProfileIds({
			sourceItem: input.sourceItem,
			wakeProgressItems: input.wakeProgressItems,
		})
	);
	if (targetProfileIds.size === 0) {
		return [];
	}

	return input.wakeProgressItems
		.filter(
			(item) =>
				item.pendingInteraction !== null &&
				item.pendingInteraction !== undefined &&
				matchesSpaceMessageWakeProgressItem({
					item,
					sourceItem: input.sourceItem,
					targetProfileIds,
				})
		)
		.sort(
			(left, right) =>
				(left.pendingInteraction?.requestedAtMs ?? 0) -
				(right.pendingInteraction?.requestedAtMs ?? 0)
		);
}
