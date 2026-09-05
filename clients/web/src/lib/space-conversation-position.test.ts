import { afterEach, expect, it, vi } from "vitest";
import {
	clearSpaceConversationPositions,
	readSpaceConversationPosition,
	writeSpaceConversationPosition,
} from "./space-conversation-position";

afterEach(() => {
	window.sessionStorage.clear();
	window.localStorage.clear();
	vi.useRealTimers();
});
it("restores after a new browser session while keeping each live tab's own position", () => {
	writeSpaceConversationPosition("profile:space", {
		anchorSignalId: "earlier",
		offsetFromVisibleTop: 8,
	});
	window.localStorage.setItem(
		"openmeld:space-conversation-position:v2:profile:space",
		JSON.stringify({
			savedAt: Date.now(),
			position: { anchorSignalId: "later", offsetFromVisibleTop: 4 },
		})
	);
	expect(readSpaceConversationPosition("profile:space")?.anchorSignalId).toBe(
		"earlier"
	);
	window.sessionStorage.clear();
	expect(readSpaceConversationPosition("profile:space")?.anchorSignalId).toBe(
		"later"
	);
	expect(readSpaceConversationPosition("other:space")).toBeNull();
});
it("expires durable positions and clears both storage layers at the auth boundary", () => {
	vi.useFakeTimers();
	writeSpaceConversationPosition("profile:space", {
		anchorSignalId: "message",
		offsetFromVisibleTop: 8,
	});
	window.sessionStorage.clear();
	vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
	expect(readSpaceConversationPosition("profile:space")).toBeNull();
	clearSpaceConversationPositions();
	expect(window.localStorage.length).toBe(0);
});
