import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	readSpaceConversationPosition,
	writeSpaceConversationPosition,
} from "#/lib/space-conversation-position";
import { notifyResizeObservers } from "#/test-support/dom-observers.setup";
import { useSpaceConversationPosition } from "./use-space-conversation-position";

beforeEach(() => {
	vi.useFakeTimers();
	sessionStorage.clear();
	localStorage.clear();
});
afterEach(() => {
	cleanup();
	document.body.replaceChildren();
	vi.useRealTimers();
});

function fixture() {
	const viewport = document.createElement("div");
	const message = document.createElement("div");
	message.dataset.signalId = "message-a";
	message.dataset.historySignalId = "message-a";
	viewport.appendChild(message);
	document.body.appendChild(viewport);
	let messageTop = 800;
	Object.defineProperties(viewport, {
		scrollHeight: { value: 2000 },
		clientHeight: { value: 500 },
	});
	viewport.getBoundingClientRect = () => ({ top: 0, bottom: 500 }) as DOMRect;
	message.getBoundingClientRect = () =>
		({
			top: messageTop - viewport.scrollTop,
			bottom: messageTop + 200 - viewport.scrollTop,
		}) as DOMRect;
	const input = {
		historyIsPending: false,
		isLiveHistory: true,
		hasEarlierHistory: false,
		isLoadingEarlierHistory: false,
		historyVersion: 1,
		onLoadEarlierHistory: vi.fn(async () => undefined),
		historyError: null,
		hasExplicitFocus: false,
		messageElementsRef: { current: new Map([["message-a", message]]) },
		restorationId: "space-conversation:a",
		selfProfileId: "human-a",
		viewport,
	};
	return {
		input,
		message,
		moveMessage: (top: number) => {
			messageTop = top;
		},
		key: "human-a:space-conversation:a",
	};
}

it.each([
	true,
	false,
])("restores before the next frame and preserves image layout changes (history pending: %s)", (historyIsPending) => {
	const f = fixture();
	writeSpaceConversationPosition(f.key, {
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 20,
	});
	const { result, rerender } = renderHook(useSpaceConversationPosition, {
		initialProps: { ...f.input, historyIsPending },
	});
	expect(result.current.defaultScrollPosition).toBe("start");
	if (historyIsPending) {
		expect(f.input.viewport.scrollTop).toBe(0);
		rerender({ ...f.input, historyIsPending: false });
	}
	// Cached or newly mounted history must be aligned before a frame can paint.
	expect(f.input.viewport.scrollTop).toBe(780);
	f.moveMessage(1100);
	act(() => {
		notifyResizeObservers(f.message);
	});
	// ResizeObserver runs after layout, before paint. Waiting for another frame
	// exposes the displaced message for one paint when deferred rows expand.
	expect(f.input.viewport.scrollTop).toBe(1080);
	// A deliberate user scroll takes ownership back; later layout cannot undo it.
	fireEvent.wheel(f.input.viewport);
	f.input.viewport.scrollTop = 900;
	act(() => result.current.onScroll(f.input.viewport));
	f.moveMessage(1300);
	act(() => {
		notifyResizeObservers(f.message);
		vi.advanceTimersByTime(40);
	});
	expect(f.input.viewport.scrollTop).toBe(900);
});

it("releases a restored reading position when the user sends and follows the latest message", () => {
	const f = fixture();
	writeSpaceConversationPosition(f.key, {
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 20,
	});
	const { result, rerender } = renderHook(useSpaceConversationPosition, {
		initialProps: f.input,
	});
	act(() => vi.advanceTimersByTime(40));
	expect(f.input.viewport.scrollTop).toBe(780);
	act(() => result.current.followLatest());
	f.input.viewport.scrollTop = 1500;
	rerender({ ...f.input, historyVersion: 2 });
	f.moveMessage(1100);
	act(() => {
		notifyResizeObservers(f.message);
		vi.advanceTimersByTime(40);
	});
	expect(f.input.viewport.scrollTop).toBe(1500);
	expect(result.current.autoScroll).toBe(true);
});

