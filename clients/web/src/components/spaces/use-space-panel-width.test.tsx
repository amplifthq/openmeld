import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveSpacePanelWidthStorageKey,
	writeSpacePanelWidth,
} from "#/lib/spaces/panel-width-storage";
import { useSpacePanelWidth } from "./use-space-panel-width";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	window.localStorage.clear();
});

function PanelWidthHarness(input: { spaceId: string }) {
	const members = useSpacePanelWidth({
		panel: "members",
		spaceId: input.spaceId,
	});

	return (
		<>
			<output aria-label="Members width">{members.width}</output>
			<button onClick={() => members.onWidthChange("30rem")} type="button">
				Resize
			</button>
		</>
	);
}

describe("useSpacePanelWidth", () => {
	it("restores and persists the Members width for the current Space", async () => {
		writeSpacePanelWidth({
			panel: "members",
			spaceId: "space-a",
			width: "24rem",
		});
		writeSpacePanelWidth({
			panel: "members",
			spaceId: "space-b",
			width: "28rem",
		});
		const view = render(<PanelWidthHarness spaceId="space-a" />);

		await waitFor(() => {
			expect(screen.getByLabelText("Members width").textContent).toBe("24rem");
		});
		view.rerender(<PanelWidthHarness spaceId="space-b" />);
		await waitFor(() => {
			expect(screen.getByLabelText("Members width").textContent).toBe("28rem");
		});

		fireEvent.click(screen.getByRole("button", { name: "Resize" }));

		expect(screen.getByLabelText("Members width").textContent).toBe("30rem");
		expect(
			window.localStorage.getItem(
				resolveSpacePanelWidthStorageKey({
					panel: "members",
					spaceId: "space-a",
				})
			)
		).toBe("24rem");
		expect(
			window.localStorage.getItem(
				resolveSpacePanelWidthStorageKey({
					panel: "members",
					spaceId: "space-b",
				})
			)
		).toBe("30rem");
	});

	it("resizes the panel when browser storage rejects the preference", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("Storage is full.", "QuotaExceededError");
		});
		render(<PanelWidthHarness spaceId="space-a" />);

		fireEvent.click(screen.getByRole("button", { name: "Resize" }));

		await waitFor(() => {
			expect(screen.getByLabelText("Members width").textContent).toBe("30rem");
		});
	});
});
