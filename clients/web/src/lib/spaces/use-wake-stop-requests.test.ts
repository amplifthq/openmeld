import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useWakeStopRequests } from "./use-wake-stop-requests";

afterEach(cleanup);

it("preserves Stop intent across navigation and isolates accounts and Spaces", () => {
	const profile = crypto.randomUUID();
	const space = crypto.randomUUID();
	const first = renderHook(() => useWakeStopRequests(profile, space));
	act(() =>
		first.result.current[1](
			() => new Map([["client_message:a:b", "cancellation_requested"]])
		)
	);
	first.unmount();
	const reopened = renderHook(() => useWakeStopRequests(profile, space));
	expect(reopened.result.current[0].get("client_message:a:b")).toBe(
		"cancellation_requested"
	);
	const other = renderHook(() =>
		useWakeStopRequests("different-profile", space)
	);
	expect(other.result.current[0].size).toBe(0);
	const otherSpace = renderHook(() =>
		useWakeStopRequests(profile, "different-space")
	);
	expect(otherSpace.result.current[0].size).toBe(0);
});

it("restores an interrupted HTTP request as unconfirmed and retains confirmed receipts", () => {
	const profile = crypto.randomUUID();
	const space = crypto.randomUUID();
	sessionStorage.setItem(
		`openmeld.stop-requests:${JSON.stringify([profile, space])}`,
		JSON.stringify([
			["client_message:pending:b", "cancellation_requested"],
			["client_message:done:b", "cancelled"],
			["invalid", "made-up-status"],
		])
	);
	const restored = renderHook(() => useWakeStopRequests(profile, space));
	expect([...restored.result.current[0]]).toEqual([
		["client_message:pending:b", "delivery_unknown"],
		["client_message:done:b", "cancelled"],
	]);
});