it("does not block or move the reader when the saved anchor is no longer cached", async () => {
	const f = fixture();
	writeSpaceConversationPosition(f.key, {
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 20,
	});
	const { result, rerender } = renderHook(useSpaceConversationPosition, {
		initialProps: {
			...f.input,
			hasEarlierHistory: true,
			messageElementsRef: { current: new Map<string, HTMLElement>() },
		},
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(40);
	});
	expect(f.input.onLoadEarlierHistory).not.toHaveBeenCalled();
	expect(result.current.restorationStatus).toBe("ready");
	f.input.viewport.scrollTop = 200;
	act(() => {
		result.current.onScroll(f.input.viewport);
		vi.advanceTimersByTime(150);
	});
	expect(readSpaceConversationPosition(f.key)).not.toEqual({
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 20,
	});
	rerender({ ...f.input, historyVersion: 2 });
});

it("saves before navigation without waiting for scrollend, and keeps different Spaces independent", () => {
	const f = fixture();
	const { result, unmount } = renderHook(useSpaceConversationPosition, {
		initialProps: f.input,
	});
	act(() => vi.advanceTimersByTime(40));
	f.input.viewport.scrollTop = 850;
	act(() => result.current.onScroll(f.input.viewport));
	unmount();
	expect(readSpaceConversationPosition(f.key)).toEqual({
		anchorSignalId: "message-a",
		offsetFromVisibleTop: -50,
	});
	expect(
		readSpaceConversationPosition("human-a:space-conversation:b")
	).toBeNull();
});

it.each([
	true,
	false,
])("distinguishes the live bottom from a historical window's bottom (live: %s)", (isLiveHistory) => {
	const f = fixture();
	f.input.isLiveHistory = isLiveHistory;
	const first = renderHook(useSpaceConversationPosition, {
		initialProps: f.input,
	});
	f.input.viewport.scrollTop = 1500;
	act(() => first.result.current.onScrollEnd(f.input.viewport));
	first.unmount();
	f.input.viewport.scrollTop = 0;
	const returned = renderHook(useSpaceConversationPosition, {
		initialProps: f.input,
	});
	expect(returned.result.current.defaultScrollPosition).toBe(
		isLiveHistory ? "end" : "start"
	);
	expect(returned.result.current.autoScroll).toBe(isLiveHistory);
	returned.unmount();
	const focused = renderHook(useSpaceConversationPosition, {
		initialProps: { ...f.input, hasExplicitFocus: true },
	});
	// Explicit focus does not restore the saved anchor over the jump controller.
	f.input.viewport.scrollTop = 400;
	act(() => notifyResizeObservers(f.message));
	expect(f.input.viewport.scrollTop).toBe(400);
	expect(focused.result.current.restorationStatus).toBe("ready");
});

it("waits for a scroll pause before measuring and ignores callback identity changes", () => {
	const f = fixture();
	const measure = vi.spyOn(f.message, "getBoundingClientRect");
	const { result, rerender } = renderHook(useSpaceConversationPosition, {
		initialProps: f.input,
	});
	act(() => vi.advanceTimersByTime(40));
	measure.mockClear();
	for (let step = 0; step < 10; step++) {
		f.input.viewport.scrollTop = 800 + step * 5;
		act(() => {
			result.current.onScroll(f.input.viewport);
			vi.advanceTimersByTime(16);
		});
		rerender({
			...f.input,
			onLoadEarlierHistory: vi.fn(async () => undefined),
		});
	}
	expect(measure).not.toHaveBeenCalled();
	act(() => vi.advanceTimersByTime(150));
	expect(readSpaceConversationPosition(f.key)).toEqual({
		anchorSignalId: "message-a",
		offsetFromVisibleTop: -45,
	});
});

