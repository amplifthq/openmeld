import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSidebarDisplayPreference } from "./sidebar-preference";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
	document.documentElement.removeAttribute("data-sidebar-display");
});

it("keeps the rail and both controls aligned when saving a choice fails", () => {
	const menu = renderHook(useSidebarDisplayPreference);
	const appearance = renderHook(useSidebarDisplayPreference);
	const write = vi
		.spyOn(Storage.prototype, "setItem")
		.mockImplementation(() => {
			throw new DOMException("Storage is full", "QuotaExceededError");
		});
	vi.spyOn(console, "warn").mockImplementation(() => undefined);

	act(() => menu.result.current.setDisplay("icons-only"));
	expect(menu.result.current.display).toBe("icons-and-text");
	expect(appearance.result.current.display).toBe("icons-and-text");
	expect(document.documentElement.getAttribute("data-sidebar-display")).toBe(
		"icons-and-text"
	);

	write.mockRestore();
	act(() => appearance.result.current.setDisplay("icons-only"));
	expect(menu.result.current.display).toBe("icons-only");
	expect(appearance.result.current.display).toBe("icons-only");
	expect(document.documentElement.getAttribute("data-sidebar-display")).toBe(
		"icons-only"
	);
});
