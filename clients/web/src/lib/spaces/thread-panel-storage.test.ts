import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearSpaceThreadPanelSelection,
	readSpaceThreadPanelSelection,
	resolveSpaceThreadPanelSelectionStorageKey,
	writeSpaceThreadPanelSelection,
} from "./thread-panel-storage";

afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("Thread panel storage", () => {
	it("persists the active Thread for the current Space", () => {
		writeSpaceThreadPanelSelection({
			spaceId: "space-123",
			threadId: "thread-1",
		});

		expect(readSpaceThreadPanelSelection({ spaceId: "space-123" })).toBe(
			"thread-1"
		);
		expect(readSpaceThreadPanelSelection({ spaceId: "space-456" })).toBeNull();
	});

	it("clears the active Thread when the panel closes", () => {
		writeSpaceThreadPanelSelection({
			spaceId: "space-123",
			threadId: "thread-1",
		});

		clearSpaceThreadPanelSelection({ spaceId: "space-123" });

		expect(readSpaceThreadPanelSelection({ spaceId: "space-123" })).toBeNull();
	});

	it("removes invalid empty selections instead of restoring stale state", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const storageKey = resolveSpaceThreadPanelSelectionStorageKey({
			spaceId: "space-123",
		});
		window.localStorage.setItem(storageKey, "   ");

		expect(readSpaceThreadPanelSelection({ spaceId: "space-123" })).toBeNull();
		expect(window.localStorage.getItem(storageKey)).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("keeps Thread selection controls usable when browser storage is blocked", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const blockedStorage = () => {
			throw new DOMException("Storage is blocked.", "SecurityError");
		};
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(blockedStorage);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(blockedStorage);
		vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
			blockedStorage
		);

		expect(readSpaceThreadPanelSelection({ spaceId: "space-123" })).toBeNull();
		expect(() =>
			writeSpaceThreadPanelSelection({
				spaceId: "space-123",
				threadId: "thread-1",
			})
		).not.toThrow();
		expect(() =>
			clearSpaceThreadPanelSelection({ spaceId: "space-123" })
		).not.toThrow();
		expect(warn).toHaveBeenCalledTimes(3);
	});
});
