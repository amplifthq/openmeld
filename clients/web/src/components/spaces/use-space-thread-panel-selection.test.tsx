import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpaceThreadPanelSelection } from "./use-space-thread-panel-selection";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	window.localStorage.clear();
});

function ThreadPanelSelectionHarness({
	initialFocusSignalId,
}: {
	initialFocusSignalId?: string;
}) {
	const selection = useSpaceThreadPanelSelection({
		initialFocusSignalId,
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
	it.each([
		"same Space",
		"return to Space",
	])("prioritizes a main-message link over the previous Thread on %s", (navigation) => {
		const view = render(<ThreadPanelSelectionHarness />);
		fireEvent.click(screen.getByRole("button", { name: "Open Thread" }));
		expect(screen.getByLabelText("Active Thread").textContent).toBe("thread-1");
		if (navigation === "return to Space") {
			view.unmount();
			render(
				<ThreadPanelSelectionHarness initialFocusSignalId="main-message" />
			);
		} else {
			view.rerender(
				<ThreadPanelSelectionHarness initialFocusSignalId="main-message" />
			);
		}
		expect(screen.getByLabelText("Active Thread").textContent).toBe("closed");
		fireEvent.click(screen.getByRole("button", { name: "Open Thread" }));
		expect(screen.getByLabelText("Active Thread").textContent).toBe("thread-1");
	});
	it.each([
		"close",
		"switch",
		"reactivate",
	] as const)("opens a pending linked Thread immediately and respects %s before its catalog arrives", (action) => {
		function Harness({
			ready,
			requestId,
		}: {
			ready: boolean;
			requestId: string;
		}) {
			const selection = useSpaceThreadPanelSelection({
				profileId: "profile-1",
				spaceId: "space-1",
				availableThreadIds: new Set(
					ready ? ["thread-1", "thread-2"] : ["thread-2"]
				),
				availableThreadsReady: ready,
				initialFocusRequestId: requestId,
				threadIdsByRootSignalId: new Map(
					ready
						? [
								["root-1", "thread-1"],
								["root-2", "thread-2"],
							]
						: [["root-2", "thread-2"]]
				),
				initialFocusThreadRootSignalId: "root-1",
				initialFocusSignalId: "reply-1",
			});
			return (
				<>
					<output aria-label="Panel">
						{selection.isOpen
							? (selection.activeThreadId ?? "loading")
							: "closed"}
					</output>
					<button
						onClick={() =>
							action === "close" || action === "reactivate"
								? selection.close()
								: selection.open("thread-2")
						}
						type="button"
					>
						Leave target
					</button>
				</>
			);
		}
		const view = render(<Harness ready={false} requestId="visit-1" />);
		expect(screen.getByLabelText("Panel").textContent).toBe("loading");
		fireEvent.click(screen.getByRole("button", { name: "Leave target" }));
		view.rerender(
			<Harness
				ready={true}
				requestId={action === "reactivate" ? "visit-2" : "visit-1"}
			/>
		);
		const expectedPanelByAction = {
			close: "closed",
			reactivate: "thread-1",
			switch: "thread-2",
		} as const;
		expect(screen.getByLabelText("Panel").textContent).toBe(
			expectedPanelByAction[action]
		);
	});

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
