import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useMemo } from "react";
export type SpaceUnreadState = {
	count: number;
	firstSignalId: string | null;
	isReady: boolean;
};
export function useSpaceUnread(input: {
	isReady: boolean;
	targets: readonly SpaceInboxUnreadTarget[];
}): SpaceUnreadState {
	const mainTargets = useMemo(
		() => input.targets.filter((target) => target.threadRootSignalId === null),
		[input.targets]
	);
	return {
		count: mainTargets.length,
		firstSignalId: mainTargets[0]?.signalId ?? null,
		isReady: input.isReady,
	};
}
