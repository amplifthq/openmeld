import { afterEach, describe, expect, it, vi } from "vitest";
import { beginTextClipboardWrite, copyTextToClipboard } from "./clipboard";

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
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("starts a promise-backed clipboard write before the text is ready", async () => {
		const clipboardItem = { text: null as Promise<Blob> | null };
		class TestClipboardItem {
			constructor(input: Record<string, Promise<Blob>>) {
				clipboardItem.text = input["text/plain"] ?? null;
			}
		}
		vi.stubGlobal("ClipboardItem", TestClipboardItem);
		const write = vi.fn(async () => {
			await clipboardItem.text;
		});
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: { write },
		});

		const pendingWrite = beginTextClipboardWrite();

		expect(pendingWrite).not.toBeNull();
		expect(write).toHaveBeenCalledTimes(1);
		expect(clipboardItem.text).not.toBeNull();

		await expect(pendingWrite?.complete("fresh prompt")).resolves.toBe(true);
		const writtenText = await clipboardItem.text;
		if (!writtenText) {
			throw new Error("Expected the ClipboardItem text to resolve.");
		}
		expect(await readBlobAsText(writtenText)).toBe("fresh prompt");
		expect(writtenText.type).toBe("text/plain");
	});

	it("cancels a pending clipboard write before stale text is supplied", async () => {
		let clipboardItemText: Promise<Blob> | null = null;
		class TestClipboardItem {
			constructor(input: Record<string, Promise<Blob>>) {
				clipboardItemText = input["text/plain"] ?? null;
			}
		}
		vi.stubGlobal("ClipboardItem", TestClipboardItem);
		const write = vi.fn(async () => {
			await clipboardItemText;
		});
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: { write },
		});
		const pendingWrite = beginTextClipboardWrite();
		expect(pendingWrite).not.toBeNull();

		pendingWrite?.cancel();

		await expect(pendingWrite?.complete("stale prompt")).resolves.toBe(false);
		expect(write).toHaveBeenCalledTimes(1);
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

async function readBlobAsText(blob: Blob): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("error", () => reject(reader.error));
		reader.addEventListener("load", () => resolve(String(reader.result)));
		reader.readAsText(blob);
	});
}
