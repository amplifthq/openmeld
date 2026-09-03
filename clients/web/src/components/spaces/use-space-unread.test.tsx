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
				isViewingLatest: false,
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
		const { rerender } = renderHook(
			({ isViewingLatest }) =>
				useSpaceUnread({
					envelopes: [textSignal(40)],
					isReady: true,
					isViewingLatest,
					onViewedThroughTs,
					spaceId: "space-1",
					targets: [],
				}),
			{ initialProps: { isViewingLatest: false } }
		);

		await act(async () => vi.advanceTimersByTime(800));
		expect(onViewedThroughTs).not.toHaveBeenCalled();
		rerender({ isViewingLatest: true });
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledWith(40);
	});

	it("cancels read-through when the page becomes hidden", () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40)],
				isReady: true,
				isViewingLatest: true,
				onViewedThroughTs,
				spaceId: "space-1",
				targets: [],
			})
		);
		act(() => {
			vi.advanceTimersByTime(400);
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: "hidden",
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		act(() => {
			vi.advanceTimersByTime(800);
		});
		expect(onViewedThroughTs).not.toHaveBeenCalled();
	});

	it("returns to the normal debounce after a retry succeeds", async () => {
		const warning = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const onViewedThroughTs = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const { rerender } = renderHook(
			({ envelopes }) =>
				useSpaceUnread({
					envelopes,
					isReady: true,
					isViewingLatest: true,
					onViewedThroughTs,
					spaceId: "space-1",
					targets: [],
				}),
			{ initialProps: { envelopes: [textSignal(40)] } }
		);

		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledTimes(1);
		await act(async () => {
			vi.advanceTimersByTime(1000);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledTimes(2);

		rerender({ envelopes: [textSignal(40), textSignal(50, "new-main")] });
		await act(async () => vi.advanceTimersByTime(799));
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
