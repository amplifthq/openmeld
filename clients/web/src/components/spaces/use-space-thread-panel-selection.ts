import { useCallback, useEffect, useState } from "react";
import {
	clearSpaceThreadPanelSelection,
	readSpaceThreadPanelSelection,
	writeSpaceThreadPanelSelection,
} from "#/lib/spaces/thread-panel-storage";

type SpaceThreadPanelSelection = {
	profileId: string;
	spaceId: string;
	threadId: string | null;
};

export function useSpaceThreadPanelSelection(input: {
	availableThreadIds: ReadonlySet<string>;
	availableThreadsReady: boolean;
	profileId: string;
	spaceId: string;
}) {
	const [selection, setSelection] = useState<SpaceThreadPanelSelection>(() => ({
		profileId: input.profileId,
		spaceId: input.spaceId,
		threadId: readSelectionForSpace(input.spaceId),
	}));
	const activeThreadId =
		selection.profileId === input.profileId &&
		selection.spaceId === input.spaceId
			? selection.threadId
			: null;

	useEffect(() => {
		if (!(input.profileId.trim() && input.spaceId.trim())) {
			return;
		}

		setSelection((currentSelection) => {
			if (
				currentSelection.profileId === input.profileId &&
				currentSelection.spaceId === input.spaceId
			) {
				return currentSelection;
			}
			return {
				profileId: input.profileId,
				spaceId: input.spaceId,
				threadId: readSpaceThreadPanelSelection({
					spaceId: input.spaceId,
				}),
			};
		});
	}, [input.profileId, input.spaceId]);

	useEffect(() => {
		if (
			activeThreadId === null ||
			!input.availableThreadsReady ||
			input.availableThreadIds.has(activeThreadId)
		) {
			return;
		}

		clearSpaceThreadPanelSelection({ spaceId: input.spaceId });
		setSelection({
			profileId: input.profileId,
			spaceId: input.spaceId,
			threadId: null,
		});
	}, [
		activeThreadId,
		input.availableThreadIds,
		input.availableThreadsReady,
		input.profileId,
		input.spaceId,
	]);

	const close = useCallback(() => {
		clearSpaceThreadPanelSelection({ spaceId: input.spaceId });
		setSelection({
			profileId: input.profileId,
			spaceId: input.spaceId,
			threadId: null,
		});
	}, [input.profileId, input.spaceId]);

	const open = useCallback(
		(threadId: string) => {
			writeSpaceThreadPanelSelection({
				spaceId: input.spaceId,
				threadId,
			});
			setSelection({
				profileId: input.profileId,
				spaceId: input.spaceId,
				threadId,
			});
		},
		[input.profileId, input.spaceId]
	);

	return {
		activeThreadId,
		close,
		open,
	};
}

function readSelectionForSpace(spaceId: string): string | null {
	return spaceId.trim()
		? readSpaceThreadPanelSelection({
				spaceId,
			})
		: null;
}
