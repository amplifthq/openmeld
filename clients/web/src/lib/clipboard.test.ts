import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

describe("copyTextToClipboard", () => {
	afterEach(() => {
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: undefined,
		});
		vi.restoreAllMocks();
	});

	it("uses the async clipboard API when it is available", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});

		await expect(copyTextToClipboard("copy me")).resolves.toBe(true);

		expect(writeText).toHaveBeenCalledWith("copy me");
		expect(execCommand).not.toHaveBeenCalled();
	});

	it("falls back to textarea copy when the async clipboard API fails", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});

		await expect(copyTextToClipboard("fallback text")).resolves.toBe(true);

		expect(writeText).toHaveBeenCalledWith("fallback text");
		expect(execCommand).toHaveBeenCalledWith("copy");
		expect(document.querySelector("textarea")).toBeNull();
	});

	it("returns false when no clipboard path is available", async () => {
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: undefined,
		});

		await expect(copyTextToClipboard("manual text")).resolves.toBe(false);
	});
});
