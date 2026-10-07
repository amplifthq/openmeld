import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useImageFrameActivity } from "./use-image-frame-activity";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("keeps one observer across content changes and deactivates offscreen, in the background, and on unmount", () => {
	let callback: IntersectionObserverCallback | undefined;
	let target: Element | undefined;
	const disconnect = vi.fn();
	const observe = vi.fn((element: Element) => {
		target = element;
	});
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(handler: IntersectionObserverCallback) {
				callback = handler;
			}
			observe = observe;
			disconnect = disconnect;
		}
	);
	let visibility: DocumentVisibilityState = "visible";
	vi.spyOn(document, "visibilityState", "get").mockImplementation(
		() => visibility
	);
	function Fixture({ label }: { label: string }) {
		const activity = useImageFrameActivity();
		return (
			<div
				data-active={String(activity.active)}
				data-testid="frame"
				ref={activity.frame}
			>
				{label}
			</div>
		);
	}
	const view = render(<Fixture label="loading" />);
	const element = screen.getByTestId("frame");
	const intersect = (isIntersecting: boolean) =>
		act(() =>
			callback?.(
				[{ target, isIntersecting } as IntersectionObserverEntry],
				{} as IntersectionObserver
			)
		);
	expect(element.dataset.active).toBe("false");
	intersect(true);
	expect(element.dataset.active).toBe("true");
	view.rerender(<Fixture label="ready" />);
	expect(screen.getByTestId("frame")).toBe(element);
	expect(observe).toHaveBeenCalledTimes(1);
	expect(disconnect).not.toHaveBeenCalled();
	intersect(false);
	expect(element.dataset.active).toBe("false");
	intersect(true);
	act(() => {
		visibility = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(element.dataset.active).toBe("false");
	act(() => {
		visibility = "visible";
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(element.dataset.active).toBe("true");
	view.unmount();
	expect(disconnect).toHaveBeenCalledTimes(1);
});
