import type {
	SpaceInboxUnreadTarget,
	SpaceInboxUnreadTargetsResponse,
} from "@openmeld/schemas/types";
import { useLayoutEffect, useMemo, useState } from "react";
export type SpaceUnreadState = {
	firstSignalId: string | null;
	isReady: boolean;
};
export function useSpaceUnread(input: {
	identity: string;
	isReady: boolean;
	targets: readonly SpaceInboxUnreadTarget[];
	scopes?: SpaceInboxUnreadTargetsResponse["scopes"];
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
	const scopeIsEmpty = input.scopes
		? !input.scopes.some(
				(scope) =>
					scope.threadRootSignalId === (input.threadRootSignalId ?? null) &&
					scope.unreadCount > 0
			)
		: scopedTargets.length === 0;
	const [boundary, setBoundary] = useState<{
		identity: string;
		signalId: string | null;
	} | null>(null);
	const captured = boundary?.identity === input.identity;
	const initialBoundary = input.isReady
		? (scopedTargets[0]?.signalId ?? null)
		: null;
	const nextBoundary = captured ? boundary.signalId : initialBoundary;

	useLayoutEffect(() => {
		if (!input.isReady || (!scopeIsEmpty && scopedTargets.length === 0)) {
			return;
		}
		if (captured) {
			if (scopeIsEmpty && boundary.signalId !== null) {
				setBoundary({ identity: input.identity, signalId: null });
			}
			return;
		}
		setBoundary({ identity: input.identity, signalId: nextBoundary });
	}, [
		boundary,
		captured,
		input.identity,
		nextBoundary,
		input.isReady,
		scopeIsEmpty,
		scopedTargets.length,
	]);

	return {
		firstSignalId: input.isReady && scopeIsEmpty ? null : nextBoundary,
		isReady: input.isReady,
	};
}
