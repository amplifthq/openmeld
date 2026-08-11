import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SPACE_CONVERSATION_LAYOUT,
	readSpaceConversationLayoutPreference,
	SPACE_CONVERSATION_LAYOUT_ATTRIBUTE,
	SPACE_CONVERSATION_LAYOUT_STORAGE_KEY,
	writeSpaceConversationLayoutPreference,
} from "./conversation-layout-preference";

describe("conversation layout preference", () => {
	beforeEach(() => {
		window.localStorage.clear();
		document.documentElement.removeAttribute(
			SPACE_CONVERSATION_LAYOUT_ATTRIBUTE
		);
		vi.restoreAllMocks();
	});

	it("defaults to a centered layout when no preference was saved", () => {
		expect(DEFAULT_SPACE_CONVERSATION_LAYOUT).toBe("centered");
		expect(readSpaceConversationLayoutPreference()).toBe("centered");
	});

	it("removes an invalid saved value instead of inventing a layout", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		window.localStorage.setItem(
			SPACE_CONVERSATION_LAYOUT_STORAGE_KEY,
			"narrow-ish"
		);

		expect(readSpaceConversationLayoutPreference()).toBe(
			DEFAULT_SPACE_CONVERSATION_LAYOUT
		);
		expect(
			window.localStorage.getItem(SPACE_CONVERSATION_LAYOUT_STORAGE_KEY)
		).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("persists and applies a centered layout immediately", () => {
		writeSpaceConversationLayoutPreference("centered");

		expect(
			window.localStorage.getItem(SPACE_CONVERSATION_LAYOUT_STORAGE_KEY)
		).toBe("centered");
		expect(
			document.documentElement.getAttribute(SPACE_CONVERSATION_LAYOUT_ATTRIBUTE)
		).toBe("centered");
	});
});
