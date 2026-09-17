import type { HistoryState } from "@tanstack/react-router";

type InboxSourceFocusState = {
	inboxSourceFocusRequestId?: string;
};

let requestRevision = 0;

export function requestInboxSourceFocus(
	state: HistoryState
): HistoryState & InboxSourceFocusState {
	requestRevision += 1;
	return {
		...state,
		inboxSourceFocusRequestId: `${Date.now().toString(36)}-${requestRevision.toString(36)}`,
	};
}

export function readInboxSourceFocusRequestId(
	state: unknown
): string | undefined {
	if (!state || typeof state !== "object") {
		return undefined;
	}
	const requestId = (state as InboxSourceFocusState).inboxSourceFocusRequestId;
	return typeof requestId === "string" ? requestId : undefined;
}
