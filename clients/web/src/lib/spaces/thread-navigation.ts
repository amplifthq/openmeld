import type { ListSpaceThreadsResponse } from "@openmeld/schemas/types";

export type SpaceMessageTarget = {
	focusSignalId?: string;
	focusThreadRootSignalId?: string;
};

/** Resolve placement from the owning Space catalog, never from message text. */
export function resolveSpaceThreadTarget(
	catalog: ListSpaceThreadsResponse | undefined,
	target: SpaceMessageTarget
) {
	if (target.focusThreadRootSignalId) {
		return catalog?.threads.find(
			(thread) => thread.rootSignalId === target.focusThreadRootSignalId
		);
	}
	if (!target.focusSignalId) {
		return undefined;
	}
	const preview = catalog?.previews.find((item) =>
		item.placements.some(
			(placement) =>
				placement.signalId === target.focusSignalId &&
				placement.placement === "thread"
		)
	);
	return catalog?.threads.find(
		(thread) => thread.threadId === preview?.threadId
	);
}