it("does not loop when a focused conversation receives a new history reference on render", () => {
	const f = fixture();
	const { result } = renderHook(() =>
		useSpaceConversationPosition({
			...f.input,
			hasExplicitFocus: true,
			historyVersion: {},
		})
	);
	expect(result.current.restorationStatus).toBe("ready");
});

it("does not restart completed restoration when history references change on render", () => {
	const f = fixture();
	writeSpaceConversationPosition(f.key, {
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 20,
	});
	const { result } = renderHook(() =>
		useSpaceConversationPosition({ ...f.input, historyVersion: {} })
	);
	expect(result.current.restorationStatus).toBe("ready");
	expect(f.input.viewport.scrollTop).toBe(780);
});

it("falls back without fetching when a recorded anchor was evicted", async () => {
	const f = fixture();
	const stream = document.createElement("div");
	stream.dataset.signalId = "stream:submission-reading-position";
	stream.getBoundingClientRect = () =>
		({
			top: 1000 - f.input.viewport.scrollTop,
			bottom: 1800 - f.input.viewport.scrollTop,
		}) as DOMRect;
	f.input.viewport.appendChild(stream);
	const first = renderHook(useSpaceConversationPosition, {
		initialProps: f.input,
	});
	act(() => vi.advanceTimersByTime(40));
	f.input.viewport.scrollTop = 1100;
	act(() => first.result.current.onScrollEnd(f.input.viewport));
	first.unmount();
	expect(readSpaceConversationPosition(f.key)).toEqual({
		anchorSignalId: "message-a",
		offsetFromVisibleTop: -300,
	});
	stream.remove();
	f.input.viewport.scrollTop = 0;
	const onLoadHistoryAround = vi.fn(async () => true);
	renderHook(useSpaceConversationPosition, {
		initialProps: {
			...f.input,
			hasEarlierHistory: true,
			messageElementsRef: { current: new Map<string, HTMLElement>() },
			onLoadHistoryAround,
		},
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(40);
	});
	expect(onLoadHistoryAround).not.toHaveBeenCalled();
	expect(f.input.viewport.scrollTop).toBe(0);
});

it("mounts without a second render or a layout read when nothing needs restoring", () => {
	const f = fixture();
	const measure = vi.spyOn(f.message, "getBoundingClientRect");
	let renders = 0;
	const { result, rerender } = renderHook(
		(props: typeof f.input) => {
			renders += 1;
			return useSpaceConversationPosition(props);
		},
		{ initialProps: f.input }
	);
	expect(renders).toBe(1);
	expect(result.current.restorationStatus).toBe("ready");
	// New history only re-observes message rows; it must not force a layout
	// read by saving the reading position after every DOM mutation.
	rerender({ ...f.input, historyVersion: 2 });
	rerender({ ...f.input, historyVersion: 3 });
	expect(renders).toBe(3);
	expect(measure).not.toHaveBeenCalled();
});

it("keeps each Space's reading position when the same viewport switches Spaces", () => {
	const f = fixture();
	writeSpaceConversationPosition("human-a:space-conversation:b", {
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 100,
	});
	const { result, rerender } = renderHook(useSpaceConversationPosition, {
		initialProps: f.input,
	});
	act(() => vi.advanceTimersByTime(40));
	f.input.viewport.scrollTop = 850;
	act(() => result.current.onScroll(f.input.viewport));
	rerender({ ...f.input, restorationId: "space-conversation:b" });
	// Leaving Space A saves its pending position before B takes the viewport.
	expect(readSpaceConversationPosition(f.key)).toEqual({
		anchorSignalId: "message-a",
		offsetFromVisibleTop: -50,
	});
	// Space B restores its own anchor rather than inheriting the A scroll.
	expect(f.input.viewport.scrollTop).toBe(700);
	expect(result.current.restorationStatus).toBe("ready");
	expect(readSpaceConversationPosition("human-a:space-conversation:b")).toEqual(
		{ anchorSignalId: "message-a", offsetFromVisibleTop: 100 }
	);
});
