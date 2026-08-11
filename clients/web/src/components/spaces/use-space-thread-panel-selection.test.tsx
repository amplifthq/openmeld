import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpaceThreadPanelSelection } from "./use-space-thread-panel-selection";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	window.localStorage.clear();
});

function ThreadPanelSelectionHarness() {
	const selection = useSpaceThreadPanelSelection({
		availableThreadIds: new Set(["thread-1"]),
		availableThreadsReady: true,
		profileId: "profile-1",
		spaceId: "space-1",
	});

	return (
		<>
			<output aria-label="Active Thread">
				{selection.activeThreadId ?? "closed"}
			</output>
			<button onClick={() => selection.open("thread-1")} type="button">
				Open Thread
			</button>
			<button onClick={selection.close} type="button">
				Close Thread
			</button>
		</>
	);
}

describe("useSpaceThreadPanelSelection", () => {
	it("opens and closes the Thread when browser storage is blocked", () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const blockedStorage = () => {
			throw new DOMException("Storage is blocked.", "SecurityError");
		};
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(blockedStorage);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(blockedStorage);
		vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
			blockedStorage
		);

		render(<ThreadPanelSelectionHarness />);
		expect(screen.getByLabelText("Active Thread").textContent).toBe("closed");

		fireEvent.click(screen.getByRole("button", { name: "Open Thread" }));
		expect(screen.getByLabelText("Active Thread").textContent).toBe("thread-1");

		fireEvent.click(screen.getByRole("button", { name: "Close Thread" }));
		expect(screen.getByLabelText("Active Thread").textContent).toBe("closed");
	});
});
