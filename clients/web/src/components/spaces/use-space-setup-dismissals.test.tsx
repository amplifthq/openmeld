import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSpaceSetupDismissals } from "./use-space-setup-dismissals";

const scope = { userId: "member-one", orgSlug: "studio", spaceId: "planning" };
beforeEach(() => localStorage.clear());
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("retains each dismissal after remount, shares it with another consumer, and persists recall", () => {
	const first = renderHook(() => useSpaceSetupDismissals(scope));
	const second = renderHook(() => useSpaceSetupDismissals(scope));
	act(() => first.result.current.dismiss("connect_this_computer"));
	expect(second.result.current.dismissedIds).toEqual(
		new Set(["connect_this_computer"])
	);
	first.unmount();
	const reopened = renderHook(() => useSpaceSetupDismissals(scope));
	expect(reopened.result.current.dismissedIds).toEqual(
		new Set(["connect_this_computer"])
	);
	act(() => reopened.result.current.dismiss("bring_agents"));
	expect(reopened.result.current.dismissedIds.size).toBe(2);
	act(() => second.result.current.recall());
	expect(reopened.result.current.dismissedIds.size).toBe(0);
	expect(localStorage.length).toBe(0);
});

it("isolates accounts, organizations, and Spaces when the mounted component changes scope", () => {
	const hook = renderHook(useSpaceSetupDismissals, { initialProps: scope });
	act(() => hook.result.current.dismiss("bring_agents"));
	for (const other of [
		{ ...scope, userId: "member-two" },
		{ ...scope, orgSlug: "other" },
		{ ...scope, spaceId: "other" },
	]) {
		hook.rerender(other);
		expect(hook.result.current.dismissedIds.size).toBe(0);
	}
	hook.rerender(scope);
	expect(hook.result.current.dismissedIds.has("bring_agents")).toBe(true);
});

it("keeps dismissal usable when localStorage cannot accept writes", () => {
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new DOMException("Full", "QuotaExceededError");
	});
	const hook = renderHook(() =>
		useSpaceSetupDismissals({ ...scope, spaceId: "blocked-storage" })
	);
	act(() => hook.result.current.dismiss("bring_agents"));
	expect(hook.result.current.dismissedIds.has("bring_agents")).toBe(true);
	act(() => hook.result.current.recall());
	expect(hook.result.current.dismissedIds.size).toBe(0);
});
