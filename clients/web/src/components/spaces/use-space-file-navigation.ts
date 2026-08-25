"use client";

import { useCallback, useState } from "react";
import type { SpaceFileLeaveGuard } from "./space-file-detail";
import type { SpaceView } from "./space-view";

type SpaceFileOpenRequest = {
	fileId: string;
	requestId: string;
	revision?: number;
};

type PendingSpaceNavigation =
	| { kind: "file"; fileId: string; revision: number }
	| { kind: "view"; view: SpaceView };

/**
 * Keeps Space tab changes and chat-to-file links on one guarded path so a
 * person never loses an in-progress file edit by navigating elsewhere.
 */
export function useSpaceFileNavigation(
	initialView: SpaceView = "messages",
	onViewCommitted?: (view: SpaceView) => void
) {
	const [spaceView, setSpaceView] = useState<SpaceView>(initialView);
	const [spaceFileToOpen, setSpaceFileToOpen] =
		useState<SpaceFileOpenRequest | null>(null);
	const [leaveGuard, setLeaveGuard] = useState<SpaceFileLeaveGuard | null>(
		null
	);
	const [pendingNavigation, setPendingNavigation] =
		useState<PendingSpaceNavigation | null>(null);
	const shouldProtectDraft =
		spaceView === "files" && leaveGuard?.hasUnsavedChanges === true;

	const commitNavigation = useCallback(
		(intent: PendingSpaceNavigation) => {
			const committedView = intent.kind === "file" ? "files" : intent.view;
			if (intent.kind === "file") {
				setSpaceFileToOpen({
					fileId: intent.fileId,
					requestId: crypto.randomUUID(),
					revision: intent.revision,
				});
			}
			setSpaceView(committedView);
			setPendingNavigation(null);
			onViewCommitted?.(committedView);
		},
		[onViewCommitted]
	);

	const changeSpaceView = useCallback(
		(view: SpaceView) => {
			if (view === spaceView) {
				return;
			}
			const intent: PendingSpaceNavigation = { kind: "view", view };
			if (shouldProtectDraft) {
				setPendingNavigation(intent);
				return;
			}
			commitNavigation(intent);
		},
		[commitNavigation, shouldProtectDraft, spaceView]
	);
	const openSpaceFile = useCallback(
		(fileId: string, revision: number) => {
			const intent: PendingSpaceNavigation = {
				fileId,
				kind: "file",
				revision,
			};
			if (shouldProtectDraft) {
				setPendingNavigation(intent);
				return;
			}
			commitNavigation(intent);
		},
		[commitNavigation, shouldProtectDraft]
	);
	const cancelPendingNavigation = useCallback(
		() => setPendingNavigation(null),
		[]
	);
	const discardAndContinue = useCallback(() => {
		if (!pendingNavigation) {
			return;
		}
		leaveGuard?.discard();
		commitNavigation(pendingNavigation);
	}, [commitNavigation, leaveGuard, pendingNavigation]);
	const saveAndContinue = useCallback(async (): Promise<boolean> => {
		if (!(pendingNavigation && leaveGuard)) {
			return false;
		}
		const saved = await leaveGuard.save();
		if (saved) {
			commitNavigation(pendingNavigation);
		}
		return saved;
	}, [commitNavigation, leaveGuard, pendingNavigation]);
	const saveCurrentFile = useCallback(
		async () => (leaveGuard ? await leaveGuard.save() : false),
		[leaveGuard]
	);

	return {
		cancelPendingNavigation,
		changeSpaceView,
		discardAndContinue,
		hasUnsavedFileChanges: shouldProtectDraft,
		openSpaceFile,
		pendingNavigation,
		saveAndContinue,
		saveCurrentFile,
		setSpaceFileLeaveGuard: setLeaveGuard,
		spaceFileToOpen,
		spaceView,
	};
}
