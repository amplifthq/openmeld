import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT,
	readSpaceSelfMessageAlignmentPreference,
	SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE,
	SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY,
	writeSpaceSelfMessageAlignmentPreference,
} from "./self-message-alignment-preference";

describe("self message alignment preference", () => {
	beforeEach(() => {
		window.localStorage.clear();
		document.documentElement.removeAttribute(
			SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE
		);
		vi.restoreAllMocks();
	});

	it("defaults to right alignment when no preference was saved", () => {
		expect(DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT).toBe("right");
		expect(readSpaceSelfMessageAlignmentPreference()).toBe("right");
	});

	it("removes an invalid saved value instead of inventing an alignment", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		window.localStorage.setItem(
			SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY,
			"middle"
		);

		expect(readSpaceSelfMessageAlignmentPreference()).toBe("right");
		expect(
			window.localStorage.getItem(SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY)
		).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("persists and applies left alignment immediately", () => {
		writeSpaceSelfMessageAlignmentPreference("left");

		expect(
			window.localStorage.getItem(SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY)
		).toBe("left");
		expect(
			document.documentElement.getAttribute(
				SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE
			)
		).toBe("left");
	});
});
