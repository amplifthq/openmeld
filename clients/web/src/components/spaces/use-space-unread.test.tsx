import type { SignalEnvelope } from "@openmeld/schemas/types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceUnread } from "./use-space-unread";

describe("useSpaceUnread", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
	});

	afterEach(() => vi.useRealTimers());

	it("derives the main unread boundary only from Core Inbox targets", () => {
		const { result } = renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40), textSignal(50, "thread-reply")],
				isReady: true,
				profileId: "profile-1",
				spaceId: "space-1",
				targets: [
					{
						occurredAtMs: 40,
						signalId: "main-message",
						threadRootSignalId: null,
					},
					{
						occurredAtMs: 50,
						signalId: "thread-reply",
						threadRootSignalId: "thread-root",
					},
				],
			})
		);

		expect(result.current).toMatchObject({
			count: 1,
			firstSignalId: "main-message",
			isReady: true,
		});
	});

	it("marks the main scope read only after latest stays visible for the debounce", async () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40)],
				isReady: true,
				profileId: "profile-1",
				onViewedThroughTs,
				spaceId: "space-1",
				targets: [],
			})
		);

		await act(async () => vi.advanceTimersByTime(150));
		expect(onViewedThroughTs).not.toHaveBeenCalled();
		act(() => result.current.onViewingLatestChange(true));
		await act(async () => {
			vi.advanceTimersByTime(150);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledWith(40);
	});

	it("acknowledges a later reaction to a loaded message without reading another thread or unloaded history", async () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40, "old-message")],
				isReady: true,
				profileId: "profile-1",
				spaceId: "space-1",
				onViewedThroughTs,
				targets: [
					{
						signalId: "old-message",
						occurredAtMs: 100,
						threadRootSignalId: null,
					},
					{ signalId: "unloaded", occurredAtMs: 200, threadRootSignalId: null },
					{
						signalId: "thread-reply",
						occurredAtMs: 300,
						threadRootSignalId: "other-thread",
					},
				],
			})
		);
		act(() => result.current.onViewingLatestChange(true));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});
		expect(onViewedThroughTs).toHaveBeenCalledWith(100);
	});

	it("does not postpone a visible read when the parent rerenders with a new callback", async () => {
		const persist = vi.fn().mockResolvedValue(undefined);
		const { result, rerender } = renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40)],
				isReady: true,
				profileId: "profile-1",
				onViewedThroughTs: (throughTs) => persist(throughTs),
				spaceId: "space-1",
				targets: [],
			})
		);
		act(() => result.current.onViewingLatestChange(true));
		for (let iteration = 0; iteration < 4; iteration += 1) {
			await act(async () => vi.advanceTimersByTime(50));
			rerender();
		}
		expect(persist).toHaveBeenCalledExactlyOnceWith(40);
	});

	it("waits for access confirmation and cancels a pending read if confirmation is withdrawn", async () => {
		const persist = vi.fn().mockResolvedValue(undefined);
		const { result, rerender } = renderHook(
			({ confirmed }) =>
				useSpaceUnread({
					envelopes: [textSignal(40)],
					isReady: true,
					profileId: "profile-1",
					onViewedThroughTs: confirmed ? persist : undefined,
					spaceId: "space-1",
					targets: [],
				}),
			{ initialProps: { confirmed: true } }
		);
		act(() => result.current.onViewingLatestChange(true));
		await act(async () => vi.advanceTimersByTime(75));
		rerender({ confirmed: false });
		await act(async () => vi.advanceTimersByTime(1000));
		expect(persist).not.toHaveBeenCalled();
		rerender({ confirmed: true });
		await act(async () => vi.advanceTimersByTime(150));
		expect(persist).toHaveBeenCalledExactlyOnceWith(40);
	});

	it("cancels read-through when the page becomes hidden", () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40)],
				isReady: true,
				profileId: "profile-1",
				onViewedThroughTs,
				spaceId: "space-1",
				targets: [],
			})
		);
		act(() => {
			result.current.onViewingLatestChange(true);
			vi.advanceTimersByTime(75);
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: "hidden",
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		act(() => {
			vi.advanceTimersByTime(150);
		});
		expect(onViewedThroughTs).not.toHaveBeenCalled();
	});

	it("cancels immediately on scroll away without rerendering the Space", async () => {
		const persist = vi.fn();
		const render = vi.fn();
		const { result } = renderHook(() => {
			render();
			return useSpaceUnread({
				envelopes: [textSignal(40)],
				isReady: true,
				profileId: "profile-1",
				spaceId: "space-1",
				targets: [],
				onViewedThroughTs: persist,
			});
		});
		const initialRenders = render.mock.calls.length;
		act(() => result.current.onViewingLatestChange(true));
		await act(async () => vi.advanceTimersByTime(149));
		act(() => result.current.onViewingLatestChange(false));
		await act(async () => vi.advanceTimersByTime(1000));
		expect(persist).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledTimes(initialRenders);
	});

	it.each([
		"spaceId",
		"profileId",
	] as const)("requires a new measurement after changing %s", async (field) => {
		const persist = vi.fn();
		const { result, rerender } = renderHook(
			(identity) =>
				useSpaceUnread({
					...identity,
					envelopes: [textSignal(40)],
					isReady: true,
					targets: [],
					onViewedThroughTs: persist,
				}),
			{ initialProps: { spaceId: "space-1", profileId: "profile-1" } }
		);
		act(() => result.current.onViewingLatestChange(true));
		await act(async () => vi.advanceTimersByTime(75));
		rerender({
			spaceId: "space-1",
			profileId: "profile-1",
			[field]: "different",
		});
		await act(async () => vi.advanceTimersByTime(1000));
		expect(persist).not.toHaveBeenCalled();
		act(() => result.current.onViewingLatestChange(true));
		await act(async () => vi.advanceTimersByTime(150));
		expect(persist).toHaveBeenCalledExactlyOnceWith(40);
	});

	it("returns to the normal debounce after a retry succeeds", async () => {
		const warning = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const onViewedThroughTs = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const { result, rerender } = renderHook(
			({ envelopes }) =>
				useSpaceUnread({
					envelopes,
					isReady: true,
					profileId: "profile-1",
					onViewedThroughTs,
					spaceId: "space-1",
					targets: [],
				}),
			{ initialProps: { envelopes: [textSignal(40)] } }
		);

		act(() => result.current.onViewingLatestChange(true));
		await act(async () => {
			vi.advanceTimersByTime(150);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledTimes(1);
		await act(async () => {
			vi.advanceTimersByTime(1000);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledTimes(2);

		rerender({ envelopes: [textSignal(40), textSignal(50, "new-main")] });
		await act(async () => vi.advanceTimersByTime(149));
		expect(onViewedThroughTs).toHaveBeenCalledTimes(2);
		await act(async () => {
			vi.advanceTimersByTime(1);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenLastCalledWith(50);
		warning.mockRestore();
	});
});

function textSignal(ts: number, id = "signal-main"): SignalEnvelope {
	return {
		data: { text: "Message" },
		id,
		profile: {
			kind: "agent",
			profileId: "profile-agent",
			profileName: "Agent",
		},
		spaceId: "space-1",
		ts,
		type: "signal.text",
		v: 1,
	} as SignalEnvelope;
}
