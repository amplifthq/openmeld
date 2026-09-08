import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	readSpaceConversationPosition,
	writeSpaceConversationPosition,
} from "#/lib/space-conversation-position";
import { notifyResizeObservers } from "#/test-support/dom-observers.setup";
import { useSpaceConversationPosition } from "./use-space-conversation-position";

vi.mock("@tanstack/react-router", () => ({
	useElementScrollRestoration: () => undefined,
}));
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

it("restores after history arrives and keeps the same message when an image changes layout", () => {
	const f = fixture();
	writeSpaceConversationPosition(f.key, {
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 20,
	});
	const { result, rerender } = renderHook(useSpaceConversationPosition, {
		initialProps: { ...f.input, historyIsPending: true },
	});
	expect(result.current.defaultScrollPosition).toBe("start");
	act(() => vi.advanceTimersByTime(40));
	expect(f.input.viewport.scrollTop).toBe(0);
	rerender({ ...f.input, historyIsPending: false });
	act(() => vi.advanceTimersByTime(40));
	expect(f.input.viewport.scrollTop).toBe(780);
	f.moveMessage(1100);
	act(() => {
		notifyResizeObservers(f.message);
		vi.advanceTimersByTime(40);
	});
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

it("loads earlier history for an anchor outside the latest page", async () => {
	const f = fixture();
	writeSpaceConversationPosition(f.key, {
		anchorSignalId: "message-a",
		offsetFromVisibleTop: 20,
	});
	const { rerender } = renderHook(useSpaceConversationPosition, {
		initialProps: {
			...f.input,
			hasEarlierHistory: true,
			messageElementsRef: { current: new Map<string, HTMLElement>() },
		},
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(40);
	});
	expect(f.input.onLoadEarlierHistory).toHaveBeenCalledOnce();
	rerender({ ...f.input, historyVersion: 2, hasEarlierHistory: false });
	act(() => vi.advanceTimersByTime(40));
	expect(f.input.viewport.scrollTop).toBe(780);
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
