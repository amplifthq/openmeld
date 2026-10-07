import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceLiveNotice } from "./space-live-notice";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it.each([
	"degraded",
	"stale",
] as const)("keeps brief %s recovery silent and offers retry only for sustained interruption", (liveState) => {
	vi.useFakeTimers();
	const onRetry = vi.fn();
	const view = render(
		<SpaceLiveNotice liveState={liveState} onRetry={onRetry} />
	);
	act(() => vi.advanceTimersByTime(14_999));
	expect(
		screen.queryByText("Messages and activity may be out of date.")
	).toBeNull();
	view.rerender(<SpaceLiveNotice liveState="connected" onRetry={onRetry} />);
	act(() => vi.advanceTimersByTime(15_000));
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

	view.rerender(<SpaceLiveNotice liveState={liveState} onRetry={onRetry} />);
	act(() => vi.advanceTimersByTime(15_000));
	expect(
		screen.getByText("Messages and activity may be out of date.")
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(onRetry).toHaveBeenCalledOnce();
	expect(
		screen.getByText("Messages and activity may be out of date.")
	).toBeTruthy();
	view.rerender(
		<SpaceLiveNotice hidden liveState={liveState} onRetry={onRetry} />
	);
	expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	view.rerender(<SpaceLiveNotice liveState="connected" onRetry={onRetry} />);
	expect(
		screen.queryByText("Messages and activity may be out of date.")
	).toBeNull();
});
