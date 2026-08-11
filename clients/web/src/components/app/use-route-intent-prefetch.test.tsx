import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ROUTE_INTENT_PREFETCH_DELAY_MS,
	useRouteIntentPrefetch,
} from "./use-route-intent-prefetch";

const { preloadRouteMock } = vi.hoisted(() => ({
	preloadRouteMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ preloadRoute: preloadRouteMock }),
}));

function IntentButton(input: {
	prefetchData?: () => Promise<void>;
	to: string;
}) {
	const intentPrefetch = useRouteIntentPrefetch();
	return (
		<button
			onFocus={() => intentPrefetch.prefetchNow(input.to, input.prefetchData)}
			onPointerDown={() =>
				intentPrefetch.prefetchNow(input.to, input.prefetchData)
			}
			onPointerEnter={() =>
				intentPrefetch.schedule(input.to, input.prefetchData)
			}
			onPointerLeave={() => intentPrefetch.cancel(input.to)}
			type="button"
		>
			Open conversation
		</button>
	);
}

describe("useRouteIntentPrefetch", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		preloadRouteMock.mockReset().mockResolvedValue(undefined);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("waits for deliberate pointer intent and cancels a passing hover", () => {
		const prefetchData = vi.fn(async () => undefined);
		render(
			<IntentButton
				prefetchData={prefetchData}
				to="/o/acme/spaces/space-alpha"
			/>
		);
		const button = screen.getByRole("button", { name: "Open conversation" });

		fireEvent.pointerEnter(button);
		vi.advanceTimersByTime(ROUTE_INTENT_PREFETCH_DELAY_MS - 1);
		expect(preloadRouteMock).not.toHaveBeenCalled();
		expect(prefetchData).not.toHaveBeenCalled();

		fireEvent.pointerLeave(button);
		vi.advanceTimersByTime(ROUTE_INTENT_PREFETCH_DELAY_MS);
		expect(preloadRouteMock).not.toHaveBeenCalled();
		expect(prefetchData).not.toHaveBeenCalled();

		fireEvent.pointerEnter(button);
		vi.advanceTimersByTime(ROUTE_INTENT_PREFETCH_DELAY_MS);
		expect(preloadRouteMock).toHaveBeenCalledWith({
			to: "/o/acme/spaces/space-alpha",
		});
		expect(prefetchData).toHaveBeenCalledTimes(1);
	});

	it("prefetches immediately for keyboard focus or pointer press", () => {
		const prefetchData = vi.fn(async () => undefined);
		render(
			<IntentButton
				prefetchData={prefetchData}
				to="/o/acme/direct-messages/space-dm"
			/>
		);
		const button = screen.getByRole("button", { name: "Open conversation" });

		fireEvent.focus(button);
		expect(preloadRouteMock).toHaveBeenNthCalledWith(1, {
			to: "/o/acme/direct-messages/space-dm",
		});

		fireEvent.pointerDown(button);
		expect(preloadRouteMock).toHaveBeenNthCalledWith(2, {
			to: "/o/acme/direct-messages/space-dm",
		});
		expect(prefetchData).toHaveBeenCalledTimes(2);
	});
});
