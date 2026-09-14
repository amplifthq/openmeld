import { useCallback, useEffect, useMemo, useState } from "react";
import {
	clearSpaceThreadPanelSelection,
	readSpaceThreadPanelSelection,
	writeSpaceThreadPanelSelection,
} from "#/lib/spaces/thread-panel-storage";

type SpaceThreadPanelSelection = {
	profileId: string;
	spaceId: string;
	threadId: string | null;
	rootSignalId?: string | null;
};

export function useSpaceThreadPanelSelection(input: {
	availableThreadIds: ReadonlySet<string>;
	availableThreadsReady: boolean;
	profileId: string;
	spaceId: string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	threadIdsByRootSignalId?: ReadonlyMap<string, string>;
}) {
	const initialFocus = useMemo(
		() => ({
			rootSignalId: input.initialFocusThreadRootSignalId,
			signalId: input.initialFocusSignalId,
		}),
		[input.initialFocusThreadRootSignalId, input.initialFocusSignalId]
	);
	const [selection, setSelection] = useState<SpaceThreadPanelSelection>(() => ({
		profileId: input.profileId,
		spaceId: input.spaceId,
		threadId: input.initialFocusThreadRootSignalId
			? null
			: readSelectionForSpace(input.spaceId),
		rootSignalId: input.initialFocusThreadRootSignalId ?? null,
	}));
	const activeThreadId =
		selection.profileId === input.profileId &&
		selection.spaceId === input.spaceId
			? (selection.threadId ??
				input.threadIdsByRootSignalId?.get(selection.rootSignalId ?? "") ??
				null)
			: null;
	const requestedRootSignalId =
		selection.profileId === input.profileId &&
		selection.spaceId === input.spaceId
			? (selection.rootSignalId ?? null)
			: null;

	useEffect(() => {
		if (!initialFocus.rootSignalId) {
			return;
		}
		setSelection({
			profileId: input.profileId,
			spaceId: input.spaceId,
			threadId: null,
			rootSignalId: initialFocus.rootSignalId,
		});
	}, [input.profileId, input.spaceId, initialFocus]);

	useEffect(() => {
		if (requestedRootSignalId && activeThreadId) {
			writeSpaceThreadPanelSelection({
				spaceId: input.spaceId,
				threadId: activeThreadId,
			});
		}
	}, [requestedRootSignalId, activeThreadId, input.spaceId]);

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
			requestedRootSignalId !== null ||
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
		requestedRootSignalId,
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
	const openRoot = useCallback(
		(rootSignalId: string) => {
			setSelection({
				profileId: input.profileId,
				spaceId: input.spaceId,
				threadId: null,
				rootSignalId,
			});
		},
		[input.profileId, input.spaceId]
	);

	return {
		activeThreadId,
		requestedRootSignalId,
		isOpen: activeThreadId !== null || requestedRootSignalId !== null,
		openRoot,
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
