import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceConversationDatePill } from "./space-conversation-date-marker";

const scrollToMessageMock = vi.hoisted(() => vi.fn());
const scrollPosition = vi.hoisted(() => ({ value: "latest" }));

vi.mock("@shadcn/react/message-scroller", () => ({
	useMessageScroller: () => ({
		scrollToEnd: vi.fn(),
		scrollToMessage: scrollToMessageMock,
		scrollToStart: vi.fn(),
	}),
}));

describe("SpaceConversationDatePill", () => {
	beforeEach(() => {
		scrollPosition.value = "latest";
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({
				addEventListener: vi.fn(),
				matches: false,
				removeEventListener: vi.fn(),
			}))
		);
	});

	afterEach(() => {
		cleanup();
		scrollToMessageMock.mockReset();
		vi.unstubAllGlobals();
	});

	it("keeps the compact date navigation target touch friendly", () => {
		render(
			<SpaceConversationDatePill
				date={new Date()}
				loadedSignalCount={1}
				onJumpToDate={vi.fn(async () => null)}
			/>
		);

		const dateNavigation = screen.getByRole("button", {
			name: "Open date navigation for Today",
		});
		expect(dateNavigation.className).toContain("h-8");
		expect(dateNavigation.className).toContain("max-lg:h-11");
		expect(dateNavigation.className).toContain("max-lg:min-h-11");
		expect(dateNavigation.className).toContain("max-lg:min-w-11");
	});

	it("scrolls only after the requested date window is mounted", async () => {
		const successfulScroll = vi.fn();
		scrollToMessageMock.mockImplementation((signalId: string) => {
			if (
				signalId === "signal-loaded-for-date" &&
				screen.queryByTestId("loaded-date-target")
			) {
				scrollPosition.value = "target";
				successfulScroll();
				return true;
			}
			return false;
		});
		render(<DateJumpHarness />);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Open date navigation for Today",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Last week" }));

		await waitFor(() => {
			expect(screen.getByTestId("loaded-date-target")).toBeTruthy();
			expect(successfulScroll).toHaveBeenCalledOnce();
			expect(scrollPosition.value).toBe("target");
		});
		expect(scrollToMessageMock).toHaveBeenCalledWith("signal-loaded-for-date", {
			align: "center",
			behavior: "smooth",
		});
	});
});

function DateJumpHarness() {
	const [targetMounted, setTargetMounted] = useState(false);
	useLayoutEffect(() => {
		if (targetMounted) {
			// The real message scroller restores its anchor in a parent layout effect.
			scrollPosition.value = "latest";
		}
	}, [targetMounted]);

	return (
		<>
			{targetMounted ? <div data-testid="loaded-date-target" /> : null}
			<SpaceConversationDatePill
				date={new Date()}
				loadedSignalCount={targetMounted ? 1 : 0}
				onJumpToDate={() => {
					window.setTimeout(() => setTargetMounted(true), 0);
					return Promise.resolve("signal-loaded-for-date");
				}}
			/>
		</>
	);
}
