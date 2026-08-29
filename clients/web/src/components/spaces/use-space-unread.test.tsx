import type { SignalEnvelope } from "@openmeld/schemas/types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceUnread } from "./use-space-unread";

const readSpaceCursorLastSeenTsMock = vi.hoisted(() => vi.fn());
const writeSpaceCursorLastSeenTsMock = vi.hoisted(() => vi.fn());

vi.mock("#/query/spaces/cursor", () => ({
	readSpaceCursorLastSeenTs: readSpaceCursorLastSeenTsMock,
	writeSpaceCursorLastSeenTs: writeSpaceCursorLastSeenTsMock,
}));

describe("useSpaceUnread", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		readSpaceCursorLastSeenTsMock.mockReset().mockResolvedValue(null);
		writeSpaceCursorLastSeenTsMock.mockReset().mockResolvedValue(undefined);
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reports the latest visible timestamp only after the user is viewing the latest message", async () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const { rerender } = renderHook(
			({ isViewingLatest }) =>
				useSpaceUnread({
					envelopes: [textSignal(40)],
					isViewingLatest,
					onViewedThroughTs,
					spaceId: "space-center-agent",
					openMeldProfileId: "profile-human",
				}),
			{ initialProps: { isViewingLatest: false } }
		);

		await act(async () => undefined);
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).not.toHaveBeenCalled();

		rerender({ isViewingLatest: true });
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledOnce();
		expect(onViewedThroughTs).toHaveBeenCalledWith(40);
	});

	it("does not expose a false unread boundary before the saved cursor is ready", async () => {
		let resolveCursor: ((value: number | null) => void) | undefined;
		readSpaceCursorLastSeenTsMock.mockReturnValue(
			new Promise<number | null>((resolve) => {
				resolveCursor = resolve;
			})
		);
		const { result } = renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40), textSignal(50, "signal-latest")],
				isViewingLatest: false,
				spaceId: "space-center-agent",
				openMeldProfileId: "profile-human",
			})
		);

		expect(result.current).toEqual({
			count: 0,
			firstSignalId: null,
			isReady: false,
		});

		await act(async () => {
			resolveCursor?.(40);
			await Promise.resolve();
		});

		expect(result.current).toEqual({
			count: 1,
			firstSignalId: "signal-latest",
			isReady: true,
		});
	});

	it("starts a new unread boundary after the previous unread messages are read", async () => {
		const firstUnread = textSignal(40, "signal-first-unread");
		const secondUnread = textSignal(50, "signal-second-unread");
		const nextUnread = textSignal(60, "signal-next-unread");
		const { rerender, result } = renderHook(
			({
				envelopes,
				isViewingLatest,
			}: {
				envelopes: readonly SignalEnvelope[];
				isViewingLatest: boolean;
			}) =>
				useSpaceUnread({
					envelopes,
					isViewingLatest,
					spaceId: "space-center-agent",
					openMeldProfileId: "profile-human",
				}),
			{
				initialProps: {
					envelopes: [firstUnread],
					isViewingLatest: false,
				},
			}
		);

		await act(async () => undefined);
		expect(result.current).toEqual({
			count: 1,
			firstSignalId: "signal-first-unread",
			isReady: true,
		});

		rerender({
			envelopes: [firstUnread, secondUnread],
			isViewingLatest: false,
		});
		expect(result.current).toEqual({
			count: 2,
			firstSignalId: "signal-first-unread",
			isReady: true,
		});

		rerender({
			envelopes: [firstUnread, secondUnread],
			isViewingLatest: true,
		});
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(result.current).toEqual({
			count: 0,
			firstSignalId: null,
			isReady: true,
		});

		rerender({
			envelopes: [firstUnread, secondUnread, nextUnread],
			isViewingLatest: false,
		});
		expect(result.current).toEqual({
			count: 1,
			firstSignalId: "signal-next-unread",
			isReady: true,
		});
	});

	it("reports a seeded latest timestamp to the Core Inbox owner", async () => {
		readSpaceCursorLastSeenTsMock.mockResolvedValue(40);
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40)],
				isViewingLatest: true,
				onViewedThroughTs,
				spaceId: "space-center-agent",
				openMeldProfileId: "profile-human",
			})
		);

		await act(async () => {
			await Promise.resolve();
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});

		expect(onViewedThroughTs).toHaveBeenCalledOnce();
		expect(onViewedThroughTs).toHaveBeenCalledWith(40);
	});

	it("retries an idempotent Core Inbox read after a transient failure", async () => {
		const onViewedThroughTs = vi
			.fn()
			.mockRejectedValueOnce(new Error("Core unavailable"))
			.mockResolvedValue(undefined);
		renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40)],
				isViewingLatest: true,
				onViewedThroughTs,
				spaceId: "space-center-agent",
				openMeldProfileId: "profile-human",
			})
		);

		await act(async () => {
			await Promise.resolve();
			vi.advanceTimersByTime(800);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledOnce();

		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(onViewedThroughTs).toHaveBeenCalledTimes(2);
		expect(onViewedThroughTs).toHaveBeenLastCalledWith(40);
	});

	it("persists to Core when the handler becomes available after the view is ready", async () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const { rerender } = renderHook(
			({ persist }) =>
				useSpaceUnread({
					envelopes: [textSignal(40)],
					isViewingLatest: true,
					onViewedThroughTs: persist,
					spaceId: "space-center-agent",
					openMeldProfileId: "profile-human",
				}),
			{
				initialProps: {
					persist: undefined as
						| ((throughTs: number) => Promise<void>)
						| undefined,
				},
			}
		);

		await act(async () => {
			await Promise.resolve();
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).not.toHaveBeenCalled();

		rerender({ persist: onViewedThroughTs });
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(onViewedThroughTs).toHaveBeenCalledOnce();
		expect(onViewedThroughTs).toHaveBeenCalledWith(40);
	});

	it("does not let a late cursor seed move a newer local read position backwards", async () => {
		let resolveCursor: ((value: number | null) => void) | undefined;
		readSpaceCursorLastSeenTsMock.mockReturnValue(
			new Promise<number | null>((resolve) => {
				resolveCursor = resolve;
			})
		);
		const { rerender, result } = renderHook(
			({ isViewingLatest }) =>
				useSpaceUnread({
					envelopes: [textSignal(50, "signal-latest")],
					isViewingLatest,
					spaceId: "space-center-agent",
					openMeldProfileId: "profile-human",
				}),
			{ initialProps: { isViewingLatest: true } }
		);

		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		await act(async () => {
			resolveCursor?.(40);
			await Promise.resolve();
		});
		rerender({ isViewingLatest: false });

		expect(result.current).toEqual({
			count: 0,
			firstSignalId: null,
			isReady: true,
		});
	});

	it("requires the document and latest position to remain visible for the full debounce", async () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const { rerender } = renderHook(
			({ isViewingLatest }) =>
				useSpaceUnread({
					envelopes: [textSignal(40)],
					isViewingLatest,
					onViewedThroughTs,
					spaceId: "space-center-agent",
					openMeldProfileId: "profile-human",
				}),
			{ initialProps: { isViewingLatest: true } }
		);

		await act(async () => {
			await Promise.resolve();
			vi.advanceTimersByTime(400);
		});
		rerender({ isViewingLatest: false });
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).not.toHaveBeenCalled();

		rerender({ isViewingLatest: true });
		await act(async () => {
			vi.advanceTimersByTime(400);
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: "hidden",
			});
			document.dispatchEvent(new Event("visibilitychange"));
			await Promise.resolve();
		});
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});
		expect(onViewedThroughTs).not.toHaveBeenCalled();
	});

	it("does not mark the Space read when it unmounts before the debounce", async () => {
		const onViewedThroughTs = vi.fn().mockResolvedValue(undefined);
		const { unmount } = renderHook(() =>
			useSpaceUnread({
				envelopes: [textSignal(40)],
				isViewingLatest: true,
				onViewedThroughTs,
				spaceId: "space-center-agent",
				openMeldProfileId: "profile-human",
			})
		);

		await act(async () => {
			await Promise.resolve();
			vi.advanceTimersByTime(400);
		});
		unmount();
		await act(async () => {
			vi.advanceTimersByTime(800);
			await Promise.resolve();
		});

		expect(onViewedThroughTs).not.toHaveBeenCalled();
	});
});

function textSignal(ts: number, id = "signal-center-agent"): SignalEnvelope {
	return {
		data: { text: "Center Agent replied." },
		id,
		profile: {
			kind: "agent",
			profileId: "profile-center-agent",
			profileName: "Center Agent",
		},
		spaceId: "space-center-agent",
		ts,
		type: "signal.text",
		v: 1,
	} as SignalEnvelope;
}
