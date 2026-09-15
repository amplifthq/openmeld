import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	readSpaceSelfMessageAlignmentPreference,
	SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE,
	SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT,
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

	it("starts messages on the left when no preference was saved", () => {
		runInNewContext(SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT, {
			window,
			document,
			console,
		});
		expect(readSpaceSelfMessageAlignmentPreference()).toBe("left");
		expect(
			document.documentElement.getAttribute(
				SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE
			)
		).toBe("left");
	});

	it("removes an invalid saved value instead of inventing an alignment", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		window.localStorage.setItem(
			SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY,
			"middle"
		);

		expect(readSpaceSelfMessageAlignmentPreference()).toBe("left");
		expect(
			window.localStorage.getItem(SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY)
		).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
	});

	it.each([
		"left",
		"right",
	] as const)("preserves an explicit %s selection on startup", (alignment) => {
		writeSpaceSelfMessageAlignmentPreference(alignment);
		document.documentElement.removeAttribute(
			SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE
		);
		runInNewContext(SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT, {
			window,
			document,
			console,
		});
		expect(readSpaceSelfMessageAlignmentPreference()).toBe(alignment);

		expect(
			window.localStorage.getItem(SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY)
		).toBe(alignment);
		expect(
			document.documentElement.getAttribute(
				SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE
			)
		).toBe(alignment);
	});
});
