import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useLayoutEffect, useMemo, useState } from "react";
export type SpaceUnreadState = {
	firstSignalId: string | null;
	isReady: boolean;
};
export function useSpaceUnread(input: {
	identity: string;
	isReady: boolean;
	targets: readonly SpaceInboxUnreadTarget[];
	threadRootSignalId?: string | null;
}): SpaceUnreadState {
	const scopedTargets = useMemo(
		() =>
			input.targets.filter(
				(target) =>
					target.threadRootSignalId === (input.threadRootSignalId ?? null)
			),
		[input.targets, input.threadRootSignalId]
	);
	const [boundary, setBoundary] = useState<{
		identity: string;
		signalId: string;
	} | null>(null);
	const currentBoundary =
		boundary?.identity === input.identity ? boundary.signalId : null;
	const nextBoundary =
		currentBoundary ??
		(input.isReady ? (scopedTargets[0]?.signalId ?? null) : null);

	useLayoutEffect(() => {
		if (currentBoundary || !nextBoundary) {
			return;
		}
		setBoundary({ identity: input.identity, signalId: nextBoundary });
	}, [currentBoundary, input.identity, nextBoundary]);

	return {
		firstSignalId: nextBoundary,
		isReady: input.isReady,
	};
}
