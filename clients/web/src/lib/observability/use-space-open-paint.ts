import { useEffect } from "react";
import { markSpaceOpen } from "./space-open";

export function spaceOpenFailureMilestone(mode: string) {
	if (mode === "failure") {
		return "failed";
	}
	if (mode === "password") {
		return "denied";
	}
	return null;
}

export function useSpaceConversationOpenPaint(input: {
	spaceId: string | undefined;
	messagesVisible: boolean;
	historyPending: boolean;
	historyError: boolean;
	hasMessages: boolean;
	canEdit: boolean;
	showComposer: boolean;
}) {
	let content: Parameters<typeof markSpaceOpen>[1] | null = null;
	let composer: Parameters<typeof markSpaceOpen>[1] | null = null;
	if (input.messagesVisible) {
		if (!input.historyPending) {
			content = input.hasMessages ? "messages" : "empty";
			if (input.historyError) {
				content = "failed";
			}
		}
		if (!input.canEdit) {
			composer = "read_only";
		} else if (input.showComposer) {
			composer = "editable";
		}
	}
	useSpaceOpenPaint(input.spaceId ?? "", content);
	useSpaceOpenPaint(input.spaceId ?? "", composer);
}

/** A rendered-state observation after a paint opportunity, not a browser paint timestamp. */
export function useSpaceOpenPaint(
	spaceId: string,
	milestone: Parameters<typeof markSpaceOpen>[1] | null
) {
	useEffect(() => {
		if (!milestone) {
			return;
		}
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => {
				if (document.visibilityState === "visible") {
					markSpaceOpen(spaceId, milestone);
				}
			});
		});
		const visible = () => {
			if (document.visibilityState === "visible") {
				second = requestAnimationFrame(() => markSpaceOpen(spaceId, milestone));
			}
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [spaceId, milestone]);
}
