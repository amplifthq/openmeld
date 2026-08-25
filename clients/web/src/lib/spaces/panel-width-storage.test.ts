import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clampSpacePanelWidth,
	readSpacePanelWidth,
	resolveSpacePanelWidthStorageKey,
	SPACE_PANEL_WIDTH_METRICS,
	writeSpacePanelWidth,
} from "./panel-width-storage";

afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("space panel width storage", () => {
	it("uses the product-defined Members and Thread resize limits", () => {
		expect(SPACE_PANEL_WIDTH_METRICS.members.minWidth).toBe("17rem");
		expect(SPACE_PANEL_WIDTH_METRICS.members.defaultWidth).toBe(
			SPACE_PANEL_WIDTH_METRICS.members.minWidth
		);
		expect(SPACE_PANEL_WIDTH_METRICS.thread.maxWidth).toBe("30rem");
	});

	it("keeps Members widths independent by Space and separate from Thread", () => {
		writeSpacePanelWidth({
			panel: "members",
			spaceId: "space-a",
			width: "24rem",
		});
		writeSpacePanelWidth({
			panel: "members",
			spaceId: "space-b",
			width: "30rem",
		});
		writeSpacePanelWidth({ panel: "thread", width: "29rem" });

		expect(readSpacePanelWidth({ panel: "members", spaceId: "space-a" })).toBe(
			"24rem"
		);
		expect(readSpacePanelWidth({ panel: "members", spaceId: "space-b" })).toBe(
			"30rem"
		);
		expect(readSpacePanelWidth({ panel: "thread" })).toBe("29rem");
		expect(
			window.localStorage.getItem(
				resolveSpacePanelWidthStorageKey({
					panel: "members",
					spaceId: "space-a",
				})
			)
		).toBe("24rem");
	});

	it("clamps stale saved widths to the current panel limits", () => {
		window.localStorage.setItem(
			resolveSpacePanelWidthStorageKey({
				panel: "members",
				spaceId: "space-a",
			}),
			"80rem"
		);
		window.localStorage.setItem(
			resolveSpacePanelWidthStorageKey({ panel: "thread" }),
			"8rem"
		);

		expect(readSpacePanelWidth({ panel: "members", spaceId: "space-a" })).toBe(
			SPACE_PANEL_WIDTH_METRICS.members.maxWidth
		);
		expect(readSpacePanelWidth({ panel: "thread" })).toBe(
			SPACE_PANEL_WIDTH_METRICS.thread.minWidth
		);
	});

	it("removes malformed values and restores the panel default", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const key = resolveSpacePanelWidthStorageKey({ panel: "thread" });
		window.localStorage.setItem(key, "wide");

		expect(readSpacePanelWidth({ panel: "thread" })).toBe(
			SPACE_PANEL_WIDTH_METRICS.thread.defaultWidth
		);
		expect(window.localStorage.getItem(key)).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("keeps width preferences usable when browser storage is blocked", () => {
		const readWarn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("Storage is blocked.", "SecurityError");
		});

		expect(readSpacePanelWidth({ panel: "members", spaceId: "space-a" })).toBe(
			SPACE_PANEL_WIDTH_METRICS.members.defaultWidth
		);
		expect(readWarn).toHaveBeenCalledOnce();

		vi.restoreAllMocks();
		const writeWarn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("Storage is full.", "QuotaExceededError");
		});

		expect(
			writeSpacePanelWidth({
				panel: "members",
				spaceId: "space-a",
				width: "30rem",
			})
		).toBe("30rem");
		expect(writeWarn).toHaveBeenCalledOnce();
	});

	it("preserves the candidate unit while clamping", () => {
		expect(clampSpacePanelWidth({ panel: "members", width: "999px" })).toBe(
			"512px"
		);
		expect(clampSpacePanelWidth({ panel: "members", width: "100px" })).toBe(
			"272px"
		);
		expect(clampSpacePanelWidth({ panel: "thread", width: "100px" })).toBe(
			"352px"
		);
		expect(clampSpacePanelWidth({ panel: "thread", width: "999px" })).toBe(
			"480px"
		);
	});
});
